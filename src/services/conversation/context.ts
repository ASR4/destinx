import type Anthropic from '@anthropic-ai/sdk';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { messages, conversations } from '../../db/schema.js';
import { CONVERSATION, AI } from '../../config/constants.js';
import { getAnthropicClient } from '../../ai/client.js';
import { logger } from '../../utils/logger.js';
import type { Trip } from '../../types/trip.js';

type MessageParam = Anthropic.Messages.MessageParam;

function estimateTokens(content: string | Anthropic.Messages.ContentBlockParam[]): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return Math.ceil(text.length / 4);
}

/**
 * Load all messages for a conversation from DB, formatted for the Claude API.
 * Returns full Anthropic MessageParam format preserving tool exchanges.
 */
async function loadAllMessages(conversationId: string): Promise<MessageParam[]> {
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
    .limit(CONVERSATION.MAX_HISTORY_MESSAGES);

  rows.reverse();

  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r): MessageParam => {
      const role = r.role as 'user' | 'assistant';
      if (r.messageType === 'tool_call' || r.messageType === 'tool_result') {
        try {
          return { role, content: JSON.parse(r.content) };
        } catch {
          return { role, content: r.content };
        }
      }
      return { role, content: r.content };
    });
}

/**
 * Condense tool results in a message — keep only key findings, strip raw API data.
 */
function condenseToolResults(msg: MessageParam): MessageParam {
  if (msg.role !== 'user' || typeof msg.content === 'string') return msg;
  if (!Array.isArray(msg.content)) return msg;

  const condensed = (msg.content as Anthropic.Messages.ToolResultBlockParam[]).map((block) => {
    if (block.type !== 'tool_result') return block;
    if (typeof block.content !== 'string') return block;

    try {
      const data = JSON.parse(block.content);
      if (data.error) return block;

      if (Array.isArray(data.flights)) {
        return {
          ...block,
          content: JSON.stringify({
            searchId: data.searchId,
            resultCount: data.flights.length,
            topFlights: data.flights.slice(0, 3).map((f: any) => ({
              airline: f.airline, flightNumber: f.flightNumber,
              price: f.price, departure: f.departure, arrival: f.arrival,
            })),
          }),
        };
      }
      if (Array.isArray(data.hotels || data.results)) {
        const items = data.hotels || data.results;
        return {
          ...block,
          content: JSON.stringify({
            resultCount: items.length,
            topResults: items.slice(0, 5).map((h: any) => ({
              name: h.name, price: h.price, rating: h.rating,
            })),
          }),
        };
      }
      const str = block.content;
      if (str.length > 2000) {
        return { ...block, content: str.slice(0, 2000) + '... [truncated]' };
      }
    } catch { /* keep original */ }
    return block;
  });

  return { ...msg, content: condensed };
}

/**
 * Generate a summary of old conversation messages using Claude Haiku.
 * Returns ~200 token summary paragraph.
 */
async function summarizeOldMessages(msgs: MessageParam[]): Promise<string | null> {
  if (msgs.length === 0) return null;

  const text = msgs.map((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}: ${content.slice(0, 300)}`;
  }).join('\n');

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: AI.BACKGROUND_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: `Summarize this travel planning conversation in a concise paragraph (~150 words). Focus on: what the user wants, key decisions made, preferences revealed, and where the conversation left off.\n\n${text}` }],
    });

    const block = response.content.find((b) => b.type === 'text');
    return block && 'text' in block ? block.text : null;
  } catch (err) {
    logger.warn({ err }, 'Failed to summarize old messages — skipping tier 3');
    return null;
  }
}

/**
 * Get or create a cached conversation summary stored in the conversation context.
 */
async function getCachedSummary(conversationId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const ctx = rows[0]?.context as Record<string, unknown> | null;
  return (ctx?.conversationSummary as string) ?? null;
}

async function saveSummary(conversationId: string, summary: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const existing = (rows[0]?.context as Record<string, unknown>) ?? {};
  await db
    .update(conversations)
    .set({ context: { ...existing, conversationSummary: summary }, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Build a compressed trip state block for the end of context.
 * Prevents "lost in the middle" drift in long planning sessions.
 */
export function buildTripStateBlock(trip: Trip): string {
  const plan = trip.plan;
  const totalDays = plan.days?.length ?? 0;
  const plannedDays = plan.days?.filter((d) => d.items && d.items.length > 0).length ?? 0;
  const pendingDays = totalDays - plannedDays;

  const lines = ['[CURRENT TRIP STATE]'];
  lines.push(`Destination: ${trip.destination}`);
  if (trip.startDate && trip.endDate) lines.push(`Dates: ${trip.startDate} to ${trip.endDate}`);
  if (trip.travelers?.length) lines.push(`Travelers: ${trip.travelers.length} ${trip.travelers.length === 1 ? 'person' : 'people'}`);
  if (trip.budget) {
    const b = trip.budget;
    lines.push(`Budget: ${b.currency ?? 'USD'} ${b.total?.toLocaleString() ?? '?'}`);
  }
  lines.push(`Status: ${trip.status}`);
  if (totalDays > 0) {
    lines.push(`Planning: ${plannedDays}/${totalDays} days planned${pendingDays > 0 ? `, ${pendingDays} pending` : ''}`);
  }

  const accommodations = plan.days
    ?.map((d) => d.accommodation?.name)
    .filter(Boolean);
  if (accommodations && accommodations.length > 0) {
    const unique = [...new Set(accommodations)];
    lines.push(`Accommodation: ${unique.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Three-tier context window builder.
 *
 * Tier 1 (verbatim): Last 6 messages (3 user+assistant pairs)
 * Tier 2 (condensed): Messages 7-20, with tool results trimmed
 * Tier 3 (summarized): Messages 20+ summarized to ~200 tokens
 *
 * Active trip state is appended at the END of context to prevent
 * "lost in the middle" drift.
 */
export async function buildContextWindow(
  conversationId: string,
  activeTrip: Trip | null,
): Promise<{ messages: MessageParam[]; estimatedTokens: number }> {
  const allMessages = await loadAllMessages(conversationId);

  const tier1Count = CONVERSATION.TIER1_MESSAGE_COUNT;
  const tier2Count = CONVERSATION.TIER2_MESSAGE_COUNT;

  const total = allMessages.length;
  const result: MessageParam[] = [];
  let tokenBudget = CONVERSATION.MAX_CONTEXT_TOKENS;

  // Tier 3: Messages older than tier2Count — summarize
  if (total > tier2Count) {
    const oldMessages = allMessages.slice(0, total - tier2Count);
    let summary = await getCachedSummary(conversationId);

    if (!summary && oldMessages.length >= 4) {
      summary = await summarizeOldMessages(oldMessages);
      if (summary) {
        saveSummary(conversationId, summary).catch((err) =>
          logger.warn({ err }, 'Failed to cache conversation summary'));
      }
    }

    if (summary) {
      const summaryMsg: MessageParam = {
        role: 'user',
        content: `[CONVERSATION SUMMARY — earlier messages]\n${summary}`,
      };
      result.push(summaryMsg);
      // Need an assistant ack so roles alternate properly
      result.push({ role: 'assistant', content: 'Understood, I have the context from our earlier conversation.' });
      tokenBudget -= estimateTokens(summary) + 20;
    }
  }

  // Tier 2: Messages from position (total - tier2Count) to (total - tier1Count) — condensed
  const tier2Start = Math.max(0, total - tier2Count);
  const tier2End = Math.max(0, total - tier1Count);
  if (tier2End > tier2Start) {
    const tier2Messages = allMessages.slice(tier2Start, tier2End);
    for (const msg of tier2Messages) {
      const condensed = condenseToolResults(msg);
      const tokens = estimateTokens(
        typeof condensed.content === 'string' ? condensed.content : JSON.stringify(condensed.content),
      );
      if (tokenBudget - tokens < 0) continue;
      result.push(condensed);
      tokenBudget -= tokens;
    }
  }

  // Tier 1: Last 6 messages — verbatim, always included
  const tier1Messages = allMessages.slice(Math.max(0, total - tier1Count));
  for (const msg of tier1Messages) {
    result.push(msg);
    tokenBudget -= estimateTokens(
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    );
  }

  const estimatedTokens = CONVERSATION.MAX_CONTEXT_TOKENS - tokenBudget;
  return { messages: result, estimatedTokens };
}

/**
 * Simple history loader (backwards compat — used by older callers).
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

  rows.reverse();

  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r): MessageParam => {
      const role = r.role as 'user' | 'assistant';
      if (r.messageType === 'tool_call' || r.messageType === 'tool_result') {
        try {
          return { role, content: JSON.parse(r.content) };
        } catch {
          return { role, content: r.content };
        }
      }
      return { role, content: r.content };
    });
}
