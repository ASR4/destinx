import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../../ai/client.js';
import { getTravelAgentTools } from '../../ai/tools.js';
import { buildSystemPrompt } from '../../ai/prompts/system.js';
import { recallUserProfile } from '../memory/recall.js';
import { getConversationHistory } from './context.js';
import { classifyIntent } from './intent.js';
import { getNextState, isConfirmationInState } from './state-machine.js';
import { executeToolCalls, getHoldingMessage } from './tool-executor.js';
import { sendText } from '../whatsapp/sender.js';
import { memoryQueue } from '../../jobs/queue.js';
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
 *
 * Full flow:
 * 1. Load user profile + preferences from memory
 * 2. Load conversation history and current FSM state
 * 3. Classify intent considering current state
 * 4. Transition the state machine
 * 5. Call Claude with tools in a multi-turn loop
 * 6. Execute tool calls in parallel, feed results back
 * 7. Cap at MAX_TOOL_LOOP_ITERATIONS to prevent runaway loops
 * 8. Send final coherent response via WhatsApp
 * 9. Queue background memory extraction
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

  // --- State machine transition ---
  const currentState = await getConversationState(conversationId);

  if (isConfirmationInState(currentState, userMessage)) {
    logger.info({ currentState }, 'Message interpreted as confirmation');
  }

  const intent = await classifyIntent(userMessage, { currentState });
  const nextState = getNextState(currentState, intent.intent);
  await saveConversationState(conversationId, nextState);

  // --- Multi-turn tool-use loop ---
  const anthropic = getAnthropicClient();
  let messages: Anthropic.Messages.MessageParam[] = [
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
      messages,
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

    // Send a contextual holding message if this is taking time and we haven't already
    const elapsed = Date.now() - loopStartTime;
    if (!holdingMessageSent && elapsed > CONVERSATION.HOLDING_MESSAGE_DELAY_MS) {
      const toolNames = toolUseBlocks.map((b) => b.name);
      const holdingMsg = getHoldingMessage(toolNames);
      options.onProgress?.(holdingMsg);
      holdingMessageSent = true;
    }

    // Execute all tool calls in parallel
    const toolResults = await executeToolCalls(
      toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> })),
      { userId, userPhone: options.userPhone },
    );

    // Build the tool_result messages for Claude
    messages = [
      ...messages,
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

    // If Claude also returned text alongside tool calls, accumulate it
    if (textBlocks.length > 0 && response.stop_reason === 'end_turn') {
      finalText = textBlocks.map((b) => b.text).join('\n');
      break;
    }
  }

  if (!finalText) {
    finalText = "I've gathered quite a bit of info! Let me put it all together for you.";
  }

  // Queue background memory extraction
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
  // TODO: Query trips table for user's active trip
  logger.debug({ userId }, 'getActiveTrip stub');
  return null;
}

async function getConversationState(
  conversationId: string,
): Promise<ConversationFSMState> {
  // TODO: Read from conversations.context.fsmState
  logger.debug({ conversationId }, 'getConversationState stub');
  return 'idle';
}

async function saveConversationState(
  conversationId: string,
  state: ConversationFSMState,
): Promise<void> {
  // TODO: Update conversations.context.fsmState
  logger.debug({ conversationId, state }, 'saveConversationState stub');
}
