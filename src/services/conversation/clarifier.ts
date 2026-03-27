import { getAnthropicClient } from '../../ai/client.js';
import { buildClarificationPrompt } from '../../ai/prompts/clarification.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

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
