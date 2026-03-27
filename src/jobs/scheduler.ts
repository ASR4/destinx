import { priceCheckQueue } from './queue.js';
import { logger } from '../utils/logger.js';

/**
 * Set up recurring/scheduled jobs.
 *
 * Jobs:
 * - Price monitoring: Check prices for active bookings every 6 hours
 * - Trip reminders: Send packing list / visa reminders before departure
 * - Post-trip feedback: Ask for feedback 1 day after trip ends
 */
export async function startScheduler(): Promise<void> {
  // TODO: Implement with BullMQ repeatable jobs
  // Example:
  // await priceCheckQueue.add('check-all-prices', {}, {
  //   repeat: { every: 6 * 60 * 60 * 1000 },
  // });

  logger.info('Scheduler started (no jobs configured yet)');
}
