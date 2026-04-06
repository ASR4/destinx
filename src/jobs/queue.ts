import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { logger } from '../utils/logger.js';
import { QUEUE } from '../config/constants.js';

let _connection: ConnectionOptions | null = null;

function getConnection(): ConnectionOptions {
  if (_connection) return _connection;
  _connection = {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  };
  return _connection;
}

const retryOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
};

export const conversationQueue = new Queue('conversation', {
  connection: getConnection(),
  defaultJobOptions: { ...retryOptions, removeOnComplete: 100, removeOnFail: 500 },
});
export const planningQueue = new Queue('planning', {
  connection: getConnection(),
  defaultJobOptions: { ...retryOptions, removeOnComplete: 50, removeOnFail: 200 },
});
export const bookingQueue = new Queue('booking', {
  connection: getConnection(),
  defaultJobOptions: { ...retryOptions, removeOnComplete: 50, removeOnFail: 200 },
});
export const memoryQueue = new Queue('memory', {
  connection: getConnection(),
  defaultJobOptions: { attempts: 2, backoff: { type: 'fixed' as const, delay: 1000 }, removeOnComplete: 100, removeOnFail: 200 },
});
export const priceCheckQueue = new Queue('price-check', {
  connection: getConnection(),
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential' as const, delay: 5000 }, removeOnComplete: 50, removeOnFail: 100 },
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

/**
 * Attach standard error + failed event handlers to a worker.
 * On permanent failure: logs to DLQ, sends apology message if applicable.
 */
function attachWorkerEvents(worker: Worker, name: string): void {
  worker.on('failed', async (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? retryOptions.attempts;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (attemptsMade >= maxAttempts) {
      logger.error(
        { jobId: job?.id, jobName: job?.name, attemptsMade, error: errMsg, data: job?.data },
        `[DLQ] ${name} job permanently failed after ${attemptsMade} attempts: ${errMsg}`,
      );

      // Dead letter handler: send apology if the user hasn't heard back
      if (name === 'conversation' && job?.data) {
        const data = job.data as { userPhone?: string };
        if (data.userPhone) {
          try {
            const { sendText } = await import('../services/whatsapp/sender.js');
            await sendText(
              data.userPhone,
              "I'm sorry, I had trouble processing that. Could you try again? 🙏",
            );
          } catch {
            // Last resort: can't even send apology
          }
        }
      }
    } else {
      logger.warn(
        { jobId: job?.id, jobName: job?.name, attemptsMade, maxAttempts, error: errMsg },
        `${name} job failed — will retry (${attemptsMade}/${maxAttempts}): ${errMsg}`,
      );
    }
  });
  worker.on('error', (err) => logger.error({ err }, `${name} worker error`));
}

export function startWorkers(): void {
  const conn = getConnection();

  const makeWorker = (name: string, handler: (job: Job<any>) => Promise<void>, concurrency: number): Worker => {
    const w = new Worker(name, handler, { connection: conn, concurrency });
    attachWorkerEvents(w, name);
    workers.push(w);
    return w;
  };

  // --- Conversation worker: runs the engine + sends holding messages via progress ---
  makeWorker('conversation', async (job) => {
    const { userId, conversationId, message, userPhone, correlationId } = job.data as {
      userId: string;
      conversationId: string;
      message: string;
      userPhone: string;
      correlationId?: string;
    };

    const { withCorrelation, generateCorrelationId } = await import('../utils/correlation.js');
    const cid = correlationId ?? generateCorrelationId();

    return withCorrelation({ correlationId: cid, userId, conversationId }, async () => {
    const { processMessage } = await import('../services/conversation/engine.js');
    const { sendText } = await import('../services/whatsapp/sender.js');

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
      const { sendQuestionWithOptions } = await import('../services/whatsapp/templates.js');
      await sendQuestionWithOptions(userPhone, parsed.body, parsed.options);
    } else if (parsed && parsed.options.length >= 4) {
      const { sendListMessage } = await import('../services/whatsapp/sender.js');
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
    }); // end withCorrelation
  }, QUEUE.CONVERSATION_CONCURRENCY);

  makeWorker('planning', async (job) => {
    const { processPlanGeneration } = await import('./workers/plan-generator.js');
    await processPlanGeneration(job.data);
  }, QUEUE.PLANNING_CONCURRENCY);

  makeWorker('booking', async (job) => {
    const { processBrowserBooking } = await import('./workers/browser-booking.js');
    await processBrowserBooking(job.data);
  }, QUEUE.BOOKING_CONCURRENCY);

  makeWorker('memory', async (job) => {
    try {
      if (job.name === 'confidence-decay') {
        const { runConfidenceDecay } = await import('./scheduler.js');
        await runConfidenceDecay();
      } else if (job.name === 'post-trip-check') {
        const { runPostTripCheck } = await import('./scheduler.js');
        await runPostTripCheck();
      } else if (job.name === 'abandoned-plan-check') {
        const { runAbandonedPlanCheck } = await import('./scheduler.js');
        await runAbandonedPlanCheck();
      } else if (job.name === 'trip-countdown') {
        const { runTripCountdown } = await import('./scheduler.js');
        await runTripCountdown();
      } else {
        const { processMemoryExtraction } = await import('./workers/memory-extract.js');
        await processMemoryExtraction(job.data);
      }
    } catch (err) {
      logger.error({ err, jobName: job.name, jobId: job.id }, 'Memory worker job failed');
    }
  }, QUEUE.MEMORY_CONCURRENCY);

  makeWorker('price-check', async (job) => {
    try {
      const { processPriceCheck } = await import('./workers/price-check.js');
      await processPriceCheck(job.data);
    } catch (err) {
      logger.error({ err, jobName: job.name, jobId: job.id }, 'Price-check worker job failed');
    }
  }, 2);

  logger.info('All queue workers started');
}

export async function stopWorkers(): Promise<void> {
  if (_conversationEvents) await _conversationEvents.close();
  await Promise.all(workers.map((w) => w.close()));
  logger.info('All queue workers stopped');
}
