import type Anthropic from '@anthropic-ai/sdk';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { CONVERSATION } from '../../config/constants.js';

type MessageParam = Anthropic.Messages.MessageParam;

/**
 * Load the last N messages for a conversation, formatted for the Claude API.
 *
 * Returns full Anthropic MessageParam format:
 *  - text messages  → { role, content: string }
 *  - tool_call msgs → { role: 'assistant', content: ContentBlock[] }
 *  - tool_result    → { role: 'user', content: ToolResultBlock[] }
 *
 * This preserves tool-use context across turns so Claude can reference
 * earlier search results (e.g. searchId) without hallucinating.
 */
export async function getConversationHistory(
  conversationId: string,
  options?: { limit?: number },
): Promise<MessageParam[]> {
  const limit = options?.limit ?? CONVERSATION.MAX_HISTORY_MESSAGES;
  const db = getDb();

  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      messageType: messages.messageType,
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
    .map((r): MessageParam => {
      const role = r.role as 'user' | 'assistant';

      // Tool exchanges are stored as JSON-encoded Anthropic content blocks
      if (r.messageType === 'tool_call' || r.messageType === 'tool_result') {
        try {
          return { role, content: JSON.parse(r.content) };
        } catch {
          // Corrupted JSON — degrade to plain text
          return { role, content: r.content };
        }
      }

      // Regular text messages
      return { role, content: r.content };
    });
}

/**
 * Build the full context window for a Claude call.
 * Combines conversation history with a rough token estimate.
 */
export async function buildContextWindow(
  conversationId: string,
): Promise<{ messages: MessageParam[]; estimatedTokens: number }> {
  const history = await getConversationHistory(conversationId);

  const estimatedTokens = history.reduce(
    (sum, m) => {
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 4);
    },
    0,
  );

  return { messages: history, estimatedTokens };
}
