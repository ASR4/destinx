import { checkPriceDrop } from '../../services/planning/pricing.js';
import { logger } from '../../utils/logger.js';

export interface PriceCheckJob {
  bookingId: string;
  originalPrice: number;
  userId: string;
  userPhone: string;
}

/**
 * Async worker: Check if a booked item has dropped in price.
 * Notify the user if there's a significant saving.
 */
export async function processPriceCheck(
  data: PriceCheckJob,
): Promise<void> {
  logger.info({ bookingId: data.bookingId }, 'Price check started');

  try {
    const result = await checkPriceDrop(data.bookingId, data.originalPrice);
    if (result.dropped && result.savings) {
      // TODO: Notify user via WhatsApp about price drop
      logger.info(
        { bookingId: data.bookingId, savings: result.savings },
        'Price drop detected',
      );
    }
  } catch (err) {
    logger.error({ err, bookingId: data.bookingId }, 'Price check failed');
  }
}
