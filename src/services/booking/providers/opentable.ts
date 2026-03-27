import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import type { BookingResult } from '../../../types/booking.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenTable restaurant reservation flow.
 * TODO: Implement with Stagehand.
 */
export class OpenTableProvider extends BaseBookingProvider {
  readonly providerName = 'opentable.com';

  async execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult> {
    logger.warn('OpenTableProvider not yet implemented');
    throw new Error('Not implemented');
  }
}
