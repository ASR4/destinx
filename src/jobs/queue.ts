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

        await sendText(userPhone, responseText);
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
        const { processMemoryExtraction } = await import('./workers/memory-extract.js');
        await processMemoryExtraction(job.data);
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
