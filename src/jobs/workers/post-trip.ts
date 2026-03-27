import { eq } from 'drizzle-orm';
import { sendText } from '../../services/whatsapp/sender.js';
import { extractPreferences } from '../../services/memory/extractor.js';
import { getDb } from '../../db/client.js';
import { trips } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import type { Message } from '../../types/conversation.js';

export interface PostTripJob {
  userId: string;
  tripId: string;
  userPhone: string;
}

/**
 * Send post-trip feedback request and extract preferences from any response.
 * Scheduled to run 1 day after the trip end date.
 */
export async function processPostTripFeedback(
  data: PostTripJob,
): Promise<void> {
  logger.info({ userId: data.userId, tripId: data.tripId }, 'Sending post-trip feedback request');

  const db = getDb();
  const tripRows = await db
    .select({ destination: trips.destination })
    .from(trips)
    .where(eq(trips.id, data.tripId))
    .limit(1);

  const destination = tripRows[0]?.destination ?? 'your trip';

  await sendText(
    data.userPhone,
    [
      `✈️ Welcome back from ${destination}! 🎉`,
      '',
      "I'd love to hear how it went so I can make your next trip even better.",
      '',
      'A few quick questions:',
      '1️⃣ What was the highlight of the trip?',
      '2️⃣ Anything that didn\'t quite work out?',
      '3️⃣ Would you go back? Rate it 1-5 ⭐',
      '',
      'Or just share anything that comes to mind — I remember everything for next time! 😊',
    ].join('\n'),
  );

  await db
    .update(trips)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(trips.id, data.tripId));

  logger.info({ tripId: data.tripId }, 'Post-trip feedback sent');
}
