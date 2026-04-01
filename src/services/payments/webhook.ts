import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bookings, conversations } from '../../db/schema.js';
import { DuffelFlightProvider } from '../booking/providers/flights/duffel.js';
import { getSearchResults } from '../booking/search-cache.js';
import { searchAndBookFlight } from '../search/flights.js';
import { sendText } from '../whatsapp/sender.js';
import { toWhatsAppAddress } from '../../utils/phone.js';
import { logger } from '../../utils/logger.js';
import type { DuffelPassenger } from '../search/flights.js';

/**
 * Handle a Stripe checkout.session.completed event.
 * Retrieves booking metadata, books with Duffel, and notifies the user via WhatsApp.
 */
export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const meta = session.metadata;
  if (!meta) {
    logger.error({ sessionId: session.id }, 'Stripe session has no metadata');
    return;
  }

  const {
    searchId,
    flightNumber,
    origin,
    destination,
    departureDate,
    cabinClass,
    conversationId,
    userId,
    userPhone,
    passengers: passengersJson,
  } = meta;

  const whatsappTo = toWhatsAppAddress(userPhone);
  const passengers: DuffelPassenger[] = JSON.parse(passengersJson);

  logger.info(
    { sessionId: session.id, flightNumber, userId },
    'Processing paid flight booking',
  );

  const db = getDb();

  // Idempotency check — if already booked (Stripe may retry webhooks), skip re-processing
  const existing = await db
    .select({ status: bookings.status, paymentStatus: bookings.paymentStatus })
    .from(bookings)
    .where(eq(bookings.stripeSessionId, session.id))
    .limit(1);

  if (existing[0]?.status === 'booked') {
    logger.info({ sessionId: session.id }, 'Webhook already processed — skipping duplicate');
    return;
  }

  // Mark payment received before attempting Duffel booking
  await db
    .update(bookings)
    .set({ paymentStatus: 'paid', updatedAt: new Date() })
    .where(eq(bookings.stripeSessionId, session.id));

  let bookingReference: string | null = null;
  let orderId: string | null = null;
  let totalAmount: string | null = null;
  let totalCurrency: string | null = null;

  // Attempt 1: cached offer
  if (conversationId && searchId && flightNumber) {
    try {
      const cached = await getSearchResults(conversationId, searchId);
      if (cached) {
        const matched = (cached.offers as Array<{ flightNumber: string }>).find(
          (o) => o.flightNumber === flightNumber,
        );
        if (matched) {
          const provider = new DuffelFlightProvider();
          const result = await provider.book(matched, passengers);
          bookingReference = result.bookingReference;
          orderId = result.orderId;
          totalAmount = result.totalAmount;
          totalCurrency = result.totalCurrency;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Cached-offer booking failed after payment — trying fresh search');
    }
  }

  // Attempt 2: fresh search
  if (!bookingReference && flightNumber && origin && destination && departureDate) {
    try {
      const result = await searchAndBookFlight(
        { flightNumber, origin, destination, departureDate },
        passengers,
        cabinClass as any,
      );
      if (result) {
        bookingReference = result.bookingReference;
        orderId = result.orderId;
        totalAmount = result.totalAmount;
        totalCurrency = result.totalCurrency;
      }
    } catch (err) {
      logger.error({ err }, 'Retry booking also failed after payment');
    }
  }

  if (bookingReference) {
    // Update booking record with confirmation
    await db
      .update(bookings)
      .set({
        status: 'booked',
        bookingReference,
        paymentStatus: 'paid',
        updatedAt: new Date(),
      })
      .where(eq(bookings.stripeSessionId, session.id));

    await sendText(
      whatsappTo,
      `✅ *Booking confirmed!*\n\n` +
      `Flight: ${flightNumber}\n` +
      `Route: ${origin} → ${destination}\n` +
      `Date: ${departureDate}\n` +
      `Booking reference: *${bookingReference}*\n` +
      (totalAmount && totalCurrency ? `Total charged: ${totalAmount} ${totalCurrency}\n` : '') +
      `\nYou'll receive your e-ticket by email. Have a great trip! ✈️`,
    );

    logger.info({ bookingReference, orderId, userId }, 'Flight booked after payment');
  } else {
    // Payment received but booking failed — user must be refunded manually
    await db
      .update(bookings)
      .set({ status: 'failed', paymentStatus: 'paid_unbooked', updatedAt: new Date() })
      .where(eq(bookings.stripeSessionId, session.id));

    await sendText(
      whatsappTo,
      `⚠️ Payment received, but the airline booking failed.\n\n` +
      `Flight: ${flightNumber} (${origin} → ${destination}, ${departureDate})\n\n` +
      `Our team will contact you within 24 hours to rebook or issue a full refund. ` +
      `Reference: ${session.id}`,
    );

    logger.error(
      { sessionId: session.id, flightNumber, userId },
      'Payment received but Duffel booking failed — requires manual intervention',
    );
  }
}
