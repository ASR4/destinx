import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import type { BookingResult } from '../../../types/booking.js';
import { logger } from '../../../utils/logger.js';

/**
 * Viator experience booking flow.
 * TODO: Implement with Stagehand.
 */
export class ViatorProvider extends BaseBookingProvider {
  readonly providerName = 'viator.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult> {
    logger.warn('ViatorProvider not yet implemented');
    throw new Error('Not implemented');
  }
}
