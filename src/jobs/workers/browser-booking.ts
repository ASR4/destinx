import { executeBookingSession } from '../../services/booking/orchestrator.js';
import { logger } from '../../utils/logger.js';
import type { BookingDetails } from '../../types/booking.js';

export interface BrowserBookingJob {
  sessionId: string;
  userId: string;
  userPhone: string;
  booking: BookingDetails;
  bookingId?: string;
}

export async function processBrowserBooking(
  data: BrowserBookingJob,
): Promise<void> {
  logger.info(
    { userId: data.userId, sessionId: data.sessionId },
    'Browser booking started',
  );

  try {
    const result = await executeBookingSession(
      data.sessionId,
      data.userId,
      data.userPhone,
      data.booking,
      data.bookingId,
    );
    logger.info(
      { sessionId: data.sessionId, status: result.status },
      'Browser booking completed',
    );
  } catch (err) {
    logger.error({ err, sessionId: data.sessionId }, 'Browser booking failed');
    throw err;
  }
}
