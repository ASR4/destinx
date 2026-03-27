import type Anthropic from '@anthropic-ai/sdk';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { getAnthropicClient } from '../../ai/client.js';
import { getTravelAgentTools } from '../../ai/tools.js';
import { buildSystemPrompt } from '../../ai/prompts/system.js';
import { recallUserProfile } from '../memory/recall.js';
import { getConversationHistory } from './context.js';
import { classifyIntent } from './intent.js';
import { getNextState, isConfirmationInState } from './state-machine.js';
import { executeToolCalls, getHoldingMessage } from './tool-executor.js';
import { memoryQueue } from '../../jobs/queue.js';
import { getDb } from '../../db/client.js';
import { conversations, trips } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
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
  logger.info({ userId, conversationId }, 'Processing message');

  const userProfile = await recallUserProfile(userId);
  const history = await getConversationHistory(conversationId);
  const activeTrip = await getActiveTrip(userId);

  const currentState = await getConversationState(conversationId);

  if (isConfirmationInState(currentState, userMessage)) {
    logger.info({ currentState }, 'Message interpreted as confirmation');
  }

  const intent = await classifyIntent(userMessage, { currentState });
  const nextState = getNextState(currentState, intent.intent);
  await saveConversationState(conversationId, nextState);

  const anthropic = getAnthropicClient();
  let claudeMessages: Anthropic.Messages.MessageParam[] = [
    ...history,
    { role: 'user' as const, content: userMessage },
  ];

  let finalText = '';
  let holdingMessageSent = false;
  const loopStartTime = Date.now();

  for (let iteration = 0; iteration < CONVERSATION.MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: AI.CONVERSATION_MODEL,
      max_tokens: AI.MAX_CONVERSATION_TOKENS,
      system: buildSystemPrompt(userProfile, activeTrip),
      messages: claudeMessages,
      tools: getTravelAgentTools(),
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );

    if (toolUseBlocks.length === 0) {
      finalText = textBlocks.map((b) => b.text).join('\n') ||
        "I'm working on that — give me just a moment!";
      break;
    }

    const elapsed = Date.now() - loopStartTime;
    if (!holdingMessageSent && elapsed > CONVERSATION.HOLDING_MESSAGE_DELAY_MS) {
      const toolNames = toolUseBlocks.map((b) => b.name);
      const holdingMsg = getHoldingMessage(toolNames);
      options.onProgress?.(holdingMsg);
      holdingMessageSent = true;
    }

    const toolResults = await executeToolCalls(
      toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      })),
      { userId, conversationId, userPhone: options.userPhone },
    );

    claudeMessages = [
      ...claudeMessages,
      { role: 'assistant' as const, content: response.content },
      {
        role: 'user' as const,
        content: toolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolUseId,
          content: tr.result,
        })),
      },
    ];

    if (textBlocks.length > 0 && response.stop_reason === 'end_turn') {
      finalText = textBlocks.map((b) => b.text).join('\n');
      break;
    }
  }

  if (!finalText) {
    finalText = "I've gathered quite a bit of info! Let me put it all together for you.";
  }

  memoryQueue.add('extract', {
    userId,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: finalText },
    ],
  }).catch((err) => logger.error({ err }, 'Failed to queue memory extraction'));

  return finalText;
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
