import { eq } from 'drizzle-orm';
import { searchHotels } from '../search/hotels.js';
import { searchFlights, bookFlight, searchAndBookFlight, type FlightSearchParams, type DuffelPassenger } from '../search/flights.js';
import { searchRestaurants } from '../search/restaurants.js';
import { searchExperiences } from '../search/experiences.js';
import { searchTransport } from '../search/transport.js';
import { webSearch } from '../tools/web-search.js';
import { getWeather } from '../tools/weather.js';
import { generateTripPlan } from '../planning/planner.js';
import { deliverTripPlan } from '../planning/delivery.js';
import { startBookingSession } from '../booking/orchestrator.js';
import { upsertPreference } from '../memory/store.js';
import { getDb } from '../../db/client.js';
import { trips, conversations } from '../../db/schema.js';
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

  search_flights: async (input) =>
    searchFlights({
      origin: input.origin as string,
      destination: input.destination as string,
      departureDate: input.departure_date as string,
      returnDate: input.return_date as string | undefined,
      passengers: input.passengers as number | undefined,
      cabinClass: input.cabin_class as FlightSearchParams['cabinClass'],
    }),

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

  book_flight: async (input) => {
    const offerId = input.offer_id as string;
    const passengers = input.passengers as DuffelPassenger[];

    // First attempt: use the original offer ID.
    // bookFlight() throws on non-retriable errors (missing API key, Duffel API errors).
    // It returns null only when the offer has expired — which we can retry.
    const directResult = await bookFlight(offerId, passengers);
    if (directResult) {
      return {
        status: 'confirmed',
        bookingReference: directResult.bookingReference,
        orderId: directResult.orderId,
        totalAmount: directResult.totalAmount,
        totalCurrency: directResult.totalCurrency,
      };
    }

    // Offer expired — retry with fresh search if we have enough context
    const flightNumber = input.flight_number as string | undefined;
    const origin = input.origin as string | undefined;
    const destination = input.destination as string | undefined;
    const departureDate = input.departure_date as string | undefined;

    if (flightNumber && origin && destination && departureDate) {
      logger.info({ flightNumber }, 'Offer expired, re-searching for fresh offer');
      const retryResult = await searchAndBookFlight(
        { flightNumber, origin, destination, departureDate },
        passengers,
        input.cabin_class as FlightSearchParams['cabinClass'],
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
      return {
        status: 'failed',
        error: 'The original offer expired and the same flight could not be found in a fresh search. Ask the user if they would like to search for alternatives.',
      };
    }

    return {
      status: 'failed',
      error: 'The flight offer has expired. Ask the user to confirm they still want this flight, then use search_flights to get a fresh offer before booking.',
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
    return startBookingSession(ctx.userId, ctx.userPhone, {
      type: input.booking_type,
      ...(input.details as Record<string, unknown>),
      userPhone: ctx.userPhone,
    } as any);
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
