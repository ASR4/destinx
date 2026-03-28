import { Queue, Worker, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { logger } from '../utils/logger.js';
import { QUEUE } from '../config/constants.js';

let _connection: ConnectionOptions | null = null;

function getConnection(): ConnectionOptions {
  if (_connection) return _connection;
  _connection = { url: process.env.REDIS_URL };
  return _connection;
}

export const conversationQueue = new Queue('conversation', {
  connection: getConnection(),
});
export const planningQueue = new Queue('planning', {
  connection: getConnection(),
});
export const bookingQueue = new Queue('booking', {
  connection: getConnection(),
});
export const memoryQueue = new Queue('memory', {
  connection: getConnection(),
});
export const priceCheckQueue = new Queue('price-check', {
  connection: getConnection(),
});

const workers: Worker[] = [];
let _conversationEvents: QueueEvents | null = null;

/**
 * Detect Claude responses ending with numbered options (e.g. "1. Beach\n2. City\n3. Mountain").
 * Returns the body text and option labels for interactive buttons.
 */
function parseQuestionWithOptions(
  text: string,
): { body: string; options: string[] } | null {
  // Match lines like "1. Beach vacation" or "1) Beach vacation" at the end of the text
  const lines = text.trimEnd().split('\n');
  const optionLines: string[] = [];

  // Walk backwards from the end collecting numbered options
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]!.match(/^\s*(\d+)[.\)]\s+(.+)$/);
    if (match) {
      optionLines.unshift(match[2]!.trim());
    } else {
      break;
    }
  }

  if (optionLines.length < 2 || optionLines.length > 10) return null;

  // Everything before the options is the body
  const bodyLines = lines.slice(0, lines.length - optionLines.length);
  const body = bodyLines.join('\n').trim();
  if (!body) return null;

  return { body, options: optionLines };
}

/**
 * Get the conversation queue events listener for progress-based holding messages.
 */
export function getConversationEvents(): QueueEvents {
  if (_conversationEvents) return _conversationEvents;
  _conversationEvents = new QueueEvents('conversation', { connection: getConnection() });
  return _conversationEvents;
}

export function startWorkers(): void {
  const conn = getConnection();

  // --- Conversation worker: runs the engine + sends holding messages via progress ---
  workers.push(
    new Worker(
      'conversation',
      async (job) => {
        const { userId, conversationId, message, userPhone } = job.data as {
          userId: string;
          conversationId: string;
          message: string;
          userPhone: string;
        };

        const { processMessage } = await import(
          '../services/conversation/engine.js'
        );
        const { sendText } = await import(
          '../services/whatsapp/sender.js'
        );

        const responseText = await processMessage(userId, conversationId, message, {
          userPhone,
          onProgress: (holdingMsg: string) => {
            sendText(userPhone, holdingMsg).catch((err) =>
              logger.error({ err }, 'Failed to send holding message'),
            );
          },
        });

        // Detect questions with numbered options → buttons (2-3) or list (4-10)
        const parsed = parseQuestionWithOptions(responseText);
        if (parsed && parsed.options.length <= 3) {
          const { sendQuestionWithOptions } = await import(
            '../services/whatsapp/templates.js'
          );
          await sendQuestionWithOptions(userPhone, parsed.body, parsed.options);
        } else if (parsed && parsed.options.length >= 4) {
          const { sendListMessage } = await import(
            '../services/whatsapp/sender.js'
          );
          await sendListMessage(
            userPhone,
            parsed.body,
            'Choose',
            [{ title: 'Options', rows: parsed.options.map((o, i) => ({ id: `option_${i + 1}`, title: o.slice(0, 24) })) }],
          );
        } else {
          await sendText(userPhone, responseText);
        }

        // Persist the assistant's response to the messages table
        const { getDb } = await import('../db/client.js');
        const { messages } = await import('../db/schema.js');
        await getDb().insert(messages).values({
          conversationId,
          role: 'assistant',
          content: responseText,
          messageType: 'text',
        });
      },
      { connection: conn, concurrency: QUEUE.CONVERSATION_CONCURRENCY },
    ),
  );

  workers.push(
    new Worker(
      'planning',
      async (job) => {
        const { processPlanGeneration } = await import('./workers/plan-generator.js');
        await processPlanGeneration(job.data);
      },
      { connection: conn, concurrency: QUEUE.PLANNING_CONCURRENCY },
    ),
  );

  workers.push(
    new Worker(
      'booking',
      async (job) => {
        const { processBrowserBooking } = await import('./workers/browser-booking.js');
        await processBrowserBooking(job.data);
      },
      { connection: conn, concurrency: QUEUE.BOOKING_CONCURRENCY },
    ),
  );

  workers.push(
    new Worker(
      'memory',
      async (job) => {
        if (job.name === 'confidence-decay') {
          const { runConfidenceDecay } = await import('./scheduler.js');
          await runConfidenceDecay();
        } else if (job.name === 'post-trip-check') {
          const { runPostTripCheck } = await import('./scheduler.js');
          await runPostTripCheck();
        } else {
          const { processMemoryExtraction } = await import('./workers/memory-extract.js');
          await processMemoryExtraction(job.data);
        }
      },
      { connection: conn, concurrency: QUEUE.MEMORY_CONCURRENCY },
    ),
  );

  workers.push(
    new Worker(
      'price-check',
      async (job) => {
        const { processPriceCheck } = await import('./workers/price-check.js');
        await processPriceCheck(job.data);
      },
      { connection: conn, concurrency: 2 },
    ),
  );

  logger.info('All queue workers started');
}

export async function stopWorkers(): Promise<void> {
  if (_conversationEvents) await _conversationEvents.close();
  await Promise.all(workers.map((w) => w.close()));
  logger.info('All queue workers stopped');
}
