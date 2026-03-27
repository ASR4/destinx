import { searchHotels } from '../search/hotels.js';
import { searchFlights } from '../search/flights.js';
import { searchRestaurants } from '../search/restaurants.js';
import { searchExperiences } from '../search/experiences.js';
import { searchTransport } from '../search/transport.js';
import { webSearch } from '../tools/web-search.js';
import { getWeather } from '../tools/weather.js';
import { generateTripPlan } from '../planning/planner.js';
import { startBookingSession } from '../booking/orchestrator.js';
import { upsertPreference } from '../memory/store.js';
import { logger } from '../../utils/logger.js';

type ToolInput = Record<string, unknown>;

interface ToolCallResult {
  toolUseId: string;
  result: string;
}

const TOOL_HANDLERS: Record<
  string,
  (input: ToolInput, context: { userId: string; userPhone: string }) => Promise<unknown>
> = {
  search_hotels: async (input) => searchHotels({
    destination: input.destination as string,
    checkIn: input.check_in as string,
    checkOut: input.check_out as string,
    guests: input.guests as number | undefined,
    budgetPerNight: input.budget_per_night as number | undefined,
    style: input.style as string | undefined,
  }),

  search_flights: async (input) => searchFlights({
    origin: input.origin as string,
    destination: input.destination as string,
    departureDate: input.departure_date as string,
    returnDate: input.return_date as string | undefined,
    passengers: input.passengers as number | undefined,
    cabinClass: input.cabin_class as string | undefined,
    preferredAirlines: input.preferred_airlines as string[] | undefined,
  }),

  search_restaurants: async (input) => searchRestaurants({
    location: input.location as string,
    cuisine: input.cuisine as string | undefined,
    priceLevel: input.price_level as 'budget' | 'moderate' | 'fine_dining' | undefined,
    dietary: input.dietary as string[] | undefined,
    meal: input.meal as 'breakfast' | 'lunch' | 'dinner' | 'brunch' | undefined,
  }),

  search_experiences: async (input) => searchExperiences({
    destination: input.destination as string,
    date: input.date as string | undefined,
    category: input.category as string | undefined,
    durationHours: input.duration_hours as number | undefined,
    budget: input.budget as number | undefined,
  }),

  search_transport: async (input) => searchTransport({
    from: input.from as string,
    to: input.to as string,
    date: input.date as string | undefined,
    preference: input.preference as 'fastest' | 'cheapest' | 'scenic' | 'most_comfortable' | undefined,
  }),

  web_search: async (input) => webSearch(input.query as string),

  check_weather: async (input) => {
    try {
      return await getWeather(input.location as string, input.date as string);
    } catch {
      return { error: 'Weather data not available' };
    }
  },

  create_trip_plan: async (input, ctx) => generateTripPlan(ctx.userId, {
    destination: input.destination as string,
    startDate: input.start_date as string,
    endDate: input.end_date as string,
    travelers: input.travelers as any[] | undefined,
    budgetTotal: input.budget_total as number | undefined,
    interests: input.interests as string[] | undefined,
    pace: input.pace as 'packed' | 'balanced' | 'relaxed' | undefined,
    mustDos: input.must_dos as string[] | undefined,
    avoid: input.avoid as string[] | undefined,
  }),

  initiate_booking: async (input, ctx) => startBookingSession(
    ctx.userId,
    ctx.userPhone,
    {
      type: input.booking_type as any,
      ...(input.details as Record<string, unknown>),
      userPhone: ctx.userPhone,
    } as any,
  ),

  save_preference: async (input, ctx) => {
    await upsertPreference(ctx.userId, {
      category: input.category as any,
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
  context: { userId: string; userPhone: string },
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
        return {
          toolUseId: call.id,
          result: JSON.stringify(result),
        };
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
  if (toolNames.includes('create_trip_plan')) return '📝 Putting together your itinerary...';
  if (toolNames.includes('initiate_booking')) return '🔗 Setting up your booking session...';
  if (toolNames.includes('web_search')) return '🔍 Researching that for you...';
  if (toolNames.includes('check_weather')) return '🌤️ Checking the weather...';
  return '✈️ Working on that...';
}
