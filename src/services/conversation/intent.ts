import type { Intent, IntentClassification } from '../../types/conversation.js';
import { logger } from '../../utils/logger.js';

/**
 * Classify user intent from their message.
 *
 * Used for routing in the conversation engine to determine:
 * - new_trip: User wants to plan a new trip
 * - modify_plan: User wants to change an existing plan
 * - book: User is ready to book something
 * - question: User has a question about their trip or a destination
 * - feedback: Post-trip or mid-trip feedback
 * - greeting: Hello / casual opener
 * - general: Doesn't fit other categories
 * - opt_out: User wants to stop receiving messages
 *
 * In practice, Claude handles intent classification implicitly via
 * tool selection — this is a backup for explicit routing needs.
 */
export async function classifyIntent(
  message: string,
  conversationContext?: Record<string, unknown>,
): Promise<IntentClassification> {
  // TODO: Implement with Claude or keyword-based fast path
  logger.debug({ message }, 'classifyIntent stub');

  if (/\b(stop|unsubscribe|opt.?out)\b/i.test(message)) {
    return { intent: 'opt_out', confidence: 0.95 };
  }

  if (/\b(hi|hello|hey|good morning|good evening)\b/i.test(message)) {
    return { intent: 'greeting', confidence: 0.7 };
  }

  if (/\b(book|reserve|confirm)\b/i.test(message)) {
    return { intent: 'book', confidence: 0.6 };
  }

  if (/\b(trip|travel|plan|visit|go to|fly to|vacation)\b/i.test(message)) {
    return { intent: 'new_trip', confidence: 0.6 };
  }

  if (/\b(change|modify|update|swap|replace)\b/i.test(message)) {
    return { intent: 'modify_plan', confidence: 0.6 };
  }

  return { intent: 'general', confidence: 0.4 };
}
