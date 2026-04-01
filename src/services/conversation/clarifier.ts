import { getAnthropicClient } from '../../ai/client.js';
import { buildClarificationPrompt } from '../../ai/prompts/clarification.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

export interface ClarificationNeeded {
  missing: string[];
  question: string;
}

interface TripPlanInput {
  destination?: string;
  start_date?: string;
  end_date?: string;
  travelers?: unknown;
  budget_total?: number;
  pace?: string;
}

/**
 * Synchronous check of `create_trip_plan` inputs for missing required fields.
 * Returns null if the input is complete enough to proceed, or a structured
 * clarification object so the tool handler can return early with a question.
 */
export function checkTripPlanInput(input: TripPlanInput): ClarificationNeeded | null {
  const missing: string[] = [];
  const questions: string[] = [];

  if (!input.destination || String(input.destination).trim().length < 2) {
    missing.push('destination');
    questions.push('Where would you like to go?');
  }

  if (!input.start_date || !isValidDate(input.start_date)) {
    missing.push('start_date');
    questions.push('When are you planning to travel?');
  }

  if (!input.end_date || !isValidDate(input.end_date)) {
    missing.push('end_date');
    questions.push('When do you return? (or how many nights?)');
  }

  if (
    input.start_date && input.end_date &&
    isValidDate(input.start_date) && isValidDate(input.end_date) &&
    new Date(input.end_date) < new Date(input.start_date)
  ) {
    missing.push('date_order');
    questions.push('Your return date appears to be before your departure — could you double-check?');
  }

  if (missing.length === 0) return null;

  return { missing, question: buildSimpleQuestion(missing, questions, input) };
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !isNaN(new Date(s).getTime());
}

function buildSimpleQuestion(
  missing: string[],
  questions: string[],
  input: TripPlanInput,
): string {
  if (questions.length === 1) return questions[0]!;
  if (missing.includes('destination') && missing.includes('start_date') && missing.includes('end_date')) {
    return "I'd love to help plan your trip! To get started, could you tell me:\n• Where would you like to go?\n• When are you traveling (departure and return dates)?";
  }
  if (missing.includes('start_date') && missing.includes('end_date')) {
    const dest = input.destination ?? 'your trip';
    return `Happy to plan ${dest}! What are your departure and return dates?`;
  }
  return questions.join(' Also, ');
}

const REQUIRED_TRIP_FIELDS = [
  'destination',
  'start_date',
  'end_date',
  'travelers',
  'budget_range',
  'accommodation_style',
] as const;

/**
 * Determine what info is missing for trip planning and generate
 * natural clarifying questions (max 2-3 at a time).
 */
export async function generateClarifyingQuestions(
  knownInfo: Record<string, unknown>,
): Promise<string | null> {
  const missingFields = REQUIRED_TRIP_FIELDS.filter(
    (field) => !knownInfo[field],
  );

  if (missingFields.length === 0) return null;

  logger.debug({ missingFields }, 'Generating clarifying questions');

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: AI.CONVERSATION_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: buildClarificationPrompt(knownInfo, [...missingFields]),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock && 'text' in textBlock ? textBlock.text : null;
}
