import type { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, ExperienceBookingDetails } from '../../../types/booking.js';

const experienceSummarySchema = z.object({
  experienceName: z.string(),
  date: z.string(),
  participants: z.number().or(z.string()),
  totalPrice: z.string(),
  meetingPoint: z.string().optional(),
  duration: z.string().optional(),
  cancellationPolicy: z.string().optional(),
});

const confirmationSchema = z.object({
  bookingReference: z.string(),
});

/**
 * Viator experience/tour booking flow.
 *
 * Steps:
 * 1. Navigate to viator.com
 * 2. Search for the experience by name + destination
 * 3. Select the experience from results
 * 4. Choose date and number of participants
 * 5. PAUSE for user login or guest checkout
 * 6. Show booking summary to user
 * 7. PAUSE for user to enter payment details
 * 8. Capture booking reference
 */
export class ViatorProvider extends BaseBookingProvider {
  readonly providerName = 'viator.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
    context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as ExperienceBookingDetails;
    const page = stagehand.context.activePage()!;
    const sid = context?.sessionId ?? 'unknown';

    logger.info({ provider: this.providerName, experience: d.experienceName }, 'Starting Viator flow');

    await page.goto('https://www.viator.com');
    await stagehand.act('close any cookie consent banner or subscription popup if visible');
    await this.captureStep(stagehand, sid, '01_homepage');

    // Search for the experience
    await this.actWithRetry(
      stagehand,
      `search for "${d.experienceName}" in ${d.destination}`,
    );

    await new Promise((r) => setTimeout(r, 2000));
    await this.handleCaptcha(stagehand, d.userPhone);

    // Select the experience
    await this.actWithRetry(
      stagehand,
      `find and click on "${d.experienceName}" or the most relevant matching experience in the search results`,
    );

    await new Promise((r) => setTimeout(r, 2000));

    // Select date and participants
    await this.actWithRetry(
      stagehand,
      `select the date ${d.date} and set the number of participants to ${d.participants}`,
    );

    await this.actWithRetry(stagehand, 'click the "Book now" or "Check availability" button');

    await new Promise((r) => setTimeout(r, 2000));

    // Handle login or guest checkout
    const needsLogin = await stagehand.observe(
      'Is there a sign-in prompt, create account form, or guest checkout option visible?',
    );

    if (needsLogin && needsLogin.length > 0) {
      await sendText(
        d.userPhone,
        "🎟️ Viator needs your account or contact details to complete the booking.\n\nYou can:\n• *Sign in* with your Viator or TripAdvisor account\n• Or continue as a *Guest* with your email\n\nPlease complete this step in the browser window!",
      );

      const loggedIn = await this.waitForLogin(stagehand, {
        indicator: 'look for a booking review page, traveler details form, or payment section',
        urlPattern: /viator\.com\/(checkout|booking|payment)/,
        timeout: 120_000,
      });

      if (!loggedIn) {
        return { status: 'timeout', error: 'Login/guest checkout timed out' };
      }
    }

    // Extract booking summary
    const summaryResult = await stagehand.extract(
      'Extract the booking details: experience name, date, number of participants, total price, meeting point, duration, and cancellation policy',
    );

    let summary: z.infer<typeof experienceSummarySchema>;
    try {
      summary = experienceSummarySchema.parse(
        typeof summaryResult === 'string'
          ? JSON.parse(summaryResult)
          : 'extraction' in summaryResult
            ? JSON.parse(summaryResult.extraction)
            : summaryResult,
      );
    } catch {
      summary = {
        experienceName: d.experienceName,
        date: d.date,
        participants: d.participants,
        totalPrice: 'See browser',
      };
    }

    const meetingLine = summary.meetingPoint ? `\n📍 Meeting point: ${summary.meetingPoint}` : '';
    const durationLine = summary.duration ? `\n⏱️ Duration: ${summary.duration}` : '';
    const cancelLine = summary.cancellationPolicy ? `\n📝 ${summary.cancellationPolicy}` : '';

    await sendText(
      d.userPhone,
      `📋 *Booking Summary — Viator*\n\n🎟️ ${summary.experienceName}\n📅 ${summary.date}\n👥 ${summary.participants} participant(s)${durationLine}${meetingLine}\n💰 ${summary.totalPrice}${cancelLine}\n\n💳 *Please enter your payment details in the browser window to confirm the booking!*`,
    );

    // Wait for user to complete payment
    const confirmed = await this.waitForConfirmation(stagehand, {
      indicator: 'look for a booking confirmation page with a booking reference number or "Booking confirmed" message',
      urlPattern: /viator\.com\/(confirmation|booking-confirmation|thank-you)/,
      timeout: 300_000,
    });

    if (confirmed) {
      await this.captureStep(stagehand, sid, '06_confirmed');
      const confResult = await stagehand.extract(
        'Extract the Viator booking reference number',
      );

      let bookingRef = 'Unknown';
      try {
        const parsed = confirmationSchema.parse(
          typeof confResult === 'string'
            ? JSON.parse(confResult)
            : 'extraction' in confResult
              ? JSON.parse(confResult.extraction)
              : confResult,
        );
        bookingRef = parsed.bookingReference;
      } catch {
        // fallback
      }

      await sendText(
        d.userPhone,
        `✅ *Experience Booked!*\n\n🎟️ ${summary.experienceName}\n📅 ${summary.date}${meetingLine}\n🎫 Reference: ${bookingRef}\n\nYou'll receive a confirmation email with full details and a voucher. Have an amazing experience! 🌟`,
      );

      return {
        status: 'confirmed',
        confirmationNumber: bookingRef,
        summary: {
          hotelName: summary.experienceName, // reuse hotelName field for experience name
          totalPrice: summary.totalPrice,
        },
      };
    }

    return { status: 'timeout', summary: { hotelName: summary.experienceName } };
  }
}
