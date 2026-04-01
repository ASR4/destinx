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
 * Joins with users table to get phone numbers.
 */
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

    // Queue memory extraction job for post-trip feedback
    await memoryQueue.add('post-trip-feedback', {
      userId: trip.userId,
      tripId: trip.tripId,
      userPhone: trip.userPhone,
    });
  }
}

/**
 * Run the price check sweep: query all active bookings with price data and enqueue individual jobs.
 * Called by the price-check queue worker when the 'check-all-prices' job fires.
 */
export async function runPriceCheckSweep(): Promise<void> {
  const db = getDb();

  // Find active bookings that have a price stored
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
