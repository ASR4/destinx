import { logger } from '../../utils/logger.js';

export interface DirectionsResult {
  distance: string;
  duration: string;
  steps: string[];
  mode: string;
}

export interface DistanceResult {
  distanceKm: number;
  durationMinutes: number;
}

export async function getDirections(
  origin: string,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving',
): Promise<DirectionsResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY not set');
  }

  const params = new URLSearchParams({
    origin,
    destination,
    mode,
    key: apiKey,
  });

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params}`,
  );

  if (!response.ok) {
    throw new Error(`Directions API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    routes?: Array<{
      legs?: Array<{
        distance?: { text: string };
        duration?: { text: string };
        steps?: Array<{ html_instructions?: string }>;
      }>;
    }>;
  };

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(`Directions API: ${data.status}`);
  }

  const leg = data.routes[0]!.legs?.[0];
  if (!leg) throw new Error('No route leg found');

  return {
    distance: leg.distance?.text ?? 'unknown',
    duration: leg.duration?.text ?? 'unknown',
    steps: (leg.steps ?? []).map(
      (s) => (s.html_instructions ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '),
    ).filter(Boolean),
    mode,
  };
}

export async function getDistance(
  origin: string,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving',
): Promise<DistanceResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY not set');
  }

  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    mode,
    key: apiKey,
  });

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
  );

  if (!response.ok) {
    throw new Error(`Distance Matrix API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    rows?: Array<{
      elements?: Array<{
        status: string;
        distance?: { value: number };
        duration?: { value: number };
      }>;
    }>;
  };

  if (data.status !== 'OK') {
    throw new Error(`Distance Matrix API: ${data.status}`);
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    throw new Error('No distance result found');
  }

  return {
    distanceKm: Math.round((element.distance?.value ?? 0) / 100) / 10,
    durationMinutes: Math.round((element.duration?.value ?? 0) / 60),
  };
}
