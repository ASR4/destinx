import { logger } from '../../utils/logger.js';

export interface PostTripJob {
  userId: string;
  tripId: string;
  userPhone: string;
}

/**
 * Async worker: Send post-trip feedback request.
 * Scheduled to run a day or two after trip end date.
 */
export async function processPostTripFeedback(
  data: PostTripJob,
): Promise<void> {
  logger.info({ userId: data.userId, tripId: data.tripId }, 'Post-trip feedback');

  // TODO: Implement
  // 1. Send WhatsApp message asking how the trip went
  // 2. Collect feedback (ratings, highlights, issues)
  // 3. Extract preferences from feedback
  // 4. Update user profile
  throw new Error('Not implemented');
}
