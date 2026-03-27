import { CONVERSATION } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Load the last N messages for a conversation, formatted for Claude.
 * Manages a sliding window to stay within token limits.
 */
export async function getConversationHistory(
  conversationId: string,
  options?: { limit?: number },
): Promise<ChatMessage[]> {
  const limit = options?.limit ?? CONVERSATION.MAX_HISTORY_MESSAGES;

  // TODO: Query messages table, ordered by created_at DESC, limit N, then reverse
  logger.debug({ conversationId, limit }, 'getConversationHistory stub');
  return [];
}

/**
 * Build the full context window for a Claude call.
 * Combines system prompt, conversation history, and any injected context
 * (user preferences, active trip, etc.).
 */
export async function buildContextWindow(
  conversationId: string,
  additionalContext?: Record<string, unknown>,
): Promise<{ messages: ChatMessage[]; estimatedTokens: number }> {
  const history = await getConversationHistory(conversationId);

  // Rough token estimate: ~4 chars per token
  const estimatedTokens = history.reduce(
    (sum, m) => sum + Math.ceil(m.content.length / 4),
    0,
  );

  return { messages: history, estimatedTokens };
}
