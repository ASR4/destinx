import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import type { BookingResult } from '../../../types/booking.js';
import { logger } from '../../../utils/logger.js';

/**
 * Airbnb booking flow.
 * TODO: Implement with Stagehand.
 */
export class AirbnbProvider extends BaseBookingProvider {
  readonly providerName = 'airbnb.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult> {
    logger.warn('AirbnbProvider not yet implemented');
    throw new Error('Not implemented');
  }
}
