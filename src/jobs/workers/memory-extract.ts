import { extractPreferences } from '../../services/memory/extractor.js';
import { logger } from '../../utils/logger.js';
import type { Message } from '../../types/conversation.js';

export interface MemoryExtractionJob {
  userId: string;
  messages: Message[];
}

/**
 * Async worker: Extract preferences from conversation messages.
 * Lightweight — runs at high concurrency.
 */
export async function processMemoryExtraction(
  data: MemoryExtractionJob,
): Promise<void> {
  logger.info({ userId: data.userId }, 'Memory extraction started');

  try {
    await extractPreferences(data.userId, data.messages);
    logger.info({ userId: data.userId }, 'Memory extraction completed');
  } catch (err) {
    logger.error({ err, userId: data.userId }, 'Memory extraction failed');
  }
}
