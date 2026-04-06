import { eq, and, lt, sql, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { users, trips, conversations, messages } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

export type NotificationType =
  | 'price_drop'
  | 'price_increase'
  | 'trip_countdown'
  | 'abandoned_plan'
  | 'event_discovery';

interface NotificationPayload {
  userId: string;
  userPhone: string;
  type: NotificationType;
  message: string;
  tripId?: string;
}

/**
 * Send a proactive notification via WhatsApp.
 * All outbound messages include opt-out mechanism.
 */
export async function sendNotification(payload: NotificationPayload): Promise<boolean> {
  const { sendText } = await import('../whatsapp/sender.js');

  const optOutFooter = '\n\n_Reply STOP to turn off alerts_';
  const fullMessage = payload.message + optOutFooter;

  try {
    await sendText(payload.userPhone, fullMessage);
    logger.info(
      { userId: payload.userId, type: payload.type, tripId: payload.tripId },
      'Proactive notification sent',
    );
    return true;
  } catch (err) {
    logger.error({ err, userId: payload.userId, type: payload.type }, 'Failed to send notification');
    return false;
  }
}

/**
 * Check for abandoned trip plans (48+ hours since last message).
 */
export async function checkAbandonedPlans(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const abandoned = await db
    .select({
      conversationId: conversations.id,
      userId: conversations.userId,
      tripId: trips.id,
      destination: trips.destination,
      userPhone: users.phoneNumber,
      lastMessage: sql<Date>`(SELECT MAX(created_at) FROM messages WHERE conversation_id = ${conversations.id})`,
    })
    .from(conversations)
    .innerJoin(users, eq(conversations.userId, users.id))
    .innerJoin(trips, and(
      eq(trips.userId, conversations.userId),
      eq(trips.status, 'planning'),
    ))
    .where(
      and(
        eq(conversations.status, 'active'),
        eq(users.active, true),
      ),
    );

  for (const plan of abandoned) {
    if (!plan.lastMessage || plan.lastMessage > cutoff) continue;

    const destination = plan.destination || 'your trip';
    await sendNotification({
      userId: plan.userId,
      userPhone: plan.userPhone,
      type: 'abandoned_plan',
      message: `Still thinking about ${destination}? I saved your itinerary — want to pick up where we left off? 🗺️`,
      tripId: plan.tripId,
    });
  }
}

/**
 * Send trip countdown reminders at T-7, T-3, and T-1 days.
 */
export async function checkTripCountdowns(): Promise<void> {
  const db = getDb();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]!;

  const checkDays = [7, 3, 1];

  for (const daysOut of checkDays) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysOut);
    const targetStr = targetDate.toISOString().split('T')[0]!;

    const upcomingTrips = await db
      .select({
        tripId: trips.id,
        userId: trips.userId,
        destination: trips.destination,
        startDate: trips.startDate,
        userPhone: users.phoneNumber,
      })
      .from(trips)
      .innerJoin(users, eq(trips.userId, users.id))
      .where(
        and(
          eq(trips.startDate, targetStr),
          eq(trips.status, 'confirmed'),
          eq(users.active, true),
        ),
      );

    for (const trip of upcomingTrips) {
      const emoji = daysOut === 1 ? '🎉' : daysOut === 3 ? '📋' : '✈️';
      const dayWord = daysOut === 1 ? 'tomorrow' : `in ${daysOut} days`;

      await sendNotification({
        userId: trip.userId,
        userPhone: trip.userPhone,
        type: 'trip_countdown',
        message: `${emoji} Your ${trip.destination} trip is ${dayWord}! Need any last-minute help with your itinerary?`,
        tripId: trip.tripId,
      });
    }
  }
}

/**
 * Send price drop or increase alerts.
 * Called by the price check worker when a price change is detected.
 */
export async function sendPriceAlert(
  userId: string,
  userPhone: string,
  type: 'price_drop' | 'price_increase',
  details: {
    itemName: string;
    oldPrice: number;
    newPrice: number;
    currency: string;
    bookingUrl?: string;
    tripId?: string;
  },
): Promise<void> {
  const diff = Math.abs(details.newPrice - details.oldPrice);
  const formattedDiff = `${details.currency}${diff.toLocaleString()}`;

  let message: string;
  if (type === 'price_drop') {
    message = `Good news! ${details.itemName} dropped ${formattedDiff} since yesterday.`;
    if (details.bookingUrl) {
      message += ` Want to lock it in?\n👉 ${details.bookingUrl}`;
    }
  } else {
    message = `Heads up — ${details.itemName} went up ${formattedDiff} since you saved it. Prices for your dates are trending up.`;
  }

  await sendNotification({
    userId,
    userPhone,
    type,
    message,
    tripId: details.tripId,
  });
}
