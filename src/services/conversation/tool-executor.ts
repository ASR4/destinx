import { eq } from 'drizzle-orm';
import { searchHotels } from '../search/hotels.js';
import { searchAndBookFlight, type FlightSearchParams, type DuffelPassenger } from '../search/flights.js';
import { DuffelFlightProvider } from '../booking/providers/flights/duffel.js';
import { storeSearchResults, getSearchResults } from '../booking/search-cache.js';
import { searchRestaurants } from '../search/restaurants.js';
import { searchExperiences } from '../search/experiences.js';
import { searchTransport } from '../search/transport.js';
import { webSearch } from '../tools/web-search.js';
import { getWeather } from '../tools/weather.js';
import { generateTripPlan } from '../planning/planner.js';
import { deliverTripPlan } from '../planning/delivery.js';
import { startBookingSession } from '../booking/orchestrator.js';
import { bookingQueue } from '../../jobs/queue.js';
import {
  checkUserBrowserLimit,
  acquireSystemBrowserSlot,
  releaseSystemBrowserSlot,
  RATE_LIMIT_MESSAGES,
} from '../rate-limiter.js';
import { createFlightCheckoutSession } from '../payments/stripe.js';
import { upsertPreference } from '../memory/store.js';
import { getDb } from '../../db/client.js';
import { trips, conversations, bookings } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import type { PlanInput, Itinerary } from '../../types/trip.js';
import type { ConversationFSMState } from '../../config/constants.js';

type ToolInput = Record<string, unknown>;

interface ToolCallResult {
  toolUseId: string;
  result: string;
}

export interface ToolContext {
  userId: string;
  userPhone: string;
  /** Present when called from the conversation engine — used to advance FSM state. */
  conversationId?: string;
}

const TOOL_HANDLERS: Record<
  string,
  (input: ToolInput, context: ToolContext) => Promise<unknown>
> = {
  search_hotels: async (input) =>
    searchHotels({
      destination: input.destination as string,
      checkIn: input.check_in as string,
      checkOut: input.check_out as string,
      guests: input.guests as number | undefined,
      budgetPerNight: input.budget_per_night as number | undefined,
      style: input.style as string | undefined,
    }),

  search_flights: async (input, ctx) => {
    const provider = new DuffelFlightProvider();
    const result = await provider.search({
      origin: input.origin as string,
      destination: input.destination as string,
      departureDate: input.departure_date as string,
      returnDate: input.return_date as string | undefined,
      passengers: input.passengers as number | undefined,
      cabinClass: input.cabin_class as FlightSearchParams['cabinClass'],
    });

    let searchId: string | undefined;
    if (ctx.conversationId && result.flights.length > 0) {
      searchId = await storeSearchResults(ctx.conversationId, provider.name, result.flights);
    }

    // Return searchId plus a human-readable list; raw Duffel IDs stay in Redis
    return {
      searchId,
      flights: result.flights.map((f) => ({
        flightNumber: f.flightNumber,
        airline: f.airline,
        departure: f.departure,
        arrival: f.arrival,
        duration: f.duration,
        stops: f.stops,
        price: f.price,
        cabinClass: f.cabinClass,
        conditions: f.conditions,
        expiresAt: f.expiresAt,
      })),
    };
  },

  search_restaurants: async (input) =>
    searchRestaurants({
      location: input.location as string,
      cuisine: input.cuisine as string | undefined,
      priceLevel: input.price_level as 'budget' | 'moderate' | 'fine_dining' | undefined,
      dietary: input.dietary as string[] | undefined,
      meal: input.meal as 'breakfast' | 'lunch' | 'dinner' | 'brunch' | undefined,
    }),

  search_experiences: async (input) =>
    searchExperiences({
      destination: input.destination as string,
      date: input.date as string | undefined,
      category: input.category as string | undefined,
      durationHours: input.duration_hours as number | undefined,
      budget: input.budget as number | undefined,
    }),

  search_transport: async (input) =>
    searchTransport({
      from: input.from as string,
      to: input.to as string,
      date: input.date as string | undefined,
      preference: input.preference as
        | 'fastest'
        | 'cheapest'
        | 'scenic'
        | 'most_comfortable'
        | undefined,
    }),

  web_search: async (input) =>
    webSearch(input.query as string, {
      freshness: input.freshness as string | undefined,
      count: input.count as number | undefined,
      country: input.country as string | undefined,
    }),

  check_weather: async (input) => {
    try {
      return await getWeather(input.location as string, input.date as string);
    } catch {
      return { error: 'Weather data not available' };
    }
  },

  /**
   * Generates a structured itinerary, saves it to the DB, delivers it
   * day-by-day via WhatsApp, and advances the FSM to reviewing_plan.
   * Returns a short summary to Claude so it can write an acknowledgement.
   */
  create_trip_plan: async (input, ctx) => {
    // Check for missing required fields before generating the plan
    const { checkTripPlanInput } = await import('./clarifier.js');
    const clarification = checkTripPlanInput({
      destination: input.destination as string | undefined,
      start_date: input.start_date as string | undefined,
      end_date: input.end_date as string | undefined,
      travelers: input.travelers,
      budget_total: input.budget_total as number | undefined,
      pace: input.pace as string | undefined,
    });

    if (clarification) {
      return {
        status: 'needs_clarification',
        missing: clarification.missing,
        message: clarification.question,
      };
    }

    const planInput: PlanInput = {
      destination: input.destination as string,
      startDate: input.start_date as string,
      endDate: input.end_date as string,
      travelers: input.travelers as PlanInput['travelers'],
      budgetTotal: input.budget_total as number | undefined,
      interests: input.interests as string[] | undefined,
      pace: input.pace as PlanInput['pace'],
      mustDos: input.must_dos as string[] | undefined,
      avoid: input.avoid as string[] | undefined,
    };

    const plan = await generateTripPlan(ctx.userId, planInput);
    const { destination } = planInput;

    const tripId = await saveTripPlan(ctx.userId, planInput, plan);

    // Send messages to the user before Claude writes its acknowledgement
    await deliverTripPlan(ctx.userPhone, plan, destination);

    if (ctx.conversationId) {
      await setConversationState(ctx.conversationId, 'reviewing_plan');
    }

    return {
      status: 'delivered',
      tripId,
      dayCount: plan.days.length,
      destination,
      message:
        'The itinerary has been sent to the user directly in WhatsApp. ' +
        'Briefly acknowledge it was delivered and invite them to reply ' +
        '"LOVE IT" to start booking or "CHANGE [what]" to modify anything.',
    };
  },

  book_flight: async (input, ctx) => {
    const searchId = input.search_id as string | undefined;
    const passengers = input.passengers as DuffelPassenger[];
    const flightNumber = input.flight_number as string | undefined;
    const origin = input.origin as string | undefined;
    const destination = input.destination as string | undefined;
    const departureDate = input.departure_date as string | undefined;
    const cabinClass = input.cabin_class as FlightSearchParams['cabinClass'];

    const isTestMode = (process.env.DUFFEL_API_KEY ?? '').startsWith('duffel_test');

    // --- Stripe-first flow (production) ---
    // If Stripe is configured, collect payment before booking with Duffel.
    // The webhook (checkout.session.completed) triggers the actual Duffel booking.
    if (process.env.STRIPE_SECRET_KEY && !isTestMode) {
      // Need the price from the cached offer to create an accurate Stripe charge
      let flightAmountRaw: number | null = null;
      let flightCurrency = 'usd';

      if (searchId && ctx.conversationId && flightNumber) {
        try {
          const cached = await getSearchResults(ctx.conversationId, searchId);
          if (cached) {
            const matchedOffer = cached.offers as Array<{ flightNumber: string; rawAmount?: string; rawCurrency?: string; price?: string }>;
            const offer = matchedOffer.find((o) => o.flightNumber === flightNumber);
            if (offer?.rawAmount) {
              flightAmountRaw = parseFloat(offer.rawAmount);
              flightCurrency = offer.rawCurrency ?? 'usd';
            }
          }
        } catch (err) {
          logger.warn({ err }, 'Could not retrieve cached offer for Stripe pricing');
        }
      }

      if (!flightAmountRaw) {
        return {
          status: 'price_unavailable',
          error: 'Could not determine the flight price for payment. Please search for flights again.',
        };
      }

      try {
        const { url: checkoutUrl, sessionId: stripeSessionId } = await createFlightCheckoutSession({
          searchId: searchId ?? '',
          flightNumber: flightNumber ?? '',
          origin: origin ?? '',
          destination: destination ?? '',
          departureDate: departureDate ?? '',
          cabinClass: cabinClass ?? 'economy',
          passengers,
          conversationId: ctx.conversationId ?? '',
          userId: ctx.userId,
          userPhone: ctx.userPhone,
          flightAmountRaw,
          flightCurrency,
        });

        // Store a pending booking record so we can update it when payment completes
        const db = getDb();
        await db.insert(bookings).values({
          tripId: await getActiveTripId(ctx.userId),
          userId: ctx.userId,
          type: 'flight',
          provider: 'duffel',
          status: 'pending_payment',
          details: {
            flightNumber, origin, destination, departureDate, cabinClass,
            searchId, passengerCount: passengers.length,
          },
          stripeSessionId,
          paymentStatus: 'pending',
        }).catch((err) => logger.warn({ err }, 'Failed to store pending booking record'));

        return {
          status: 'payment_required',
          checkoutUrl,
          message:
            'Payment link created. Send this URL to the user and ask them to complete payment. ' +
            'The flight will be booked automatically once payment is confirmed.',
        };
      } catch (err) {
        logger.error({ err }, 'Failed to create Stripe checkout session');
        return {
          status: 'failed',
          error: 'Could not create payment link. Please try again or contact support.',
        };
      }
    }

    // --- Direct booking flow (test mode or no Stripe configured) ---

    // Attempt 1: look up cached offer via searchId and book through the provider.
    if (searchId && ctx.conversationId && flightNumber) {
      try {
        const cached = await getSearchResults(ctx.conversationId, searchId);
        if (cached) {
          const matchedOffer = (cached.offers as Array<{ flightNumber: string }>).find(
            (o) => o.flightNumber === flightNumber,
          );
          if (matchedOffer) {
            const provider = new DuffelFlightProvider();
            const bookingResult = await provider.book(matchedOffer, passengers);
            return {
              status: 'confirmed',
              bookingReference: bookingResult.bookingReference,
              orderId: bookingResult.orderId,
              totalAmount: bookingResult.totalAmount,
              totalCurrency: bookingResult.totalCurrency,
            };
          }
          logger.warn({ searchId, flightNumber }, 'Flight number not found in cached search results, falling back to fresh search');
        } else {
          logger.warn({ searchId }, 'Cache miss for searchId, falling back to fresh search');
        }
      } catch (err) {
        logger.warn({ err }, 'Cached-offer booking failed, falling back to fresh search');
      }
    }

    // Attempt 2: fresh search + immediate book (handles expired offers or cache misses).
    if (flightNumber && origin && destination && departureDate) {
      logger.info({ flightNumber }, 'Re-searching for fresh offer');
      try {
        const retryResult = await searchAndBookFlight(
          { flightNumber, origin, destination, departureDate },
          passengers,
          cabinClass,
        );
        if (retryResult) {
          return {
            status: 'confirmed',
            bookingReference: retryResult.bookingReference,
            orderId: retryResult.orderId,
            totalAmount: retryResult.totalAmount,
            totalCurrency: retryResult.totalCurrency,
            note: `Price at booking: ${retryResult.price.amount} ${retryResult.price.currency}`,
          };
        }
      } catch (err) {
        logger.warn({ err }, 'Retry booking also failed');
      }
    }

    if (isTestMode) {
      return {
        status: 'failed',
        error:
          'The booking system is in test mode and cannot complete real airline bookings. ' +
          'Tell the user you found the flight and give them the airline, flight number, route, date, and price so they can book directly on the airline website.',
      };
    }

    return {
      status: 'failed',
      error:
        'The booking could not be completed — the airline system may be temporarily unavailable. ' +
        'Apologise and give the user the flight details (airline, flight number, route, date, price) so they can book directly on the airline website.',
    };
  },

  initiate_booking: async (input, ctx) => {
    if (input.booking_type === 'flight') {
      return {
        error: 'Do not use initiate_booking for flights. Use the book_flight tool instead — flights are booked directly via the Duffel API.',
      };
    }
    if (!process.env.BROWSERBASE_API_KEY) {
      return {
        error: 'Browser-based booking is not configured on this server. Provide the user with a direct link to book on the provider\'s website.',
      };
    }

    const [userLimit, systemSlot] = await Promise.all([
      checkUserBrowserLimit(ctx.userId),
      acquireSystemBrowserSlot(),
    ]);

    if (!userLimit.allowed) {
      return { error: RATE_LIMIT_MESSAGES.browser };
    }
    if (!systemSlot.allowed) {
      await releaseSystemBrowserSlot();
      return { error: RATE_LIMIT_MESSAGES.system };
    }

    const bookingDetails = {
      type: input.booking_type,
      ...(input.details as Record<string, unknown>),
      userPhone: ctx.userPhone,
    } as any;

    const { sessionId, liveViewUrl } = await startBookingSession(
      ctx.userId,
      ctx.userPhone,
      bookingDetails,
    );

    // Session creation failed (deep-link fallback already sent to user)
    if (!sessionId) {
      await releaseSystemBrowserSlot();
      return { status: 'fallback_sent', message: 'Direct booking links have been sent to the user.' };
    }

    // Enqueue the actual browser automation — this is what was missing
    await bookingQueue.add('execute', {
      sessionId,
      userId: ctx.userId,
      userPhone: ctx.userPhone,
      booking: bookingDetails,
    });

    return {
      status: 'session_created',
      sessionId,
      liveViewUrl,
      message: 'Browser booking session started. The automation is running — confirmation will be sent to the user when complete.',
    };
  },

  modify_trip_plan: async (input, _ctx) => {
    const tripId = input.trip_id as string;
    const modification = input.modification as string;

    const db = getDb();
    const rows = await db
      .select({ plan: trips.plan })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);

    if (rows.length === 0) {
      return { error: `Trip ${tripId} not found` };
    }

    const currentPlan = rows[0]!.plan as Itinerary;
    const { modifyItinerary } = await import('../planning/modifier.js');
    const { itinerary, changedDays, summary } = await modifyItinerary(currentPlan, modification);

    await db
      .update(trips)
      .set({ plan: itinerary as unknown as typeof trips.$inferInsert['plan'], updatedAt: new Date() })
      .where(eq(trips.id, tripId));

    logger.info({ tripId, changedDays }, 'Trip plan modified');
    return { success: true, changedDays, summary };
  },

  search_events: async (input) => {
    const { searchEvents } = await import('../tools/events.js');
    return searchEvents(
      input.destination as string,
      { start: input.start_date as string, end: input.end_date as string },
      input.category as string | undefined,
    );
  },

  generate_itinerary_pdf: async (input, ctx) => {
    const tripId = input.trip_id as string;
    const title = (input.title as string | undefined) ?? 'Trip Itinerary';

    const db = getDb();
    const rows = await db
      .select({ plan: trips.plan, destination: trips.destination })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);

    if (rows.length === 0) {
      return { error: `Trip ${tripId} not found` };
    }

    const plan = rows[0]!.plan as Itinerary;
    const pdfTitle = title || `${rows[0]!.destination ?? 'Trip'} Itinerary`;

    const { generateItineraryPdf } = await import('../planning/pdf.js');
    const url = await generateItineraryPdf(plan, pdfTitle);

    // Send the PDF link via WhatsApp
    const { sendMedia } = await import('../whatsapp/sender.js');
    const { toWhatsAppAddress } = await import('../../utils/phone.js');
    await sendMedia(
      toWhatsAppAddress(ctx.userPhone),
      url,
      `📄 Here's your trip itinerary PDF: ${pdfTitle}`,
    );

    return { success: true, url };
  },

  save_preference: async (input, ctx) => {
    await upsertPreference(ctx.userId, {
      category: input.category as Parameters<typeof upsertPreference>[1]['category'],
      key: input.key as string,
      value: input.value as string,
      confidence: (input.confidence as number) ?? 0.7,
      source: 'explicit',
    });
    return { saved: true };
  },
};

/**
 * Execute a batch of tool calls in parallel where possible.
 * Returns results keyed by tool_use_id.
 */
export async function executeToolCalls(
  toolCalls: Array<{ id: string; name: string; input: ToolInput }>,
  context: ToolContext,
): Promise<ToolCallResult[]> {
  const results = await Promise.allSettled(
    toolCalls.map(async (call) => {
      const handler = TOOL_HANDLERS[call.name];
      if (!handler) {
        return {
          toolUseId: call.id,
          result: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
        };
      }

      try {
        const result = await handler(call.input, context);
        return { toolUseId: call.id, result: JSON.stringify(result) };
      } catch (err) {
        logger.error({ err, tool: call.name }, 'Tool execution failed');
        return {
          toolUseId: call.id,
          result: JSON.stringify({
            error: `Tool ${call.name} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          }),
        };
      }
    }),
  );

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { toolUseId: 'unknown', result: JSON.stringify({ error: 'Tool execution failed' }) },
  );
}

/**
 * Generate a contextual holding message based on which tools are being called.
 */
export function getHoldingMessage(toolNames: string[]): string {
  if (toolNames.includes('search_flights')) return '🔍 Checking flight options...';
  if (toolNames.includes('search_hotels')) return '🏨 Looking up hotels...';
  if (toolNames.includes('search_restaurants')) return '🍽️ Finding restaurants...';
  if (toolNames.includes('search_experiences')) return '🎭 Searching for experiences...';
  if (toolNames.includes('search_transport')) return '🚕 Checking transport options...';
  if (toolNames.includes('create_trip_plan')) return '📝 Putting together your itinerary...';
  if (toolNames.includes('modify_trip_plan')) return '✏️ Updating your itinerary...';
  if (toolNames.includes('generate_itinerary_pdf')) return '📄 Generating your PDF itinerary...';
  if (toolNames.includes('search_events')) return '🎟️ Looking up events...';
  if (toolNames.includes('initiate_booking')) return '🔗 Setting up your booking session...';
  if (toolNames.includes('web_search')) return '🔍 Researching that for you...';
  if (toolNames.includes('check_weather')) return '🌤️ Checking the weather...';
  return '✈️ Working on that...';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function saveTripPlan(
  userId: string,
  input: PlanInput,
  plan: Itinerary,
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(trips)
    .values({
      userId,
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'planning',
      plan: plan as unknown as Record<string, unknown>,
      budget: input.budgetTotal
        ? { total: input.budgetTotal, currency: 'USD' }
        : undefined,
      travelers: input.travelers as unknown as Record<string, unknown>[] | undefined,
    })
    .returning({ id: trips.id });

  if (!row) throw new Error('Failed to insert trip');
  logger.info({ tripId: row.id, destination: input.destination }, 'Trip saved');
  return row.id;
}

/**
 * Get the most recent trip for a user, or create a minimal placeholder trip if none exists.
 * The bookings table has a NOT NULL FK to trips, so we must always have a valid tripId.
 */
async function getActiveTripId(userId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(trips.createdAt)
    .limit(1);

  if (rows[0]?.id) return rows[0].id;

  // No trip yet — create a placeholder so the FK constraint is satisfied
  const [newTrip] = await db
    .insert(trips)
    .values({ userId, destination: 'Unknown', plan: {} })
    .returning({ id: trips.id });

  return newTrip!.id;
}

async function setConversationState(
  conversationId: string,
  state: ConversationFSMState,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const existing = (row?.context as Record<string, unknown>) ?? {};
  await db
    .update(conversations)
    .set({ context: { ...existing, fsmState: state }, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
