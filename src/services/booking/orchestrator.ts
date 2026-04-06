import { Stagehand } from '@browserbasehq/stagehand';
import { createBrowserSession, destroySession } from './session.js';
// Live view URL is not used currently — screenshots are sent via WhatsApp instead
import { sendText, sendMedia } from '../whatsapp/sender.js';
import { toWhatsAppAddress } from '../../utils/phone.js';
import {
  buildHotelDeepLinks,
  buildFlightDeepLinks,
  buildRestaurantDeepLinks,
  buildExperienceDeepLinks,
} from '../../utils/deeplink.js';
import { uploadScreenshot } from '../storage/r2.js';
import { logger } from '../../utils/logger.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bookings } from '../../db/schema.js';
import type { BookingDetails, BookingResult, DeepLinks } from '../../types/booking.js';

/**
 * Start a booking session with three layers of error recovery:
 * 1. act() failures → retry with rephrased instruction (handled in provider)
 * 2. Full flow failure → screenshot + deep link fallback
 * 3. Session creation failure → immediate deep link fallback
 */
export async function startBookingSession(
  userId: string,
  userPhone: string,
  booking: BookingDetails,
  bookingId?: string,
): Promise<{ sessionId: string }> {
  logger.info({ userId, type: booking.type }, 'Starting booking session');
  const whatsappTo = toWhatsAppAddress(userPhone);

  // Layer 3: If session creation fails, fall back immediately to deep links
  let session: { id: string; connectUrl: string };
  try {
    session = await createBrowserSession();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errMsg, bookingType: booking.type }, `Failed to create browser session — falling back to deep links: ${errMsg}`);
    const deepLinks = buildDeepLinksForBooking(booking);
    const deepLinkMsg = formatDeepLinkFallback(deepLinks, booking);
    await sendText(whatsappTo, deepLinkMsg);

    if (bookingId) {
      await recordFailure(bookingId, 'session_creation_failed', String(err));
    }

    return { sessionId: '' };
  }

  return { sessionId: session.id };
}

/**
 * Execute a booking in an active browser session.
 * Layer 2: On full flow failure, captures screenshot and offers deep link fallback.
 */
export async function executeBookingSession(
  sessionId: string,
  userId: string,
  userPhone: string,
  booking: BookingDetails,
  bookingId?: string,
): Promise<BookingResult> {
  const whatsappTo = toWhatsAppAddress(userPhone);

  try {
    const modelApiKey = process.env.OPENAI_API_KEY;
    if (!modelApiKey) {
      throw new Error('OPENAI_API_KEY is required for Stagehand browser automation (powers act/observe/extract)');
    }

    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      browserbaseSessionID: sessionId,
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: {
        modelName: 'openai/gpt-4o-mini' as const,
        apiKey: modelApiKey,
      },
      verbose: 0,
    } as ConstructorParameters<typeof Stagehand>[0]);
    logger.info({ sessionId, type: booking.type }, 'Stagehand connecting to Browserbase session');
    await stagehand.init();
    logger.info({ sessionId, type: booking.type }, 'Stagehand ready — running provider booking flow');

    const result = await executeProviderFlow(stagehand, booking, sessionId);

    if (result.status === 'confirmed' && bookingId) {
      await getDb()
        .update(bookings)
        .set({
          status: 'booked',
          bookingReference: result.confirmationNumber,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, bookingId));
    }

    return result;
  } catch (err) {
    // Layer 2: Capture screenshot and send fallback
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ error: errMsg, sessionId, bookingType: booking.type }, `Booking flow failed: ${errMsg}`);

    try {
      const screenshotUrl = await captureFailureScreenshot(sessionId);
      if (screenshotUrl) {
        await sendMedia(
          whatsappTo,
          screenshotUrl,
          "😔 Hit a snag — here's where I got stuck. You can try completing the booking manually:",
        );
      }
    } catch (screenshotErr) {
      logger.warn({ err: screenshotErr }, 'Failed to capture failure screenshot');
    }

    const deepLinks = buildDeepLinksForBooking(booking);
    const fallbackMsg = formatDeepLinkFallback(deepLinks, booking);
    await sendText(whatsappTo, fallbackMsg);

    if (bookingId) {
      await recordFailure(bookingId, 'flow_failed', String(err));
    }

    return { status: 'failed', error: String(err) };
  } finally {
    await destroySession(sessionId);
  }
}

async function executeProviderFlow(
  stagehand: Stagehand,
  booking: BookingDetails,
  sessionId?: string,
): Promise<BookingResult> {
  const { selectProvider, describeProvider } = await import('./providers/provider-selector.js');
  const providerName = describeProvider(booking);
  logger.info({ type: booking.type, provider: providerName }, 'Selected booking provider');

  const provider = await selectProvider(booking);
  return provider.execute(stagehand, booking as unknown as Record<string, unknown>, { sessionId });
}

function buildDeepLinksForBooking(booking: BookingDetails): DeepLinks {
  switch (booking.type) {
    case 'hotel':
      return buildHotelDeepLinks(booking);
    case 'flight':
      return buildFlightDeepLinks(booking);
    case 'restaurant':
      return buildRestaurantDeepLinks(booking);
    case 'experience':
      return buildExperienceDeepLinks(booking);
    default:
      return {};
  }
}

const DEEP_LINK_LABELS: Record<string, string> = {
  direct: '🏨 Direct hotel site (best rates + perks)',
  bookingCom: '🅱️ Booking.com',
  agoda: '🏠 Agoda',
  skyscanner: '✈️ Skyscanner',
  googleFlights: '✈️ Google Flights',
  openTable: '🍽️ OpenTable',
  getYourGuide: '🎭 GetYourGuide',
  viator: '🎭 Viator',
  googleMaps: '📍 Google Maps',
};

function formatDeepLinkFallback(deepLinks: DeepLinks, booking: BookingDetails): string {
  const entries = Object.entries(deepLinks).filter(([, url]) => url);

  if (entries.length === 0) {
    return "I couldn't complete the automated booking. Please try booking directly on the provider's website.";
  }

  const lines: string[] = [
    `🔗 *Here are your best options to book:*`,
    '',
  ];

  entries.forEach(([key, url], idx) => {
    const label = DEEP_LINK_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
    lines.push(`*Option ${idx + 1}:* ${label}`);
    lines.push(`👉 ${url}`);
    lines.push('');
  });

  if (booking.type === 'hotel') {
    lines.push('💡 The direct hotel site usually has the best rates + loyalty perks!');
  } else {
    lines.push("Your loyalty points and rewards will still be preserved since you'll be booking directly!");
  }

  return lines.join('\n');
}

async function captureFailureScreenshot(sessionId: string): Promise<string | null> {
  try {
    const modelApiKey = process.env.OPENAI_API_KEY;
    if (!modelApiKey) return null;

    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      browserbaseSessionID: sessionId,
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: { modelName: 'openai/gpt-4o-mini' as const, apiKey: modelApiKey },
      verbose: 0,
    } as ConstructorParameters<typeof Stagehand>[0]);
    await stagehand.init();
    const page = stagehand.context.activePage()!;
    const buffer = await page.screenshot({ type: 'png' });
    return uploadScreenshot(Buffer.from(buffer), sessionId, 'failure');
  } catch {
    return null;
  }
}

async function recordFailure(
  bookingId: string,
  reason: string,
  details: string,
): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(bookings)
      .set({
        status: 'failed',
        details: { failureReason: reason, failureDetails: details },
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));
  } catch (err) {
    logger.error({ err, bookingId }, 'Failed to record booking failure');
  }
}
