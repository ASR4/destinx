import { getAnthropicClient } from '../../ai/client.js';
import { buildExtractionPrompt } from '../../ai/prompts/extraction.js';
import { upsertPreference } from './store.js';
import { storeMemoryEmbedding } from './embeddings.js';
import { buildUserProfile } from './profile.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import type { Message } from '../../types/conversation.js';
import type { ExtractionResult } from '../../types/memory.js';

/**
 * Extract preferences from a conversation exchange.
 * Runs AFTER every exchange (queued, non-blocking).
 *
 * Two extraction methods:
 * 1. Structured: Claude extracts key-value preferences
 * 2. Semantic: Store natural language snippets as embeddings
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
    model: AI.CONVERSATION_MODEL,
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

  let result: ExtractionResult;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    logger.warn('Failed to parse extraction result');
    return;
  }

  if (result.no_new_preferences) return;

  for (const pref of result.structured_preferences) {
    await upsertPreference(userId, pref);
  }

  for (const memory of result.semantic_memories) {
    await storeMemoryEmbedding(userId, memory);
  }

  logger.info(
    {
      userId,
      newPrefs: result.structured_preferences.length,
      newMemories: result.semantic_memories.length,
    },
    'Preferences extracted',
  );
}
