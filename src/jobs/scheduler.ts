import { eq, lte, and, sql, isNotNull } from 'drizzle-orm';
import { priceCheckQueue, memoryQueue } from './queue.js';
import { getDb } from '../db/client.js';
import { trips, bookings, users } from '../db/schema.js';
import { decayPreferenceConfidence } from '../services/memory/store.js';
import { logger } from '../utils/logger.js';

/**
 * Set up recurring scheduled jobs using BullMQ repeatable jobs.
 *
 * Jobs:
 * - Price monitoring: Check prices for active bookings every 6 hours
 * - Confidence decay: Decay stale preferences daily
 * - Post-trip feedback: Check for recently ended trips every hour
 * - Abandoned plan follow-up: Check every 6 hours for stale planning conversations
 * - Trip countdown: Check daily for upcoming trips needing reminders
 */
export async function startScheduler(): Promise<void> {
  await cleanRepeatableJobs(priceCheckQueue);
  await cleanRepeatableJobs(memoryQueue);

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

  // Abandoned plan follow-up — every 6 hours
  await memoryQueue.add(
    'abandoned-plan-check',
    {},
    { repeat: { every: 6 * 60 * 60 * 1000 } },
  );

  // Trip countdown reminders — daily at 9 AM UTC
  await memoryQueue.add(
    'trip-countdown',
    {},
    { repeat: { pattern: '0 9 * * *' } },
  );

  logger.info('Scheduler started with repeatable jobs (including notifications)');
}

async function cleanRepeatableJobs(queue: typeof priceCheckQueue): Promise<void> {
  try {
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
    if (existing.length > 0) {
      logger.debug({ queue: queue.name, removed: existing.length }, 'Cleaned stale repeatable jobs');
    }
  } catch (err) {
    logger.warn({ err, queue: queue.name }, 'Failed to clean repeatable jobs');
  }
}

export async function runConfidenceDecay(): Promise<void> {
  const count = await decayPreferenceConfidence();
  logger.info({ decayedCount: count }, 'Confidence decay completed');
}

export async function runPostTripCheck(): Promise<void> {
  const db = getDb();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = new Date().toISOString().split('T')[0]!;
  const yesterdayStr = yesterday.toISOString().split('T')[0]!;

  const endedTrips = await db
    .select({
      tripId: trips.id,
      userId: trips.userId,
      endDate: trips.endDate,
      userPhone: users.phoneNumber,
    })
    .from(trips)
    .innerJoin(users, eq(trips.userId, users.id))
    .where(
      and(
        eq(trips.status, 'confirmed'),
        lte(trips.endDate, todayStr),
        sql`${trips.endDate} >= ${yesterdayStr}`,
        eq(users.active, true),
      ),
    );

  for (const trip of endedTrips) {
    logger.info({ tripId: trip.tripId, userId: trip.userId }, 'Trip ended — queuing post-trip feedback');
    await memoryQueue.add('post-trip-feedback', {
      userId: trip.userId,
      tripId: trip.tripId,
      userPhone: trip.userPhone,
    });
  }
}

export async function runAbandonedPlanCheck(): Promise<void> {
  const { checkAbandonedPlans } = await import('../services/notifications/service.js');
  await checkAbandonedPlans();
  logger.info('Abandoned plan check completed');
}

export async function runTripCountdown(): Promise<void> {
  const { checkTripCountdowns } = await import('../services/notifications/service.js');
  await checkTripCountdowns();
  logger.info('Trip countdown check completed');
}

export async function runPriceCheckSweep(): Promise<void> {
  const db = getDb();

  const activeBookings = await db
    .select({
      id: bookings.id,
      userId: bookings.userId,
      price: bookings.price,
      userPhone: users.phoneNumber,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .where(
      and(
        eq(bookings.status, 'booked'),
        isNotNull(bookings.price),
        eq(users.active, true),
      ),
    );

  logger.info({ count: activeBookings.length }, 'Price check sweep started');

  for (const booking of activeBookings) {
    const price = booking.price as { amount?: number; currency?: string } | null;
    if (!price?.amount) continue;

    await priceCheckQueue.add('check-price', {
      bookingId: booking.id,
      originalPrice: price.amount,
      userId: booking.userId,
      userPhone: booking.userPhone,
    });
  }
}
