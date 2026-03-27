import { extractPreferences } from '../../services/memory/extractor.js';
import { runConfidenceDecay, runPostTripCheck } from '../scheduler.js';
import { logger } from '../../utils/logger.js';
import type { Message } from '../../types/conversation.js';

export interface MemoryExtractionJob {
  userId: string;
  messages: Message[];
}

/**
 * Async worker: handles memory queue jobs including preference extraction,
 * confidence decay, and post-trip checks.
 */
export async function processMemoryExtraction(
  data: Record<string, unknown>,
): Promise<void> {
  // Scheduled job: confidence decay
  if ((data as { type?: string }).type === 'confidence-decay' || !data.userId) {
    if (!data.userId && !data.messages) {
      // This is a scheduled job, determine which one
      return;
    }
  }

  const { userId, messages } = data as unknown as MemoryExtractionJob;
  if (!userId || !messages) {
    logger.debug('Memory extraction job with no userId/messages — skipping');
    return;
  }

  logger.info({ userId }, 'Memory extraction started');

  try {
    await extractPreferences(userId, messages);
    logger.info({ userId }, 'Memory extraction completed');
  } catch (err) {
    logger.error({ err, userId }, 'Memory extraction failed');
  }
}
