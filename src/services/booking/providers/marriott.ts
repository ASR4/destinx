import type { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, HotelBookingDetails } from '../../../types/booking.js';

const bookingSummarySchema = z.object({
  hotelName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  roomType: z.string(),
  totalPrice: z.string(),
  loyaltyPoints: z.string().optional(),
  cancellationPolicy: z.string().optional(),
});

const confirmationSchema = z.object({
  confirmationNumber: z.string(),
});

/**
 * Marriott booking flow using hybrid Playwright + Stagehand approach.
 *
 * Steps:
 * 1. Navigate to marriott.com
 * 2. Close popups (AI-handled)
 * 3. Fill search form (destination, dates, guests)
 * 4. Find the target property
 * 5. Select room type
 * 6. PAUSE for user login (if needed)
 * 7. Fill special requests
 * 8. Navigate to confirmation page
 * 9. Extract booking summary
 * 10. PAUSE for user to click Confirm
 * 11. Capture confirmation number
 */
export class MarriottBookingProvider extends BaseBookingProvider {
  readonly providerName = 'marriott.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
    context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as HotelBookingDetails;
    const page = stagehand.context.activePage()!;
    const sid = context?.sessionId ?? 'unknown';

    logger.info({ provider: this.providerName, destination: d.destination }, 'Starting Marriott flow');

    await page.goto('https://www.marriott.com');
    await stagehand.act('close any cookie consent or popup banners');
    await this.captureStep(stagehand, sid, '01_homepage');

    await stagehand.act(
      `search for hotels in "${d.destination}" with check-in ${d.checkIn} and check-out ${d.checkOut} for ${d.guests} guests`,
    );

    // Wait for results to load
    await new Promise((r) => setTimeout(r, 3000));
    await this.captureStep(stagehand, sid, '02_search_results');

    if (d.propertyName) {
      await stagehand.act(
        `find and click on "${d.propertyName}" in the search results`,
      );
    }

    await stagehand.act(
      `select a ${d.roomType || 'standard'} room and click to book it`,
    );
    await this.captureStep(stagehand, sid, '03_room_selected');

    const needsLogin = await stagehand.observe(
      'Is there a sign-in or login form visible on the page?',
    );

    if (needsLogin && needsLogin.length > 0) {
      await sendText(
        d.userPhone,
        "🔐 Please log into your Marriott Bonvoy account in the browser window. I'll continue once you're logged in!",
      );

      const loggedIn = await this.waitForLogin(stagehand, {
        indicator:
          'look for a user name, account icon, or "My Account" link that indicates the user is logged in',
      });

      if (!loggedIn) {
        await this.captureStep(stagehand, sid, '04_login_timeout');
        return { status: 'timeout', error: 'Login timed out' };
      }

      await sendText(d.userPhone, '✅ Logged in! Continuing with the booking...');
      await this.captureStep(stagehand, sid, '04_logged_in');
    }

    if (d.specialRequests) {
      await stagehand.act(`add special request: "${d.specialRequests}"`);
    }

    await stagehand.act(
      'proceed to the final booking review or confirmation page',
    );
    await this.captureStep(stagehand, sid, '05_review_page');

    const summaryResult = await stagehand.extract(
      'Extract the booking summary including: hotel name, dates, room type, total price, loyalty points earned, cancellation policy',
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
        hotelName: 'Unknown',
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        roomType: d.roomType || 'Standard',
        totalPrice: 'See browser',
      };
    }

    await sendText(
      d.userPhone,
      `📋 *Booking Summary*\n\n🏨 ${summary.hotelName}\n📅 ${summary.checkIn} → ${summary.checkOut}\n🛏️ ${summary.roomType}\n💰 ${summary.totalPrice}${summary.loyaltyPoints ? `\n✨ Points earned: ${summary.loyaltyPoints}` : ''}${summary.cancellationPolicy ? `\n📝 ${summary.cancellationPolicy}` : ''}\n\n👆 *Please review and tap "Confirm Booking" in the browser window when ready!*`,
    );

    const confirmed = await this.waitForConfirmation(stagehand, {
      indicator:
        'look for a booking confirmation number, "thank you" message, or confirmation page',
    });

    if (confirmed) {
      await this.captureStep(stagehand, sid, '06_confirmed');
      const confResult = await stagehand.extract(
        'Extract the booking confirmation number or reference code',
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
        summary,
      };
    }

    await this.captureStep(stagehand, sid, '06_timeout');
    return { status: 'timeout', summary };
  }
}
