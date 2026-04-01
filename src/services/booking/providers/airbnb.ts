import type { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, HotelBookingDetails } from '../../../types/booking.js';

const listingSummarySchema = z.object({
  listingName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number().or(z.string()),
  totalPrice: z.string(),
  hostName: z.string().optional(),
  cancellationPolicy: z.string().optional(),
});

const confirmationSchema = z.object({
  confirmationCode: z.string(),
});

/**
 * Airbnb property booking flow.
 *
 * Steps:
 * 1. Navigate to airbnb.com
 * 2. Close popups/cookie consent
 * 3. Search with destination, dates, guests
 * 4. Select listing (by name or top result)
 * 5. Review listing page
 * 6. Click "Reserve" button
 * 7. PAUSE for user login (Airbnb requires account)
 * 8. Show booking summary via WhatsApp
 * 9. PAUSE for user to confirm payment in browser
 * 10. Capture confirmation code
 */
export class AirbnbProvider extends BaseBookingProvider {
  readonly providerName = 'airbnb.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
    context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as HotelBookingDetails;
    const page = stagehand.context.activePage()!;
    const sid = context?.sessionId ?? 'unknown';

    logger.info({ provider: this.providerName, destination: d.destination }, 'Starting Airbnb flow');

    await page.goto('https://www.airbnb.com');
    await stagehand.act('close any translation prompts, cookie banners, or sign-up popups if visible');
    await this.captureStep(stagehand, sid, '01_homepage');

    // Fill search form
    await this.actWithRetry(
      stagehand,
      `search for stays in "${d.destination}" with check-in ${d.checkIn} and check-out ${d.checkOut} for ${d.guests} guest${d.guests > 1 ? 's' : ''}`,
    );

    await new Promise((r) => setTimeout(r, 3000));
    await this.captureStep(stagehand, sid, '02_search_results');
    await this.handleCaptcha(stagehand, d.userPhone);

    // Select listing
    if (d.propertyName) {
      await this.actWithRetry(
        stagehand,
        `find and click on the listing "${d.propertyName}" in the search results`,
      );
    } else {
      await stagehand.act('click on the first highly-rated listing in the search results');
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Click Reserve
    await this.actWithRetry(stagehand, 'find and click the "Reserve" button on the listing page');

    // Airbnb always requires login
    const needsLogin = await stagehand.observe(
      'Is there a login or sign-up modal/form visible?',
    );

    if (needsLogin && needsLogin.length > 0) {
      await sendText(
        d.userPhone,
        "🔐 Airbnb requires you to be signed in to complete a reservation.\n\nPlease log in with your Airbnb account in the browser window — I'll continue once you're logged in!",
      );

      const loggedIn = await this.waitForLogin(stagehand, {
        indicator: 'look for a profile picture, user name, or booking review page indicating successful login',
        urlPattern: /airbnb\.com\/(book|checkout|trips)/,
        timeout: 120_000,
      });

      if (!loggedIn) {
        return { status: 'timeout', error: 'Airbnb login timed out' };
      }

      await sendText(d.userPhone, '✅ Logged in! Reviewing your booking details now...');
    }

    // Add special requests if any
    if (d.specialRequests) {
      await stagehand.act(`find the message to host field and type: "${d.specialRequests}"`);
    }

    // Extract listing summary
    const summaryResult = await stagehand.extract(
      'Extract the booking details: listing name, check-in date, check-out date, number of guests, total price, host name, and cancellation policy',
    );

    let summary: z.infer<typeof listingSummarySchema>;
    try {
      summary = listingSummarySchema.parse(
        typeof summaryResult === 'string'
          ? JSON.parse(summaryResult)
          : 'extraction' in summaryResult
            ? JSON.parse(summaryResult.extraction)
            : summaryResult,
      );
    } catch {
      summary = {
        listingName: d.propertyName ?? 'Selected listing',
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        guests: d.guests,
        totalPrice: 'See browser',
      };
    }

    const hostLine = summary.hostName ? `\n👤 Host: ${summary.hostName}` : '';
    const cancelLine = summary.cancellationPolicy ? `\n📝 ${summary.cancellationPolicy}` : '';

    await sendText(
      d.userPhone,
      `📋 *Booking Summary — Airbnb*\n\n🏠 ${summary.listingName}\n📅 ${summary.checkIn} → ${summary.checkOut}\n👥 ${summary.guests} guest(s)${hostLine}\n💰 ${summary.totalPrice}${cancelLine}\n\n💳 *Please confirm and enter your payment details in the browser window to complete the booking!*`,
    );

    // Wait for user to confirm payment
    const confirmed = await this.waitForConfirmation(stagehand, {
      indicator: 'look for a booking confirmation page with a confirmation code, "You\'re going to [destination]" message, or similar',
      urlPattern: /airbnb\.com\/booking\/confirmation/,
      timeout: 300_000,
    });

    if (confirmed) {
      await this.captureStep(stagehand, sid, '06_confirmed');
      const confResult = await stagehand.extract(
        'Extract the Airbnb confirmation code (format: HMXXXXXXXXXX or similar alphanumeric code)',
      );

      let confCode = 'Unknown';
      try {
        const parsed = confirmationSchema.parse(
          typeof confResult === 'string'
            ? JSON.parse(confResult)
            : 'extraction' in confResult
              ? JSON.parse(confResult.extraction)
              : confResult,
        );
        confCode = parsed.confirmationCode;
      } catch {
        // fallback
      }

      return {
        status: 'confirmed',
        confirmationNumber: confCode,
        summary: {
          hotelName: summary.listingName,
          checkIn: summary.checkIn,
          checkOut: summary.checkOut,
          totalPrice: summary.totalPrice,
          cancellationPolicy: summary.cancellationPolicy,
        },
      };
    }

    return { status: 'timeout', summary: { hotelName: summary.listingName } };
  }
}
