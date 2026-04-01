import { checkPriceDrop } from '../../services/planning/pricing.js';
import { sendText } from '../../services/whatsapp/sender.js';
import { toWhatsAppAddress } from '../../utils/phone.js';
import { logger } from '../../utils/logger.js';

export interface PriceCheckJob {
  bookingId: string;
  originalPrice: number;
  userId: string;
  userPhone: string;
}

const DROP_THRESHOLD = 0.10; // 10% drop triggers notification

/**
 * Async worker: Check if a booked item has dropped in price.
 * Notify the user via WhatsApp if there's a >10% saving.
 *
 * Handles two job types:
 * - 'check-all-prices': Triggers the DB sweep, enqueues individual jobs
 * - 'check-price': Checks a single booking
 */
export async function processPriceCheck(
  data: Record<string, unknown>,
): Promise<void> {
  // check-all-prices sweep job — delegate to scheduler
  if (!data.bookingId) {
    const { runPriceCheckSweep } = await import('../scheduler.js');
    await runPriceCheckSweep();
    return;
  }

  const job = data as unknown as PriceCheckJob;
  logger.info({ bookingId: job.bookingId }, 'Price check started');

  try {
    const result = await checkPriceDrop(job.bookingId, job.originalPrice);

    if (!result.dropped || !result.savings || !result.newPrice) return;

    const savingsPct = Math.round((result.savings / job.originalPrice) * 100);
    if (savingsPct < DROP_THRESHOLD * 100) return;

    const whatsappTo = toWhatsAppAddress(job.userPhone);
    const message = `💰 *Price Drop Alert!*\n\nYour booking has dropped in price!\n\nOriginal: $${job.originalPrice.toFixed(2)}\nNew price: $${result.newPrice.toFixed(2)}\nYou could save: *$${result.savings.toFixed(2)} (${savingsPct}% off)*\n\nWould you like me to rebook at the lower price? Reply *Yes* to proceed.`;

    await sendText(whatsappTo, message);
    logger.info({ bookingId: job.bookingId, savings: result.savings }, 'Price drop notification sent');
  } catch (err) {
    logger.error({ err, bookingId: job.bookingId }, 'Price check failed');
  }
}
