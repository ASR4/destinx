import Stripe from 'stripe';
import { logger } from '../../utils/logger.js';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key);
  return _stripe;
}

export interface PendingFlightBooking {
  /** Duffel search ID to retrieve cached offer */
  searchId: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  cabinClass: string;
  passengers: Array<{
    title: string;
    given_name: string;
    family_name: string;
    born_on: string;
    gender: string;
    email: string;
    phone_number: string;
  }>;
  conversationId: string;
  userId: string;
  userPhone: string;
  /** Raw amount in major currency unit from Duffel (e.g. 342.50) */
  flightAmountRaw: number;
  flightCurrency: string;
}

/**
 * Create a Stripe Checkout Session for a flight booking.
 *
 * Charges: flight cost + service fee.
 * All booking metadata is embedded in the session so the webhook can trigger Duffel.
 *
 * Returns the checkout URL to send to the user.
 */
export async function createFlightCheckoutSession(
  booking: PendingFlightBooking,
): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();

  const serviceFee = parseInt(process.env.STRIPE_SERVICE_FEE_CENTS ?? '1500', 10);

  // Convert flight amount to cents (Stripe always uses smallest currency unit)
  const flightAmountCents = Math.round(booking.flightAmountRaw * 100);
  const totalCents = flightAmountCents + serviceFee;

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: booking.flightCurrency.toLowerCase(),
          unit_amount: flightAmountCents,
          product_data: {
            name: `Flight ${booking.flightNumber}`,
            description: `${booking.origin} → ${booking.destination} on ${booking.departureDate}`,
          },
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: booking.flightCurrency.toLowerCase(),
          unit_amount: serviceFee,
          product_data: {
            name: 'Destinx Service Fee',
            description: 'Booking assistance fee',
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      searchId: booking.searchId,
      flightNumber: booking.flightNumber,
      origin: booking.origin,
      destination: booking.destination,
      departureDate: booking.departureDate,
      cabinClass: booking.cabinClass,
      conversationId: booking.conversationId,
      userId: booking.userId,
      userPhone: booking.userPhone,
      // Encode passengers as JSON string (Stripe metadata values must be strings)
      passengers: JSON.stringify(booking.passengers),
    },
    success_url: `${appUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');

  logger.info(
    { sessionId: session.id, flightNumber: booking.flightNumber, totalCents },
    'Stripe checkout session created',
  );

  return { url: session.url, sessionId: session.id };
}

/**
 * Verify and construct a Stripe webhook event.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
