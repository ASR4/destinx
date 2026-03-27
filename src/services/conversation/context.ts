import { eq, asc, desc } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { CONVERSATION } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Load the last N messages for a conversation, formatted for Claude.
 * Queries the messages table ordered by created_at, returns a sliding window.
 */
export async function getConversationHistory(
  conversationId: string,
  options?: { limit?: number },
): Promise<ChatMessage[]> {
  const limit = options?.limit ?? CONVERSATION.MAX_HISTORY_MESSAGES;
  const db = getDb();

  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Reverse so oldest is first (we fetched newest-first for the LIMIT)
  rows.reverse();

  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }));
}

/**
 * Build the full context window for a Claude call.
 * Combines conversation history with a rough token estimate.
 */
export async function buildContextWindow(
  conversationId: string,
): Promise<{ messages: ChatMessage[]; estimatedTokens: number }> {
  const history = await getConversationHistory(conversationId);

  const estimatedTokens = history.reduce(
    (sum, m) => sum + Math.ceil(m.content.length / 4),
    0,
  );

  return { messages: history, estimatedTokens };
}
