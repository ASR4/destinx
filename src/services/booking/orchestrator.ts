import { Stagehand } from '@browserbasehq/stagehand';
import { createBrowserSession, destroySession } from './session.js';
import { getEmbeddableLiveViewUrl } from './live-view.js';
import { sendText, sendMedia } from '../whatsapp/sender.js';
import { toWhatsAppAddress } from '../../utils/phone.js';
import {
  buildHotelDeepLinks,
  buildFlightDeepLinks,
  buildRestaurantDeepLinks,
  buildExperienceDeepLinks,
} from '../../utils/deeplink.js';
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
): Promise<{ sessionId: string; liveViewUrl: string }> {
  logger.info({ userId, type: booking.type }, 'Starting booking session');
  const whatsappTo = toWhatsAppAddress(userPhone);

  // Layer 3: If session creation fails, fall back immediately to deep links
  let session: { id: string; connectUrl: string };
  try {
    session = await createBrowserSession();
  } catch (err) {
    logger.error({ err }, 'Failed to create browser session — falling back to deep links');
    const deepLinks = buildDeepLinksForBooking(booking);
    const deepLinkMsg = formatDeepLinkFallback(deepLinks, booking);
    await sendText(whatsappTo, deepLinkMsg);

    if (bookingId) {
      await recordFailure(bookingId, 'session_creation_failed', String(err));
    }

    return { sessionId: '', liveViewUrl: '' };
  }

  const liveViewUrl = getEmbeddableLiveViewUrl(session.id);

  await sendText(
    whatsappTo,
    `🔗 Your booking session is ready!\n\nTap the link below to watch and control the booking:\n${liveViewUrl}\n\nI'll navigate to the booking site — you'll need to log in with your account to keep your loyalty points.`,
  );

  return { sessionId: session.id, liveViewUrl };
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
    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      browserbaseSessionID: sessionId,
    } as ConstructorParameters<typeof Stagehand>[0]);
    await stagehand.init();

    const result = await executeProviderFlow(stagehand, booking);

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
    logger.error({ err, sessionId }, 'Booking flow failed');

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
): Promise<BookingResult> {
  // Dynamic provider selection based on booking type
  switch (booking.type) {
    case 'hotel': {
      const { MarriottBookingProvider } = await import('./providers/marriott.js');
      const provider = new MarriottBookingProvider();
      return provider.execute(stagehand, booking as unknown as Record<string, unknown>);
    }
    default:
      return { status: 'failed', error: `No provider implemented for type: ${booking.type}` };
  }
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

function formatDeepLinkFallback(deepLinks: DeepLinks, booking: BookingDetails): string {
  const links: string[] = [];
  for (const [name, url] of Object.entries(deepLinks)) {
    if (url) {
      const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      links.push(`• ${label}: ${url}`);
    }
  }

  if (links.length === 0) {
    return "I couldn't complete the automated booking. Please try booking directly on the provider's website.";
  }

  return [
    `🔗 Here are direct links to complete your ${booking.type} booking manually:`,
    '',
    ...links,
    '',
    "Your loyalty points and rewards will still be preserved since you'll be booking directly!",
  ].join('\n');
}

async function captureFailureScreenshot(sessionId: string): Promise<string | null> {
  try {
    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      browserbaseSessionID: sessionId,
    } as ConstructorParameters<typeof Stagehand>[0]);
    await stagehand.init();
    const page = stagehand.context.activePage()!;
    const buffer = await page.screenshot({ type: 'png' });
    // TODO: Upload buffer to a file storage service and return URL
    logger.debug({ bytes: buffer.length }, 'Screenshot captured');
    return null;
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
