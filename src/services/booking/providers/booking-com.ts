import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import type { BookingResult } from '../../../types/booking.js';
import { logger } from '../../../utils/logger.js';

/**
 * Booking.com booking flow.
 * TODO: Implement with Stagehand — similar pattern to Marriott.
 */
export class BookingComProvider extends BaseBookingProvider {
  readonly providerName = 'booking.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult> {
    logger.warn('BookingComProvider not yet implemented');
    throw new Error('Not implemented');
  }
}
