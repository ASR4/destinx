import { logger } from '../../utils/logger.js';

export interface HotelResult {
  name: string;
  address: string;
  rating: number;
  reviewCount: number;
  priceLevel?: number;
  photos: string[];
  website?: string;
  mapsUrl: string;
  bookingComUrl: string;
  loyaltyProgram?: string;
}

export interface HotelSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
  budgetPerNight?: number;
  style?: string;
}

/**
 * Multi-source hotel search.
 * 1. Google Places API for hotel data, ratings, photos
 * 2. Deep links to booking providers
 * 3. (Future) Live price scraping via Stagehand
 */
export async function searchHotels(
  params: HotelSearchParams,
): Promise<HotelResult[]> {
  logger.info({ destination: params.destination }, 'Searching hotels');

  // TODO: Implement with Google Places API
  // const places = await googlePlaces.textSearch({
  //   query: `hotels in ${params.destination}`,
  //   type: 'lodging',
  // });
  // Enrich with details + generate deep links

  logger.warn('searchHotels not yet implemented');
  return [];
}
