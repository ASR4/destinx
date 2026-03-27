import { logger } from '../../utils/logger.js';

export interface FlightOffer {
  airline: string;
  flightNumber: string;
  departure: { airport: string; time: string };
  arrival: { airport: string; time: string };
  duration: string;
  stops: number;
  price: { amount: number; currency: string };
  cabinClass: string;
  bookingUrl?: string;
}

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers?: number;
  cabinClass?: string;
  preferredAirlines?: string[];
}

let _amadeusToken: { token: string; expiresAt: number } | null = null;

async function getAmadeusToken(): Promise<string | null> {
  if (_amadeusToken && Date.now() < _amadeusToken.expiresAt) {
    return _amadeusToken.token;
  }

  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.error('AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET not set');
    return null;
  }

  try {
    const response = await fetch(
      'https://api.amadeus.com/v1/security/oauth2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Amadeus OAuth2 failed');
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    _amadeusToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };

    return _amadeusToken.token;
  } catch (err) {
    logger.error({ err }, 'Amadeus token request failed');
    return null;
  }
}

const CABIN_CLASS_MAP: Record<string, string> = {
  economy: 'ECONOMY',
  premium_economy: 'PREMIUM_ECONOMY',
  business: 'BUSINESS',
  first: 'FIRST',
};

/**
 * Search for flights using the Amadeus Flight Offers Search v2 API.
 */
export async function searchFlights(
  params: FlightSearchParams,
): Promise<FlightOffer[]> {
  logger.info({ origin: params.origin, dest: params.destination }, 'Searching flights');

  const token = await getAmadeusToken();
  if (!token) return [];

  const searchParams = new URLSearchParams({
    originLocationCode: params.origin.toUpperCase(),
    destinationLocationCode: params.destination.toUpperCase(),
    departureDate: params.departureDate,
    adults: String(params.passengers ?? 1),
    max: '10',
    currencyCode: 'USD',
  });

  if (params.returnDate) {
    searchParams.set('returnDate', params.returnDate);
  }
  if (params.cabinClass) {
    const mapped = CABIN_CLASS_MAP[params.cabinClass];
    if (mapped) searchParams.set('travelClass', mapped);
  }

  try {
    const response = await fetch(
      `https://api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, body: errorBody }, 'Amadeus flight search failed');
      return [];
    }

    const data = (await response.json()) as {
      data?: Array<{
        itineraries: Array<{
          duration: string;
          segments: Array<{
            departure: { iataCode: string; at: string };
            arrival: { iataCode: string; at: string };
            carrierCode: string;
            number: string;
          }>;
        }>;
        price: { total: string; currency: string };
        travelerPricings?: Array<{ fareDetailsBySegment: Array<{ cabin: string }> }>;
      }>;
      dictionaries?: { carriers?: Record<string, string> };
    };

    if (!data.data) return [];
    const carriers = data.dictionaries?.carriers ?? {};

    return data.data.map((offer) => {
      const firstItinerary = offer.itineraries[0]!;
      const firstSegment = firstItinerary.segments[0]!;
      const lastSegment = firstItinerary.segments[firstItinerary.segments.length - 1]!;
      const airlineCode = firstSegment.carrierCode;

      return {
        airline: carriers[airlineCode] ?? airlineCode,
        flightNumber: `${airlineCode}${firstSegment.number}`,
        departure: {
          airport: firstSegment.departure.iataCode,
          time: firstSegment.departure.at,
        },
        arrival: {
          airport: lastSegment.arrival.iataCode,
          time: lastSegment.arrival.at,
        },
        duration: formatDuration(firstItinerary.duration),
        stops: firstItinerary.segments.length - 1,
        price: {
          amount: parseFloat(offer.price.total),
          currency: offer.price.currency,
        },
        cabinClass: offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin ?? 'ECONOMY',
        bookingUrl: `https://www.google.com/travel/flights?q=flights+${firstSegment.departure.iataCode}+to+${lastSegment.arrival.iataCode}+on+${params.departureDate}`,
      };
    });
  } catch (err) {
    logger.error({ err }, 'Flight search failed');
    return [];
  }
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const hours = match[1] ? `${match[1]}h` : '';
  const minutes = match[2] ? `${match[2]}m` : '';
  return `${hours}${minutes}` || isoDuration;
}
