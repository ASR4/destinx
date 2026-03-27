import { logger } from '../../utils/logger.js';

export interface RestaurantResult {
  name: string;
  address: string;
  cuisine: string[];
  rating: number;
  reviewCount: number;
  priceLevel: number;
  photos: string[];
  mapsUrl: string;
  openTableUrl?: string;
  openingHours?: string[];
}

export interface RestaurantSearchParams {
  location: string;
  cuisine?: string;
  priceLevel?: 'budget' | 'moderate' | 'fine_dining';
  dietary?: string[];
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'brunch';
}

const PRICE_LEVEL_MAP: Record<string, string[]> = {
  budget: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_FREE'],
  moderate: ['PRICE_LEVEL_MODERATE'],
  fine_dining: ['PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'],
};

function priceLevelToNumber(level?: string): number {
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return level ? map[level] ?? 0 : 0;
}

export async function searchRestaurants(
  params: RestaurantSearchParams,
): Promise<RestaurantResult[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_MAPS_API_KEY not set');
    return [];
  }

  logger.info({ location: params.location, cuisine: params.cuisine }, 'Searching restaurants');

  const parts: string[] = [];
  if (params.cuisine) parts.push(params.cuisine);
  if (params.dietary?.length) parts.push(params.dietary.join(' '));
  if (params.meal) parts.push(params.meal);
  parts.push('restaurant');
  parts.push('in');
  parts.push(params.location);

  const textQuery = parts.join(' ');

  try {
    const body: Record<string, unknown> = {
      textQuery,
      maxResultCount: 10,
      languageCode: 'en',
    };

    if (params.priceLevel && PRICE_LEVEL_MAP[params.priceLevel]) {
      body.priceLevels = PRICE_LEVEL_MAP[params.priceLevel];
    }

    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.photos,places.types,places.currentOpeningHours',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, body: errorText }, 'Google Places restaurant search error');
      return [];
    }

    const data = (await response.json()) as {
      places?: Array<{
        displayName?: { text: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
        priceLevel?: string;
        googleMapsUri?: string;
        photos?: Array<{ name: string }>;
        types?: string[];
        currentOpeningHours?: { weekdayDescriptions?: string[] };
      }>;
    };

    if (!data.places) return [];

    return data.places.map((place) => {
      const name = place.displayName?.text ?? 'Unknown Restaurant';
      const photoRefs = (place.photos ?? []).slice(0, 3).map(
        (p) =>
          `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=400&key=${apiKey}`,
      );

      const cuisineTypes = (place.types ?? [])
        .filter((t) => !['restaurant', 'food', 'point_of_interest', 'establishment'].includes(t))
        .map((t) => t.replace(/_/g, ' '));

      const openTableSearch = `https://www.opentable.com/s?term=${encodeURIComponent(name)}&originCorrid=36`;

      return {
        name,
        address: place.formattedAddress ?? '',
        cuisine: cuisineTypes.length > 0 ? cuisineTypes : params.cuisine ? [params.cuisine] : [],
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        priceLevel: priceLevelToNumber(place.priceLevel),
        photos: photoRefs,
        mapsUrl: place.googleMapsUri ?? '',
        openTableUrl: openTableSearch,
        openingHours: place.currentOpeningHours?.weekdayDescriptions,
      };
    });
  } catch (err) {
    logger.error({ err }, 'Restaurant search failed');
    return [];
  }
}
