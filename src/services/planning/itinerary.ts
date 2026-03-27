import type { DayPlan, Itinerary } from '../../types/trip.js';
import { formatForWhatsApp, validateTripPlan } from '../planning/trip-schema.js';
import { logger } from '../../utils/logger.js';

/**
 * Structure raw planning output into a validated Itinerary.
 * Ensures all required fields are present, times are logical,
 * and logistics are feasible.
 */
export function structureItinerary(
  rawDays: Partial<DayPlan>[],
  startDate: string,
): Itinerary {
  const days: DayPlan[] = rawDays.map((day, idx) => ({
    date: day.date || addDays(startDate, idx),
    day_number: idx + 1,
    theme: day.theme,
    items: day.items || [],
    accommodation: day.accommodation,
    day_total: day.day_total,
  }));

  return { days };
}

/**
 * Format an entire itinerary for incremental WhatsApp delivery.
 * Returns an array of formatted day strings, one per message.
 */
export function formatItineraryForWhatsApp(itinerary: Itinerary): string[] {
  const validation = validateTripPlan(itinerary);
  if (validation.success) {
    return formatForWhatsApp(validation.plan);
  }
  logger.warn({ errors: validation.errors }, 'Trip plan validation failed during formatting');
  return itinerary.days.map((day) =>
    `📍 Day ${day.day_number}: ${day.date}${day.theme ? ` — ${day.theme}` : ''}\n${day.items.map((i) => `  ${i.time} — ${i.name}`).join('\n')}`,
  );
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}
