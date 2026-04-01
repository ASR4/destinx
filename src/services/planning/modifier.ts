import { getAnthropicClient } from '../../ai/client.js';
import { AI } from '../../config/constants.js';
import { validateTripPlan } from './trip-schema.js';
import { logger } from '../../utils/logger.js';
import type { Itinerary, DayPlan } from '../../types/trip.js';

interface ModificationResult {
  itinerary: Itinerary;
  changedDays: number[]; // day_numbers that changed
  summary: string;        // human-readable change summary
}

/**
 * Apply a natural-language modification request to an existing itinerary.
 *
 * Uses Claude to produce a precise delta (only changed days), then merges
 * back into the original itinerary. Falls back to re-delivering the same
 * itinerary unchanged if the modification cannot be applied.
 *
 * Examples:
 * - "Move the Nikko day trip to day 2 instead of day 3"
 * - "Replace Ichiran Ramen with something vegetarian"
 * - "Add a morning yoga session on day 1"
 * - "Make day 2 more relaxed — fewer activities"
 */
export async function modifyItinerary(
  current: Itinerary,
  modificationRequest: string,
): Promise<ModificationResult> {
  const prompt = buildModificationPrompt(current, modificationRequest);

  let raw: string;
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI.PLANNING_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((c) => c.type === 'text');
    raw = textBlock?.text ?? '';
  } catch (err) {
    logger.error({ err }, 'Failed to get modification from Claude');
    return {
      itinerary: current,
      changedDays: [],
      summary: 'Unable to apply modification — returning original itinerary.',
    };
  }

  // Extract JSON delta from Claude's response
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    logger.warn({ raw }, 'No JSON found in modification response');
    return {
      itinerary: current,
      changedDays: [],
      summary: raw.trim().slice(0, 200),
    };
  }

  let delta: { changed_days: DayPlan[]; summary: string };
  try {
    delta = JSON.parse(jsonMatch[1]!);
  } catch (err) {
    logger.warn({ err, raw }, 'Failed to parse modification delta JSON');
    return {
      itinerary: current,
      changedDays: [],
      summary: 'Could not parse modification — returning original itinerary.',
    };
  }

  // Merge delta days into original itinerary
  const changedDayNumbers = delta.changed_days.map((d) => d.day_number);
  const mergedDays = current.days.map((day) => {
    const updated = delta.changed_days.find((d) => d.day_number === day.day_number);
    return updated ?? day;
  });

  // Handle new days appended (e.g. trip extension)
  for (const newDay of delta.changed_days) {
    if (!current.days.some((d) => d.day_number === newDay.day_number)) {
      mergedDays.push(newDay);
    }
  }

  mergedDays.sort((a, b) => a.day_number - b.day_number);

  const updatedItinerary: Itinerary = {
    ...current,
    days: mergedDays,
  };

  // Validate the result
  const validation = validateTripPlan(updatedItinerary);
  if (!validation.success) {
    logger.warn({ errors: validation.errors }, 'Modified itinerary failed validation');
    return {
      itinerary: current,
      changedDays: [],
      summary: 'Modification produced an invalid itinerary — returning original.',
    };
  }

  return {
    itinerary: validation.plan,
    changedDays: changedDayNumbers,
    summary: delta.summary ?? `Modified days: ${changedDayNumbers.join(', ')}`,
  };
}

function buildModificationPrompt(itinerary: Itinerary, request: string): string {
  return `You are modifying an existing travel itinerary based on a user request.

## Current Itinerary
\`\`\`json
${JSON.stringify(itinerary, null, 2)}
\`\`\`

## Modification Request
"${request}"

## Instructions
1. Apply the requested change. Only modify what's necessary — preserve everything else.
2. Return ONLY the days that changed (the delta), not the full itinerary.
3. Keep the same structure: each day must have date, day_number, and items array.
4. Each item needs at minimum: time (HH:MM), type (flight/hotel/experience/restaurant/transport/free_time), name.
5. Provide a short, friendly summary of what changed (1-2 sentences).

## Response Format
Respond with a brief explanation then a JSON code block:

\`\`\`json
{
  "changed_days": [<only the day objects that changed>],
  "summary": "<1-2 sentence human-readable summary of what changed>"
}
\`\`\`

If the modification cannot be applied (e.g., date conflict, impossible request), return an empty changed_days array and explain why in the summary.`;
}
