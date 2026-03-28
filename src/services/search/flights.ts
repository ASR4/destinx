import { logger } from '../../utils/logger.js';

const DUFFEL_BASE = 'https://api.duffel.com';

function duffelHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.DUFFEL_API_KEY ?? ''}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export interface FlightOffer {
  offerId: string;    // Duffel offer ID — required for booking
  expiresAt: string;  // ISO 8601 — check before booking
  airline: string;
  flightNumber: string;
  departure: { airport: string; time: string };
  arrival: { airport: string; time: string };
  duration: string;
  stops: number;
  price: { amount: number; currency: string };
  cabinClass: string;
  conditions: {
    refundable: boolean;
    changeable: boolean;
  };
  passengerIds: string[];
  rawAmount: string;
  rawCurrency: string;
}

export interface FlightSearchParams {
  origin: string;       // IATA airport or city code
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  passengers?: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

export interface DuffelPassenger {
  given_name: string;
  family_name: string;
  born_on: string;       // YYYY-MM-DD
  gender: 'm' | 'f';
  email: string;         // must be the passenger's own email
  phone_number: string;  // E.164 format e.g. +14155552671
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
}

export interface FlightBookingResult {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
}

/**
 * Search for flights using the Duffel Flights API.
 * Returns up to 10 offers sorted by price ascending.
 */
export async function searchFlights(
  params: FlightSearchParams,
): Promise<FlightOffer[]> {
  if (!process.env.DUFFEL_API_KEY) {
    logger.error('DUFFEL_API_KEY not set');
    return [];
  }

  logger.info({ origin: params.origin, dest: params.destination }, 'Searching flights via Duffel');

  const slices: Array<{ origin: string; destination: string; departure_date: string }> = [
    {
      origin: params.origin.toUpperCase(),
      destination: params.destination.toUpperCase(),
      departure_date: params.departureDate,
    },
  ];

  if (params.returnDate) {
    slices.push({
      origin: params.destination.toUpperCase(),
      destination: params.origin.toUpperCase(),
      departure_date: params.returnDate,
    });
  }

  const passengerCount = params.passengers ?? 1;
  const passengers = Array.from({ length: passengerCount }, () => ({ type: 'adult' as const }));

  try {
    const res = await fetch(
      `${DUFFEL_BASE}/air/offer_requests?return_offers=true&supplier_timeout=25000`,
      {
        method: 'POST',
        headers: duffelHeaders(),
        body: JSON.stringify({
          data: {
            slices,
            passengers,
            cabin_class: params.cabinClass ?? 'economy',
            max_connections: 1,
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'Duffel offer request failed');
      return [];
    }

    const json = (await res.json()) as { data: { offers: DuffelOfferRaw[] } };
    const offers = json.data.offers ?? [];

    return offers
      .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
      .slice(0, 10)
      .map(mapDuffelOffer);
  } catch (err) {
    logger.error({ err }, 'Flight search failed');
    return [];
  }
}

/**
 * Book a flight using a Duffel offer ID obtained from searchFlights.
 * Uses the passenger IDs and price from the search response directly — no
 * re-fetch — to eliminate the race condition where Duffel test-mode offers
 * expire within seconds.
 *
 * Returns null on ANY Duffel error so the caller's retry logic always runs.
 * Only throws for truly fatal conditions (missing API key).
 */
export async function bookFlight(
  offer: { offerId: string; passengerIds: string[]; rawAmount: string; rawCurrency: string },
  passengers: DuffelPassenger[],
): Promise<FlightBookingResult | null> {
  if (!process.env.DUFFEL_API_KEY) {
    throw new Error('Flight booking is not available — DUFFEL_API_KEY is not configured on this server.');
  }

  const orderPassengers = passengers.map((p, i) => ({
    id: offer.passengerIds[i]!,
    ...p,
  }));

  logger.info(
    { offerId: offer.offerId, amount: offer.rawAmount, currency: offer.rawCurrency },
    'Creating Duffel order (no re-fetch)',
  );

  try {
    const orderRes = await fetch(`${DUFFEL_BASE}/air/orders`, {
      method: 'POST',
      headers: duffelHeaders(),
      body: JSON.stringify({
        data: {
          type: 'instant',
          selected_offers: [offer.offerId],
          payments: [
            {
              type: 'balance',
              currency: offer.rawCurrency,
              amount: offer.rawAmount,
            },
          ],
          passengers: orderPassengers,
        },
      }),
    });

    if (!orderRes.ok) {
      const body = await orderRes.text();
      logger.error(`Duffel order creation failed: HTTP ${orderRes.status} — ${body}`);
      return null;
    }

    const { data: order } = (await orderRes.json()) as {
      data: {
        id: string;
        booking_reference: string;
        total_amount: string;
        total_currency: string;
      };
    };

    logger.info(
      { orderId: order.id, ref: order.booking_reference },
      'Flight booked successfully via Duffel',
    );

    return {
      orderId: order.id,
      bookingReference: order.booking_reference,
      totalAmount: order.total_amount,
      totalCurrency: order.total_currency,
    };
  } catch (err) {
    logger.error({ err, offerId: offer.offerId }, 'Duffel order request failed (network/parse error)');
    return null;
  }
}

/**
 * Search-and-book: re-searches for the same flight, finds a fresh offer
 * matching the original flight number, and books it in one shot.
 * This handles the common case where the original offer expired while
 * Claude was collecting passenger details.
 */
export async function searchAndBookFlight(
  originalOffer: { flightNumber: string; origin: string; destination: string; departureDate: string },
  passengers: DuffelPassenger[],
  cabinClass?: FlightSearchParams['cabinClass'],
): Promise<FlightBookingResult & { price: { amount: number; currency: string } } | null> {
  logger.info({ flight: originalOffer.flightNumber }, 'Re-searching for fresh offer before booking');

  const freshOffers = await searchFlights({
    origin: originalOffer.origin,
    destination: originalOffer.destination,
    departureDate: originalOffer.departureDate,
    passengers: passengers.length,
    cabinClass,
  });

  const match = freshOffers.find((o) => o.flightNumber === originalOffer.flightNumber);
  if (!match) {
    logger.warn({ flight: originalOffer.flightNumber }, 'Original flight no longer available in fresh search');
    return null;
  }

  logger.info(
    { offerId: match.offerId, price: match.price, flight: match.flightNumber },
    'Found fresh offer, booking immediately',
  );

  const result = await bookFlight(
    {
      offerId: match.offerId,
      passengerIds: match.passengerIds,
      rawAmount: match.rawAmount,
      rawCurrency: match.rawCurrency,
    },
    passengers,
  );
  if (!result) return null;

  return { ...result, price: match.price };
}

// ── Internal Duffel response types ───────────────────────────────────

interface DuffelOfferRaw {
  id: string;
  expires_at: string;
  total_amount: string;
  total_currency: string;
  cabin_class?: string;
  passengers: Array<{ id: string; type: string }>;
  slices: Array<{
    duration: string;
    segments: Array<{
      departing_at: string;
      arriving_at: string;
      origin: { iata_code: string };
      destination: { iata_code: string };
      operating_carrier: { name: string; iata_code: string };
      operating_carrier_flight_number: string;
    }>;
  }>;
  conditions: {
    refund_before_departure: { allowed: boolean } | null;
    change_before_departure: { allowed: boolean } | null;
  };
}

function mapDuffelOffer(offer: DuffelOfferRaw): FlightOffer {
  const firstSlice = offer.slices[0]!;
  const firstSeg = firstSlice.segments[0]!;
  const lastSeg = firstSlice.segments[firstSlice.segments.length - 1]!;

  return {
    offerId: offer.id,
    expiresAt: offer.expires_at,
    airline: firstSeg.operating_carrier.name,
    flightNumber: `${firstSeg.operating_carrier.iata_code}${firstSeg.operating_carrier_flight_number}`,
    departure: {
      airport: firstSeg.origin.iata_code,
      time: firstSeg.departing_at,
    },
    arrival: {
      airport: lastSeg.destination.iata_code,
      time: lastSeg.arriving_at,
    },
    duration: formatDuration(firstSlice.duration),
    stops: firstSlice.segments.length - 1,
    price: {
      amount: parseFloat(offer.total_amount),
      currency: offer.total_currency,
    },
    cabinClass: offer.cabin_class ?? 'economy',
    conditions: {
      refundable: offer.conditions.refund_before_departure?.allowed ?? false,
      changeable: offer.conditions.change_before_departure?.allowed ?? false,
    },
    passengerIds: offer.passengers.map((p) => p.id),
    rawAmount: offer.total_amount,
    rawCurrency: offer.total_currency,
  };
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const hours = match[1] ? `${match[1]}h` : '';
  const minutes = match[2] ? `${match[2]}m` : '';
  return `${hours}${minutes}` || isoDuration;
}
