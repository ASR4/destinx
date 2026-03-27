import { logger } from '../../utils/logger.js';

export interface PriceQuote {
  provider: string;
  price: number;
  currency: string;
  url: string;
  fetchedAt: Date;
}

/**
 * Fetch live prices for a booking item from multiple providers.
 * Uses APIs where available, falls back to browser scraping.
 */
export async function fetchLivePrices(
  type: 'hotel' | 'flight' | 'experience',
  details: Record<string, unknown>,
): Promise<PriceQuote[]> {
  // TODO: Implement per-type price fetching
  // Hotels: Google Places → Booking.com API → scrape
  // Flights: Amadeus API
  // Experiences: Viator/GYG API
  logger.warn('fetchLivePrices not yet implemented');
  return [];
}

/**
 * Monitor prices for booked items and alert user if price drops.
 */
export async function checkPriceDrop(
  bookingId: string,
  originalPrice: number,
): Promise<{ dropped: boolean; newPrice?: number; savings?: number }> {
  // TODO: Implement — compare current price to original
  logger.warn('checkPriceDrop not yet implemented');
  return { dropped: false };
}
