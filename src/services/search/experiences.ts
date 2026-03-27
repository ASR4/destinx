import { logger } from '../../utils/logger.js';

export interface ExperienceResult {
  name: string;
  description: string;
  duration: string;
  price: { amount: number; currency: string };
  rating: number;
  reviewCount: number;
  category: string;
  bookingUrl: string;
  photos: string[];
}

export interface ExperienceSearchParams {
  destination: string;
  date?: string;
  category?: string;
  durationHours?: number;
  budget?: number;
}

const CATEGORY_QUERIES: Record<string, string> = {
  culture: 'cultural tour museum historical',
  adventure: 'adventure outdoor extreme sports',
  food: 'food tour tasting culinary',
  nature: 'nature hike national park wildlife',
  nightlife: 'nightlife bar crawl evening entertainment',
  wellness: 'spa wellness yoga retreat',
  family: 'family friendly kids activities',
};

export async function searchExperiences(
  params: ExperienceSearchParams,
): Promise<ExperienceResult[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_MAPS_API_KEY not set');
    return [];
  }

  logger.info({ destination: params.destination, category: params.category }, 'Searching experiences');

  const categoryTerms = params.category
    ? CATEGORY_QUERIES[params.category] ?? params.category
    : 'tours activities things to do';

  const textQuery = `${categoryTerms} in ${params.destination}`;

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.photos,places.types,places.editorialSummary',
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
      logger.error({ status: response.status, body: errorText }, 'Google Places experience search error');
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
        editorialSummary?: { text: string };
      }>;
    };

    if (!data.places) return [];

    return data.places.map((place) => {
      const name = place.displayName?.text ?? 'Unknown Experience';
      const photoRefs = (place.photos ?? []).slice(0, 3).map(
        (p) =>
          `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=400&key=${apiKey}`,
      );

      const viatorSearch = `https://www.viator.com/searchResults/all?text=${encodeURIComponent(name + ' ' + params.destination)}`;

      const estimatedPrice = estimatePriceFromLevel(place.priceLevel);

      const types = (place.types ?? []).filter(
        (t) => !['point_of_interest', 'establishment', 'tourist_attraction'].includes(t),
      );

      return {
        name,
        description: place.editorialSummary?.text ?? `${name} in ${params.destination}`,
        duration: params.durationHours ? `${params.durationHours}h` : '2-3h',
        price: estimatedPrice,
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        category: params.category ?? (types[0]?.replace(/_/g, ' ') || 'experience'),
        bookingUrl: viatorSearch,
        photos: photoRefs,
      };
    });
  } catch (err) {
    logger.error({ err }, 'Experience search failed');
    return [];
  }
}

function estimatePriceFromLevel(level?: string): { amount: number; currency: string } {
  switch (level) {
    case 'PRICE_LEVEL_FREE':
      return { amount: 0, currency: 'USD' };
    case 'PRICE_LEVEL_INEXPENSIVE':
      return { amount: 15, currency: 'USD' };
    case 'PRICE_LEVEL_MODERATE':
      return { amount: 40, currency: 'USD' };
    case 'PRICE_LEVEL_EXPENSIVE':
      return { amount: 80, currency: 'USD' };
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return { amount: 150, currency: 'USD' };
    default:
      return { amount: 30, currency: 'USD' };
  }
}
