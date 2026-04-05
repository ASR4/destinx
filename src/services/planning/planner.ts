import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../../ai/client.js';
import { getTravelAgentTools } from '../../ai/tools.js';
import { buildPlanningPrompt } from '../../ai/prompts/planning.js';
import { recallUserProfile } from '../memory/recall.js';
import { researchDestination } from './research.js';
import { executeToolCalls } from '../conversation/tool-executor.js';
import { validateTripPlan, buildStrictPlanPrompt } from './trip-schema.js';
import { AI } from '../../config/constants.js';

/** Max tool-loop iterations for the planner — it only needs a few searches. */
const MAX_PLANNING_TOOL_ITERATIONS = 4;

/** Tools the planner can use — search only, no booking/planning/save tools. */
const PLANNING_TOOL_NAMES = new Set([
  'search_hotels', 'search_flights', 'search_restaurants',
  'search_experiences', 'search_transport', 'check_weather', 'web_search',
]);
import { logger } from '../../utils/logger.js';
import type { PlanInput, Itinerary } from '../../types/trip.js';

/**
 * Generate a complete day-by-day trip itinerary using a multi-turn
 * Claude tool-use loop.
 *
 * Flow:
 * 1. Build planning prompt with user profile context
 * 2. Call Claude with search tools
 * 3. Execute any tool calls, feed results back
 * 4. Repeat until Claude returns a text-only response
 * 5. Parse and validate the plan against the Zod schema
 * 6. If validation fails, retry once with a stricter prompt
 */
export async function generateTripPlan(
  userId: string,
  input: PlanInput,
): Promise<Itinerary> {
  logger.info({ userId, destination: input.destination }, 'Generating trip plan');

  const [userProfile, research] = await Promise.all([
    recallUserProfile(userId),
    researchDestination(input.destination, input.startDate && input.endDate
      ? { start: input.startDate, end: input.endDate }
      : undefined,
    ).catch((err) => {
      logger.warn({ err }, 'Destination research failed — continuing without it');
      return undefined;
    }),
  ]);

  const anthropic = getAnthropicClient();
  const prompt = buildPlanningPrompt(input, userProfile, research);

  let messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  // Only give the planner search tools — no booking, planning, or save tools
  const plannerTools = getTravelAgentTools().filter((t) => PLANNING_TOOL_NAMES.has(t.name));

  let rawPlanText = '';

  for (let iteration = 0; iteration < MAX_PLANNING_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: AI.PLANNING_MODEL,
      max_tokens: AI.MAX_PLANNING_TOKENS,
      messages,
      tools: plannerTools,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );

    if (toolUseBlocks.length === 0) {
      rawPlanText = textBlocks.map((b) => b.text).join('\n');
      break;
    }

    const toolResults = await executeToolCalls(
      toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      })),
      { userId, userPhone: '' },
    );

    messages = [
      ...messages,
      { role: 'assistant' as const, content: response.content },
      {
        role: 'user' as const,
        content: toolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolUseId,
          content: tr.result,
        })),
      },
    ];

    if (textBlocks.length > 0 && response.stop_reason === 'end_turn') {
      rawPlanText = textBlocks.map((b) => b.text).join('\n');
      break;
    }
  }

  if (!rawPlanText) {
    logger.warn('Planning loop produced no text output');
    return { days: [] };
  }

  // Extract JSON from the response (Claude may wrap it in markdown code blocks)
  const jsonStr = extractJson(rawPlanText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn({ jsonStr: jsonStr.slice(0, 500) }, 'Failed to parse plan JSON, returning raw text as overview');
    return { days: [], overview: rawPlanText };
  }

  // Handle case where Claude wraps the plan in an extra key (e.g., { itinerary: { days: [...] } })
  const unwrapped = unwrapPlan(parsed);

  // Validate against the Zod schema (strict first, then lenient)
  const validation = validateTripPlan(unwrapped);
  if (validation.success) {
    return validation.plan;
  }

  // Retry once with stricter prompt
  logger.info({ errors: validation.errors }, 'Plan validation failed, retrying with stricter prompt');
  const retryResponse = await anthropic.messages.create({
    model: AI.PLANNING_MODEL,
    max_tokens: AI.MAX_PLANNING_TOKENS,
    messages: [
      ...messages,
      {
        role: 'user' as const,
        content: buildStrictPlanPrompt(validation.errors),
      },
    ],
  });

  const retryText = retryResponse.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const retryJson = extractJson(retryText);
  try {
    const retryParsed = JSON.parse(retryJson);
    const retryValidation = validateTripPlan(retryParsed);
    if (retryValidation.success) return retryValidation.plan;
    logger.warn({ errors: retryValidation.errors }, 'Retry validation also failed');
  } catch {
    logger.warn('Retry JSON parse also failed');
  }

  // Last resort: return whatever we have
  return (unwrapped as Itinerary) ?? { days: [], overview: rawPlanText };
}

/**
 * Claude sometimes nests the plan inside an extra key like { itinerary: { days: [...] } }
 * or { trip_plan: { days: [...] } }. Unwrap it if so.
 */
function unwrapPlan(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const obj = parsed as Record<string, unknown>;

  // Already has `days` — use as-is
  if (Array.isArray(obj.days)) return parsed;

  // Check common wrapper keys
  for (const key of ['itinerary', 'trip_plan', 'plan', 'trip']) {
    const inner = obj[key];
    if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>).days)) {
      return inner;
    }
  }

  return parsed;
}

function extractJson(text: string): string {
  // Try to find JSON inside markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1]!.trim();

  // Try to find a JSON object directly
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  return text;
}
