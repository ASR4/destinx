import Anthropic from '@anthropic-ai/sdk';
import type { Intent, IntentClassification } from '../../types/conversation.js';
import { getRedisClient } from '../../utils/redis.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Fast-path regex for trivial, high-confidence cases
// ---------------------------------------------------------------------------

const FAST_PATH: Array<{ pattern: RegExp; intent: Intent; confidence: number }> = [
  { pattern: /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)\s*$/i, intent: 'opt_out', confidence: 0.99 },
  { pattern: /^\s*(hi|hello|hey|good\s+(morning|evening|afternoon|day)|howdy|greetings)\s*[!.]*\s*$/i, intent: 'greeting', confidence: 0.9 },
  { pattern: /^\s*(yes|yeah|yep|yup|sure|ok|okay|sounds good|looks good|love it|book it|let's do it|go ahead|confirm|approved?)\s*[!.]*\s*$/i, intent: 'book', confidence: 0.85 },
  { pattern: /^\s*(no|nope|nah|cancel|nevermind|forget it|stop)\s*[!.]*\s*$/i, intent: 'general', confidence: 0.8 },
];

// ---------------------------------------------------------------------------
// Redis cache
// ---------------------------------------------------------------------------

const CACHE_TTL = 3600; // 1 hour

/** Normalize a message for use as a cache key: lowercase, collapse whitespace, strip punctuation. */
function normalizeForCacheKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

async function getCachedIntent(key: string): Promise<IntentClassification | null> {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const val = await redis.get(key);
    if (val) return JSON.parse(val) as IntentClassification;
  } catch { /* ignore */ }
  return null;
}

async function setCachedIntent(key: string, result: IntentClassification): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.setex(key, CACHE_TTL, JSON.stringify(result));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Haiku classifier (few-shot)
// ---------------------------------------------------------------------------

const FEW_SHOT_EXAMPLES = `
Examples:
"I want to plan a trip to Tokyo next month" → new_trip
"Book me the flight" → book
"Can you change the hotel to something cheaper?" → modify_plan
"What's the weather like in Paris in June?" → question
"The trip was amazing, loved the food tour" → feedback
"Hi there!" → greeting
"STOP" → opt_out
"What restaurants are nearby?" → question
"Let's go with option 2" → book
"Cancel everything" → opt_out
`.trim();

async function classifyWithHaiku(
  message: string,
  currentState?: string,
): Promise<IntentClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { intent: 'general', confidence: 0.4 };
  }

  const client = new Anthropic({ apiKey });

  const stateHint = currentState && currentState !== 'idle'
    ? `\nCurrent conversation state: ${currentState}`
    : '';

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Classify the intent of this WhatsApp travel agent message into exactly one of: new_trip, modify_plan, book, question, feedback, greeting, general, opt_out.${stateHint}

${FEW_SHOT_EXAMPLES}

Message: "${message.slice(0, 300)}"
Intent (one word only):`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toLowerCase()
      .split(/\s+/)[0] ?? '';

    const validIntents: Intent[] = ['new_trip', 'modify_plan', 'book', 'question', 'feedback', 'greeting', 'general', 'opt_out'];
    const intent = validIntents.includes(text as Intent) ? (text as Intent) : 'general';

    return { intent, confidence: 0.85 };
  } catch (err) {
    logger.warn({ err }, 'Haiku intent classification failed — falling back to general');
    return { intent: 'general', confidence: 0.4 };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function classifyIntent(
  message: string,
  conversationContext?: Record<string, unknown>,
): Promise<IntentClassification> {
  // 1. Fast-path regex (no latency, no cost)
  for (const { pattern, intent, confidence } of FAST_PATH) {
    if (pattern.test(message)) {
      return { intent, confidence };
    }
  }

  const currentState = conversationContext?.currentState as string | undefined;

  // 2. Redis cache check (normalize message to improve hit rate across similar phrasings)
  const cacheKey = `intent:${normalizeForCacheKey(message)}:${currentState ?? ''}`;
  const cached = await getCachedIntent(cacheKey);
  if (cached) {
    logger.debug({ message: message.slice(0, 50) }, 'Intent cache hit');
    return cached;
  }

  // 3. Haiku classification
  const result = await classifyWithHaiku(message, currentState);

  await setCachedIntent(cacheKey, result);
  return result;
}
