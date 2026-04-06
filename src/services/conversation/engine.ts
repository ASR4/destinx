import type Anthropic from '@anthropic-ai/sdk';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { getAnthropicClient } from '../../ai/client.js';
import { getTravelAgentTools } from '../../ai/tools.js';
import { buildSystemPrompt } from '../../ai/prompts/system.js';
import { recallUserProfile, recallRelevantMemories } from '../memory/recall.js';
import { buildContextWindow, buildTripStateBlock } from './context.js';
import { classifyIntent } from './intent.js';
import { getNextState, isConfirmationInState } from './state-machine.js';
import { executeToolCalls, getHoldingMessage } from './tool-executor.js';
import { memoryQueue } from '../../jobs/queue.js';
import {
  checkUserClaudeLimit,
  acquireSystemClaudeSlot,
  releaseSystemClaudeSlot,
  RATE_LIMIT_MESSAGES,
} from '../rate-limiter.js';
import { getDb } from '../../db/client.js';
import { conversations, messages, trips } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { withRetry, withCircuitBreaker, getUserMessage } from '../../utils/errors.js';
import { AI, CONVERSATION } from '../../config/constants.js';
import type { ConversationFSMState } from '../../config/constants.js';
import type { Trip } from '../../types/trip.js';

export interface ProcessMessageOptions {
  userPhone: string;
  onProgress?: (message: string) => void;
}

/**
 * Main conversation orchestrator — the "brain" of the application.
 */
export async function processMessage(
  userId: string,
  conversationId: string,
  userMessage: string,
  options: ProcessMessageOptions,
): Promise<string> {
  const startTime = Date.now();
  logger.info({ userId, conversationId }, 'Processing message');

  const [claudeLimit, claudeSlot] = await Promise.all([
    checkUserClaudeLimit(userId),
    acquireSystemClaudeSlot(),
  ]);

  if (!claudeLimit.allowed) {
    logger.warn({ userId }, 'User Claude rate limit exceeded');
    return RATE_LIMIT_MESSAGES.claude;
  }
  if (!claudeSlot.allowed) {
    logger.warn('System Claude concurrency limit exceeded');
    return RATE_LIMIT_MESSAGES.system;
  }

  try {
    const result = await _processMessageInner(userId, conversationId, userMessage, options);
    const elapsed = Date.now() - startTime;
    logger.info({ userId, conversationId, responseTimeMs: elapsed }, 'Message processed');
    return result;
  } catch (err) {
    logger.error({ err, userId, conversationId }, 'processMessage fatal error');
    return getUserMessage('unknown');
  } finally {
    await releaseSystemClaudeSlot();
  }
}

async function _processMessageInner(
  userId: string,
  conversationId: string,
  userMessage: string,
  options: ProcessMessageOptions,
): Promise<string> {
  // Load profile, context, and active trip in parallel
  let userProfile: Awaited<ReturnType<typeof recallUserProfile>>;
  let contextResult: Awaited<ReturnType<typeof buildContextWindow>>;
  let activeTrip: Trip | null;

  try {
    [userProfile, contextResult, activeTrip] = await Promise.all([
      recallUserProfile(userId),
      buildContextWindow(conversationId, null),
      getActiveTrip(userId).catch((err) => {
        logger.warn({ err }, 'Failed to load active trip');
        return null;
      }),
    ]);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to load user context — using empty profile');
    userProfile = {
      preferences: { accommodation: [], food: [], transport: [], budget: [], travel_style: [], loyalty: [], dietary: [], companion: [] },
      lastTrips: [],
    };
    contextResult = { messages: [], estimatedTokens: 0 };
    activeTrip = null;
  }

  // Semantic memories (best-effort)
  try {
    const semanticMemories = await recallRelevantMemories(userId, userMessage);
    if (semanticMemories.length > 0) {
      userProfile.semanticMemories = semanticMemories;
    }
  } catch (err) {
    logger.debug({ err }, 'Semantic memory recall failed — skipping');
  }

  // Determine if user is in onboarding (Upgrade 7)
  const isOnboarding = await checkIsOnboarding(userId, userProfile);

  const currentState = await getConversationState(conversationId);

  if (isConfirmationInState(currentState, userMessage)) {
    logger.info({ currentState }, 'Message interpreted as confirmation');
  }

  const intent = await classifyIntent(userMessage, { currentState });
  const nextState = getNextState(currentState, intent.intent);
  await saveConversationState(conversationId, nextState);

  // Build message list: tiered history + user message + trip state at END
  let claudeMessages: Anthropic.Messages.MessageParam[] = [
    ...contextResult.messages,
    { role: 'user' as const, content: userMessage },
  ];

  // 1b: Append active trip state at the END of context (prevents "lost in the middle" drift)
  if (activeTrip && activeTrip.plan?.days?.length > 0) {
    const tripStateBlock = buildTripStateBlock(activeTrip);
    const lastMsg = claudeMessages[claudeMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      const existingContent = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
      claudeMessages[claudeMessages.length - 1] = {
        role: 'user',
        content: `${existingContent}\n\n${tripStateBlock}`,
      };
    }
  }

  let finalText = '';
  const collectedText: string[] = [];
  let holdingMessagesSent = 0;
  const loopStartTime = Date.now();
  const SECOND_HOLDING_DELAY_MS = 20_000;
  let toolsCalled: string[] = [];

  // 1d: All tools always registered (getTravelAgentTools returns the full stable set)
  const tools = getTravelAgentTools();

  for (let iteration = 0; iteration < CONVERSATION.MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    // Wrap Claude call with retry + circuit breaker (Upgrade 6)
    const response = await withRetry(
      () => withCircuitBreaker('anthropic', () => {
        const anthropic = getAnthropicClient();
        return anthropic.messages.create({
          model: AI.CONVERSATION_MODEL,
          max_tokens: AI.MAX_CONVERSATION_TOKENS,
          system: buildSystemPrompt(userProfile, activeTrip, { isOnboarding }),
          messages: claudeMessages,
          tools,
        });
      }),
      {
        maxRetries: 1,
        baseDelayMs: 3000,
        onRetry: (attempt) => {
          if (holdingMessagesSent === 0) {
            options.onProgress?.(getUserMessage('claude_timeout'));
            holdingMessagesSent = 1;
          }
          logger.warn({ attempt }, 'Retrying Claude API call');
        },
      },
    );

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );

    const iterText = textBlocks.map((b) => b.text).join('\n').trim();

    if (toolUseBlocks.length === 0) {
      finalText = iterText || collectedText[collectedText.length - 1] || '';
      break;
    }

    if (iterText) collectedText.push(iterText);
    toolsCalled.push(...toolUseBlocks.map((b) => b.name));

    const elapsed = Date.now() - loopStartTime;
    if (holdingMessagesSent === 0 && elapsed > CONVERSATION.HOLDING_MESSAGE_DELAY_MS) {
      const toolNames = toolUseBlocks.map((b) => b.name);
      options.onProgress?.(getHoldingMessage(toolNames));
      holdingMessagesSent = 1;
    } else if (holdingMessagesSent === 1 && elapsed > SECOND_HOLDING_DELAY_MS) {
      options.onProgress?.("Still working on this — almost there! 🙏");
      holdingMessagesSent = 2;
    }

    const toolResults = await executeToolCalls(
      toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      })),
      { userId, conversationId, userPhone: options.userPhone },
    );

    const toolResultContent = toolResults.map((tr) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.toolUseId,
      content: tr.result,
    }));

    claudeMessages = [
      ...claudeMessages,
      { role: 'assistant' as const, content: response.content },
      { role: 'user' as const, content: toolResultContent },
    ];

    // Persist tool exchange
    const now = Date.now();
    getDb()
      .insert(messages)
      .values([
        {
          conversationId,
          role: 'assistant',
          content: JSON.stringify(response.content),
          messageType: 'tool_call',
          createdAt: new Date(now),
        },
        {
          conversationId,
          role: 'user',
          content: JSON.stringify(toolResultContent),
          messageType: 'tool_result',
          createdAt: new Date(now + 1),
        },
      ])
      .catch((err) => logger.error({ err }, 'Failed to persist tool exchange'));

    if (response.stop_reason === 'end_turn' && iterText) {
      finalText = iterText;
      break;
    }
  }

  if (!finalText) {
    finalText = collectedText[collectedText.length - 1] ||
      "I've gathered quite a bit of info! Let me put it all together for you.";
  }

  // Structured logging for observability
  logger.info({
    userId,
    conversationId,
    intent: intent.intent,
    toolsCalled,
    tokensUsed: contextResult.estimatedTokens,
    isOnboarding,
  }, 'Agent loop completed');

  memoryQueue.add('extract', {
    userId,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: finalText },
    ],
  }).catch((err) => logger.error({ err }, 'Failed to queue memory extraction'));

  return finalText;
}

/**
 * Check if a user is still in the onboarding phase.
 * Onboarding ends when the user has 4+ preferences with confidence >= 0.5.
 */
async function checkIsOnboarding(
  userId: string,
  profile: Awaited<ReturnType<typeof recallUserProfile>>,
): Promise<boolean> {
  let highConfidenceCount = 0;
  for (const prefs of Object.values(profile.preferences)) {
    for (const p of prefs) {
      if (p.confidence >= CONVERSATION.ONBOARDING_MIN_CONFIDENCE) {
        highConfidenceCount++;
      }
    }
  }
  return highConfidenceCount < CONVERSATION.ONBOARDING_MIN_PREFERENCES;
}

async function getActiveTrip(userId: string): Promise<Trip | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.userId, userId),
        inArray(trips.status, ['planning', 'confirmed']),
      ),
    )
    .orderBy(desc(trips.createdAt))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    id: row.id,
    userId: row.userId,
    destination: row.destination ?? '',
    startDate: row.startDate ?? '',
    endDate: row.endDate ?? '',
    status: (row.status as Trip['status']) ?? 'planning',
    plan: (row.plan as Trip['plan']) ?? { days: [] },
    budget: row.budget as Trip['budget'],
    travelers: row.travelers as Trip['travelers'],
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
  };
}

async function getConversationState(
  conversationId: string,
): Promise<ConversationFSMState> {
  const db = getDb();
  const rows = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (rows.length === 0) return 'idle';

  const ctx = rows[0]!.context as Record<string, unknown> | null;
  const state = ctx?.fsmState as string | undefined;

  if (state && isValidFSMState(state)) return state;
  return 'idle';
}

async function saveConversationState(
  conversationId: string,
  state: ConversationFSMState,
): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const existingContext = (rows[0]?.context as Record<string, unknown>) ?? {};
  const updatedContext = { ...existingContext, fsmState: state };

  await db
    .update(conversations)
    .set({ context: updatedContext, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

function isValidFSMState(s: string): s is ConversationFSMState {
  const valid: string[] = [
    'idle', 'gathering_info', 'planning', 'reviewing_plan',
    'modifying_plan', 'pre_booking', 'booking_in_progress',
    'awaiting_confirmation', 'post_trip',
  ];
  return valid.includes(s);
}
