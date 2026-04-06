import { logger } from '../../utils/logger.js';
import { withRetry, isCircuitOpen } from '../../utils/errors.js';
import type { Itinerary, DayPlan, DayItem, Budget } from '../../types/trip.js';

export interface ValidationIssue {
  type: 'venue' | 'logistics' | 'hours' | 'budget' | 'pace';
  severity: 'warning' | 'error';
  day?: number;
  item?: string;
  message: string;
  autoFixable: boolean;
  fix?: string;
}

export interface ValidationResult {
  valid: boolean;
  confidence: 'high' | 'medium' | 'low';
  issues: ValidationIssue[];
  checkedVenues: number;
  checkedLogistics: number;
  summary: string;
}

const PACE_LIMITS: Record<string, number> = {
  packed: 8,
  balanced: 5,
  relaxed: 3,
};

/**
 * Validate a trip plan for common issues:
 * 1. Pace check — too many activities per day
 * 2. Budget check — costs exceed stated budget
 * 3. Logistics check — impossible travel times between consecutive items
 * 4. Venue existence check — verify via Google Places (when API key available)
 */
export async function validatePlan(
  itinerary: Itinerary,
  options?: {
    budget?: Budget;
    pace?: string;
    destination?: string;
  },
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  let checkedVenues = 0;
  let checkedLogistics = 0;

  for (const day of itinerary.days) {
    // Pace check
    const activityCount = day.items.filter((i) => i.type !== 'free_time').length;
    const pace = options?.pace ?? 'balanced';
    const limit = PACE_LIMITS[pace] ?? PACE_LIMITS.balanced!;

    if (activityCount > limit) {
      issues.push({
        type: 'pace',
        severity: 'warning',
        day: day.day_number,
        message: `Day ${day.day_number} has ${activityCount} activities — may be too packed for a ${pace} pace`,
        autoFixable: false,
      });
    }

    // Logistics check — time gaps between consecutive items
    for (let i = 0; i < day.items.length - 1; i++) {
      const current = day.items[i]!;
      const next = day.items[i + 1]!;

      const currentEndMinutes = parseTimeToMinutes(current.time) + (current.duration_min ?? 60);
      const nextStartMinutes = parseTimeToMinutes(next.time);

      if (nextStartMinutes > 0 && currentEndMinutes > 0) {
        const gap = nextStartMinutes - currentEndMinutes;
        if (gap < 0) {
          issues.push({
            type: 'logistics',
            severity: 'error',
            day: day.day_number,
            item: next.name,
            message: `Day ${day.day_number}: "${current.name}" and "${next.name}" overlap — ${current.name} ends at ${minutesToTime(currentEndMinutes)} but ${next.name} starts at ${next.time}`,
            autoFixable: true,
            fix: `Shift "${next.name}" to ${minutesToTime(currentEndMinutes + 15)}`,
          });
        } else if (gap < 15 && current.type !== 'transport' && next.type !== 'transport') {
          issues.push({
            type: 'logistics',
            severity: 'warning',
            day: day.day_number,
            item: next.name,
            message: `Day ${day.day_number}: Only ${gap} minutes between "${current.name}" and "${next.name}" — may not allow enough travel time`,
            autoFixable: false,
          });
        }
        checkedLogistics++;
      }
    }
  }

  // Budget check
  if (options?.budget?.total) {
    let totalCost = 0;
    for (const day of itinerary.days) {
      if (day.day_total) {
        totalCost += day.day_total.amount;
      } else {
        for (const item of day.items) {
          if (item.price) totalCost += item.price.amount;
        }
      }
    }

    if (totalCost > 0) {
      const budgetLimit = options.budget.total;
      const overagePercent = ((totalCost - budgetLimit) / budgetLimit) * 100;

      if (overagePercent > 15) {
        issues.push({
          type: 'budget',
          severity: 'error',
          message: `Total estimated cost ($${totalCost.toLocaleString()}) exceeds budget ($${budgetLimit.toLocaleString()}) by ${Math.round(overagePercent)}%`,
          autoFixable: false,
        });
      } else if (overagePercent > 0) {
        issues.push({
          type: 'budget',
          severity: 'warning',
          message: `Total estimated cost ($${totalCost.toLocaleString()}) is slightly over budget ($${budgetLimit.toLocaleString()}) by ${Math.round(overagePercent)}%`,
          autoFixable: false,
        });
      }
    }
  }

  // Venue existence check (when Google Places API is available)
  if (process.env.GOOGLE_MAPS_API_KEY && !isCircuitOpen('google_places')) {
    const namedVenues = itinerary.days.flatMap((d) =>
      d.items
        .filter((i) => i.type === 'restaurant' || i.type === 'experience' || i.type === 'hotel')
        .map((i) => ({ name: i.name, day: d.day_number, type: i.type })),
    );

    const venuesToCheck = namedVenues.slice(0, 10);
    for (const venue of venuesToCheck) {
      try {
        const exists = await checkVenueExists(venue.name, options?.destination);
        checkedVenues++;
        if (!exists) {
          issues.push({
            type: 'venue',
            severity: 'warning',
            day: venue.day,
            item: venue.name,
            message: `Could not verify "${venue.name}" — it may have moved or closed`,
            autoFixable: false,
          });
        }
      } catch {
        // Skip venue check on API failure
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  let confidence: ValidationResult['confidence'];
  if (errorCount > 0) confidence = 'low';
  else if (warningCount > 2) confidence = 'medium';
  else confidence = 'high';

  const valid = errorCount === 0;

  let summary: string;
  if (valid && warningCount === 0) {
    summary = "I've verified travel times and checked the plan — everything looks solid ✓";
  } else if (valid) {
    summary = `Plan looks good with ${warningCount} minor note${warningCount > 1 ? 's' : ''} to consider`;
  } else {
    summary = `Found ${errorCount} issue${errorCount > 1 ? 's' : ''} that should be addressed`;
  }

  logger.info({ valid, confidence, errorCount, warningCount, checkedVenues, checkedLogistics }, 'Plan validation complete');

  return { valid, confidence, issues, checkedVenues, checkedLogistics, summary };
}

/**
 * Apply auto-fixes where possible and return the fixed itinerary.
 */
export function applyAutoFixes(itinerary: Itinerary, issues: ValidationIssue[]): Itinerary {
  const fixed = JSON.parse(JSON.stringify(itinerary)) as Itinerary;
  const autoFixable = issues.filter((i) => i.autoFixable && i.fix && i.day);

  for (const issue of autoFixable) {
    if (issue.type === 'logistics' && issue.item && issue.day) {
      const day = fixed.days.find((d) => d.day_number === issue.day);
      if (!day) continue;

      const timeMatch = issue.fix?.match(/(\d{1,2}:\d{2})/);
      if (!timeMatch) continue;

      const item = day.items.find((i) => i.name === issue.item);
      if (item) {
        item.time = timeMatch[1]!;
      }
    }
  }

  return fixed;
}

async function checkVenueExists(venueName: string, destination?: string): Promise<boolean> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return true; // can't check, assume exists

  const query = destination ? `${venueName} ${destination}` : venueName;

  try {
    const response = await withRetry(
      () => fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=name,business_status&key=${apiKey}`),
      { maxRetries: 1, baseDelayMs: 1000 },
    );

    const data = await response.json() as { candidates?: Array<{ business_status?: string }> };

    if (!data.candidates || data.candidates.length === 0) return false;

    const status = data.candidates[0]?.business_status;
    if (status === 'CLOSED_PERMANENTLY') return false;

    return true;
  } catch {
    return true; // on error, don't flag venue
  }
}

function parseTimeToMinutes(time: string): number {
  const match = time?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
