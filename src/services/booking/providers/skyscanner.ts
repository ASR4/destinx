import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import type { BookingResult } from '../../../types/booking.js';
import { logger } from '../../../utils/logger.js';

/**
 * Skyscanner flight search + booking flow.
 * TODO: Implement with Stagehand.
 */
export class SkyscannerProvider extends BaseBookingProvider {
  readonly providerName = 'skyscanner.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult> {
    logger.warn('SkyscannerProvider not yet implemented');
    throw new Error('Not implemented');
  }
}
