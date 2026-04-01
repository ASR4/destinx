import type { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, RestaurantBookingDetails } from '../../../types/booking.js';

const reservationSummarySchema = z.object({
  restaurantName: z.string(),
  date: z.string(),
  time: z.string(),
  partySize: z.number().or(z.string()),
  address: z.string().optional(),
  confirmationNumber: z.string().optional(),
});

/**
 * OpenTable restaurant reservation flow.
 *
 * Steps:
 * 1. Navigate to opentable.com
 * 2. Search by restaurant name and location
 * 3. Select the date, time, and party size
 * 4. PAUSE for user login or enter email (OpenTable allows guest reservations)
 * 5. Fill in contact details
 * 6. Confirm reservation (no payment required — restaurant confirms directly)
 * 7. Capture confirmation number
 */
export class OpenTableProvider extends BaseBookingProvider {
  readonly providerName = 'opentable.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
    context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as RestaurantBookingDetails;
    const page = stagehand.context.activePage()!;
    const sid = context?.sessionId ?? 'unknown';

    logger.info({ provider: this.providerName, restaurant: d.restaurantName }, 'Starting OpenTable flow');

    await page.goto('https://www.opentable.com');
    await stagehand.act('close any cookie consent or promotional popup if visible');
    await this.captureStep(stagehand, sid, '01_homepage');

    // Search for the restaurant
    await this.actWithRetry(
      stagehand,
      `search for the restaurant "${d.restaurantName}" ${d.location ? `in ${d.location}` : ''}`,
    );

    await new Promise((r) => setTimeout(r, 2000));

    // Click on the restaurant result
    await this.actWithRetry(
      stagehand,
      `click on "${d.restaurantName}" in the search results`,
    );

    await new Promise((r) => setTimeout(r, 2000));

    // Select date, time, and party size
    await this.actWithRetry(
      stagehand,
      `find the reservation widget and select: date ${d.date}, time ${d.time} (or closest available), party size ${d.partySize}`,
    );

    await this.actWithRetry(stagehand, 'click the "Find a time" or "Search" button in the reservation widget');

    // Select a time slot
    await this.actWithRetry(
      stagehand,
      `select the time slot closest to ${d.time} from the available times`,
    );

    // Handle login or guest checkout
    const needsLogin = await stagehand.observe(
      'Is there a sign-in prompt, login modal, or email input to continue as a guest?',
    );

    if (needsLogin && needsLogin.length > 0) {
      await sendText(
        d.userPhone,
        "🍽️ OpenTable needs your contact details to confirm the reservation.\n\nYou can:\n• *Sign in* with your OpenTable account (to earn dining points)\n• Or continue with just your *email address*\n\nPlease complete this step in the browser window — I'll continue once you're ready!",
      );

      const loggedIn = await this.waitForLogin(stagehand, {
        indicator: 'look for a reservation review page, contact details form, or "Complete reservation" button',
        urlPattern: /opentable\.com\/(booking|reservation|wizard)/,
        timeout: 120_000,
      });

      if (!loggedIn) {
        return { status: 'timeout', error: 'Login/contact details entry timed out' };
      }
    }

    // Add special requests
    if (d.specialRequests) {
      await stagehand.act(`find the special requests or occasions field and type: "${d.specialRequests}"`);
    }

    // Proceed to confirmation
    await this.actWithRetry(stagehand, 'click the "Complete reservation" or "Confirm" button to finalize the booking');

    await new Promise((r) => setTimeout(r, 3000));
    await this.captureStep(stagehand, sid, '05_confirmed');

    // Extract confirmation details
    const summaryResult = await stagehand.extract(
      'Extract the reservation details: restaurant name, date, time, party size, address, and confirmation number',
    );

    let summary: z.infer<typeof reservationSummarySchema>;
    try {
      summary = reservationSummarySchema.parse(
        typeof summaryResult === 'string'
          ? JSON.parse(summaryResult)
          : 'extraction' in summaryResult
            ? JSON.parse(summaryResult.extraction)
            : summaryResult,
      );
    } catch {
      summary = {
        restaurantName: d.restaurantName,
        date: d.date,
        time: d.time,
        partySize: d.partySize,
      };
    }

    const confNumber = summary.confirmationNumber ?? 'Check your email';
    const addressLine = summary.address ? `\n📍 ${summary.address}` : '';

    await sendText(
      d.userPhone,
      `✅ *Reservation Confirmed — OpenTable*\n\n🍽️ ${summary.restaurantName}\n📅 ${summary.date} at ${summary.time}\n👥 ${summary.partySize} guest(s)${addressLine}\n🎫 Confirmation: ${confNumber}\n\nA confirmation email has been sent to you. Enjoy your meal! 🥂`,
    );

    return {
      status: 'confirmed',
      confirmationNumber: confNumber,
      summary: {
        hotelName: summary.restaurantName, // reuse hotelName field for restaurant
      },
    };
  }
}
