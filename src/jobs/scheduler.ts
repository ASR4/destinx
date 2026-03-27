import { eq, lte, and, sql } from 'drizzle-orm';
import { priceCheckQueue, memoryQueue } from './queue.js';
import { getDb } from '../db/client.js';
import { trips, bookings } from '../db/schema.js';
import { decayPreferenceConfidence } from '../services/memory/store.js';
import { logger } from '../utils/logger.js';

/**
 * Set up recurring scheduled jobs using BullMQ repeatable jobs.
 *
 * Jobs:
 * - Price monitoring: Check prices for active bookings every 6 hours
 * - Confidence decay: Decay stale preferences daily
 * - Post-trip feedback: Check for recently ended trips every hour
 */
export async function startScheduler(): Promise<void> {
  // Price monitoring — every 6 hours
  await priceCheckQueue.add(
    'check-all-prices',
    {},
    { repeat: { every: 6 * 60 * 60 * 1000 } },
  );

  // Confidence decay — daily at 3 AM UTC
  await memoryQueue.add(
    'confidence-decay',
    {},
    { repeat: { pattern: '0 3 * * *' } },
  );

  // Post-trip feedback check — every hour
  await memoryQueue.add(
    'post-trip-check',
    {},
    { repeat: { every: 60 * 60 * 1000 } },
  );

  logger.info('Scheduler started with repeatable jobs');
}

/**
 * Process the confidence decay job.
 * Called by the memory queue worker when the 'confidence-decay' job fires.
 */
export async function runConfidenceDecay(): Promise<void> {
  const count = await decayPreferenceConfidence();
  logger.info({ decayedCount: count }, 'Confidence decay completed');
}

/**
 * Check for trips that ended recently and queue post-trip feedback.
 * Called by the memory queue worker when the 'post-trip-check' job fires.
 */
export async function runPostTripCheck(): Promise<void> {
  const db = getDb();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = new Date().toISOString().split('T')[0]!;
  const yesterdayStr = yesterday.toISOString().split('T')[0]!;

  const endedTrips = await db
    .select({
      id: trips.id,
      userId: trips.userId,
      endDate: trips.endDate,
    })
    .from(trips)
    .where(
      and(
        eq(trips.status, 'confirmed'),
        lte(trips.endDate, todayStr),
        sql`${trips.endDate} >= ${yesterdayStr}`,
      ),
    );

  for (const trip of endedTrips) {
    // Queue post-trip feedback (the worker needs the user's phone — TODO: join with users table)
    logger.info({ tripId: trip.id, userId: trip.userId }, 'Trip ended — queuing post-trip feedback');
  }
}
