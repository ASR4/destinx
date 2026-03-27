import { logger } from '../../utils/logger.js';

export interface TransportOption {
  mode: string;
  provider?: string;
  duration: string;
  price?: { amount: number; currency: string };
  frequency?: string;
  bookingUrl?: string;
  steps?: string[];
}

export interface TransportSearchParams {
  from: string;
  to: string;
  date?: string;
  preference?: 'fastest' | 'cheapest' | 'scenic' | 'most_comfortable';
}

/**
 * Find transport options between two points.
 * Uses Rome2Rio API for multi-modal transport options.
 */
export async function searchTransport(
  params: TransportSearchParams,
): Promise<TransportOption[]> {
  logger.info({ from: params.from, to: params.to }, 'Searching transport');

  // TODO: Implement with Rome2Rio API
  logger.warn('searchTransport not yet implemented');
  return [];
}
