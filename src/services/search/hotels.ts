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

const STYLE_KEYWORDS: Record<string, string> = {
  luxury: 'luxury 5-star hotel',
  boutique: 'boutique hotel',
  'mid-range': 'hotel',
  budget: 'budget hotel',
  hostel: 'hostel',
};

/**
 * Search for hotels using Google Places API (New) Text Search.
 * Maps results to HotelResult and generates booking deep links.
 */
export async function searchHotels(
  params: HotelSearchParams,
): Promise<HotelResult[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_MAPS_API_KEY not set');
    return [];
  }

  logger.info({ destination: params.destination }, 'Searching hotels');

  const styleQuery = params.style ? STYLE_KEYWORDS[params.style] ?? params.style : 'hotel';
  const textQuery = `${styleQuery} in ${params.destination}`;

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri,places.googleMapsUri,places.photos',
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: 10,
          languageCode: 'en',
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, body: errorText }, 'Google Places API error');
      return [];
    }

    const data = (await response.json()) as {
      places?: Array<{
        displayName?: { text: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
        priceLevel?: string;
        websiteUri?: string;
        googleMapsUri?: string;
        photos?: Array<{ name: string }>;
      }>;
    };

    if (!data.places) return [];

    const bookingParams = new URLSearchParams({
      checkin: params.checkIn,
      checkout: params.checkOut,
      group_adults: String(params.guests ?? 2),
      no_rooms: '1',
    });

    return data.places.map((place) => {
      const name = place.displayName?.text ?? 'Unknown Hotel';
      const photoRefs = (place.photos ?? []).slice(0, 3).map(
        (p) => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=400&key=${apiKey}`,
      );

      return {
        name,
        address: place.formattedAddress ?? '',
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        priceLevel: priceLevelToNumber(place.priceLevel),
        photos: photoRefs,
        website: place.websiteUri,
        mapsUrl: place.googleMapsUri ?? '',
        bookingComUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(name + ' ' + params.destination)}&${bookingParams}`,
        loyaltyProgram: detectLoyaltyProgram(name),
      };
    });
  } catch (err) {
    logger.error({ err }, 'Hotel search failed');
    return [];
  }
}

function priceLevelToNumber(level?: string): number | undefined {
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return level ? map[level] : undefined;
}

function detectLoyaltyProgram(hotelName: string): string | undefined {
  const lower = hotelName.toLowerCase();
  if (/marriott|sheraton|westin|w hotel|ritz.?carlton|st\.?\s*regis|courtyard/i.test(lower))
    return 'Marriott Bonvoy';
  if (/hilton|doubletree|conrad|waldorf|hampton|embassy suites/i.test(lower))
    return 'Hilton Honors';
  if (/hyatt|park hyatt|andaz|grand hyatt/i.test(lower))
    return 'World of Hyatt';
  if (/ihg|intercontinental|crowne plaza|holiday inn|kimpton/i.test(lower))
    return 'IHG One Rewards';
  if (/accor|novotel|sofitel|fairmont|pullman|ibis/i.test(lower))
    return 'Accor Live Limitless';
  return undefined;
}
