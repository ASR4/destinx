import type { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, HotelBookingDetails } from '../../../types/booking.js';

const bookingSummarySchema = z.object({
  propertyName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  roomType: z.string(),
  totalPrice: z.string(),
  cancellationPolicy: z.string().optional(),
  freeCancellationUntil: z.string().optional(),
});

const confirmationSchema = z.object({
  confirmationNumber: z.string(),
});

/**
 * Booking.com hotel booking flow.
 *
 * Steps:
 * 1. Navigate to booking.com
 * 2. Close popups/cookie consent
 * 3. Fill search form (destination, dates, guests)
 * 4. Find target property (or pick top result)
 * 5. Select room type
 * 6. PAUSE for user login or guest checkout decision
 * 7. Pre-fill guest details if available
 * 8. Show booking summary to user via WhatsApp
 * 9. PAUSE for user to enter payment details in browser
 * 10. Capture confirmation number
 */
export class BookingComProvider extends BaseBookingProvider {
  readonly providerName = 'booking.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
    context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as HotelBookingDetails;
    const page = stagehand.context.activePage()!;
    const sid = context?.sessionId ?? 'unknown';

    logger.info({ provider: this.providerName, destination: d.destination }, 'Starting Booking.com flow');

    await page.goto('https://www.booking.com');
    await stagehand.act('close any cookie consent banner or sign-in popup if present');
    await this.captureStep(stagehand, sid, '01_homepage', d.userPhone);

    // Search for the property
    await this.actWithRetry(
      stagehand,
      `search for hotels in "${d.destination}" with check-in date ${d.checkIn} and check-out date ${d.checkOut} for ${d.guests} guests`,
    );

    // Wait for search results
    await new Promise((r) => setTimeout(r, 3000));
    await this.captureStep(stagehand, sid, '02_search_results', d.userPhone);

    await this.handleCaptcha(stagehand, d.userPhone);

    if (d.propertyName) {
      await this.actWithRetry(
        stagehand,
        `find and click on "${d.propertyName}" in the search results`,
      );
    } else {
      await stagehand.act('click on the first available hotel in the search results');
    }

    // Select room type
    await this.actWithRetry(
      stagehand,
      `select the ${d.roomType || 'cheapest available'} room and click "Reserve" or "I'll reserve" button`,
    );
    await this.captureStep(stagehand, sid, '03_room_selected', d.userPhone);

    // Check for login prompt
    const needsLogin = await stagehand.observe(
      'Is there a sign-in prompt, login form, or "Create account / Sign in" button visible?',
    );

    if (needsLogin && needsLogin.length > 0) {
      await sendText(
        d.userPhone,
        "🔐 Booking.com is asking you to sign in. You can:\n\n• *Log in* with your Booking.com account (to keep your Genius loyalty status)\n• Or continue as a *Guest*\n\nPlease make your choice in the browser window — I'll continue once you've proceeded!",
      );

      const loggedIn = await this.waitForLogin(stagehand, {
        indicator: 'look for a user account name, Genius badge, or guest details form indicating the user has passed the login step',
        urlPattern: /booking\.com\/(checkout|book|reservation)/,
        timeout: 120_000,
      });

      if (!loggedIn) {
        return { status: 'timeout', error: 'Login/guest checkout timed out' };
      }
    }

    // Add special requests if any
    if (d.specialRequests) {
      await stagehand.act(`find the special requests field and type: "${d.specialRequests}"`);
    }

    // Navigate to final review page
    await this.actWithRetry(stagehand, 'click the "Next" or "Continue" button to proceed to the final booking summary');
    await this.captureStep(stagehand, sid, '05_review_page', d.userPhone);

    // Extract booking summary
    const summaryResult = await stagehand.extract(
      'Extract the booking summary: property name, check-in date, check-out date, room type, total price, cancellation policy, free cancellation deadline if any',
    );

    let summary: z.infer<typeof bookingSummarySchema>;
    try {
      summary = bookingSummarySchema.parse(
        typeof summaryResult === 'string'
          ? JSON.parse(summaryResult)
          : 'extraction' in summaryResult
            ? JSON.parse(summaryResult.extraction)
            : summaryResult,
      );
    } catch {
      summary = {
        propertyName: d.propertyName ?? 'Selected hotel',
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        roomType: d.roomType ?? 'Standard room',
        totalPrice: 'See browser',
      };
    }

    const cancellationLine = summary.freeCancellationUntil
      ? `\n✅ Free cancellation until ${summary.freeCancellationUntil}`
      : summary.cancellationPolicy
        ? `\n📝 ${summary.cancellationPolicy}`
        : '';

    await sendText(
      d.userPhone,
      `📋 *Booking Summary — Booking.com*\n\n🏨 ${summary.propertyName}\n📅 ${summary.checkIn} → ${summary.checkOut}\n🛏️ ${summary.roomType}\n💰 ${summary.totalPrice}${cancellationLine}\n\n💳 *Please enter your payment details and click "Complete booking" in the browser window to confirm!*`,
    );

    // Wait for user to complete payment in browser
    const confirmed = await this.waitForConfirmation(stagehand, {
      indicator: 'look for a booking confirmation page with a confirmation number, "Booking confirmed", or "Thank you" message',
      urlPattern: /booking\.com\/(confirmation|booking-confirmation|myreservations)/,
      timeout: 300_000, // 5 minutes for user to enter payment
    });

    if (confirmed) {
      await this.captureStep(stagehand, sid, '06_confirmed', d.userPhone);
      const confResult = await stagehand.extract(
        'Extract the booking confirmation number or reservation number',
      );

      let confNumber = 'Unknown';
      try {
        const parsed = confirmationSchema.parse(
          typeof confResult === 'string'
            ? JSON.parse(confResult)
            : 'extraction' in confResult
              ? JSON.parse(confResult.extraction)
              : confResult,
        );
        confNumber = parsed.confirmationNumber;
      } catch {
        // fallback
      }

      return {
        status: 'confirmed',
        confirmationNumber: confNumber,
        summary: {
          hotelName: summary.propertyName,
          checkIn: summary.checkIn,
          checkOut: summary.checkOut,
          roomType: summary.roomType,
          totalPrice: summary.totalPrice,
          cancellationPolicy: summary.cancellationPolicy,
        },
      };
    }

    return { status: 'timeout', summary: { hotelName: summary.propertyName } };
  }
}
