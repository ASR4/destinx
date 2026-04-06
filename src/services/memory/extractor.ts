import { getAnthropicClient } from '../../ai/client.js';
import { buildExtractionPrompt } from '../../ai/prompts/extraction.js';
import { upsertPreference, detectContradiction } from './store.js';
import { storeMemoryEmbedding } from './embeddings.js';
import { buildUserProfile } from './profile.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import type { Message } from '../../types/conversation.js';
import type { ExtractionResult } from '../../types/memory.js';

interface ExtractedContradiction {
  category: string;
  key: string;
  old_value: string;
  new_value: string;
  context: string;
}

interface FullExtractionResult extends ExtractionResult {
  contradictions?: ExtractedContradiction[];
}

/**
 * Extract preferences from a conversation exchange.
 * Runs AFTER every exchange (queued, non-blocking).
 *
 * Uses the background model (Haiku) for cost efficiency.
 */
export async function extractPreferences(
  userId: string,
  messages: Message[],
): Promise<void> {
  logger.info({ userId, messageCount: messages.length }, 'Extracting preferences');

  const profile = await buildUserProfile(userId);
  const recentMessages = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const profileObj: Record<string, unknown> = {};
  if (profile?.preferences) {
    for (const [k, v] of Object.entries(profile.preferences)) {
      profileObj[k] = v;
    }
  }

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: AI.BACKGROUND_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: buildExtractionPrompt(profileObj, recentMessages),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || !('text' in textBlock)) return;

  let result: FullExtractionResult;
  try {
    let raw = textBlock.text.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) raw = fenceMatch[1]!.trim();
    result = JSON.parse(raw);
  } catch {
    logger.warn({ text: textBlock.text.slice(0, 200) }, 'Failed to parse extraction result');
    return;
  }

  if (result.no_new_preferences && (!result.contradictions || result.contradictions.length === 0)) return;

  // Store structured preferences
  for (const pref of result.structured_preferences) {
    const { contradiction } = await upsertPreference(userId, pref);
    if (contradiction) {
      logger.info(
        { userId, key: pref.key, oldValue: contradiction.value, newValue: pref.value },
        'Contradiction detected during extraction — preference stored with reduced confidence',
      );
    }
  }

  // Store semantic memories
  for (const memory of result.semantic_memories) {
    await storeMemoryEmbedding(userId, memory);
  }

  // Log detected contradictions for observability
  if (result.contradictions && result.contradictions.length > 0) {
    logger.info(
      { userId, contradictions: result.contradictions },
      'Contradictions detected in conversation',
    );
  }

  logger.info(
    {
      userId,
      newPrefs: result.structured_preferences.length,
      newMemories: result.semantic_memories.length,
      contradictions: result.contradictions?.length ?? 0,
    },
    'Preferences extracted',
  );
}
