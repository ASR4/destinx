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

/**
 * Get directions between two points using Google Maps Directions API.
 */
export async function getDirections(
  origin: string,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving',
): Promise<DirectionsResult> {
  // TODO: Implement with Google Maps Directions API
  logger.warn('getDirections not yet implemented');
  throw new Error('Not implemented');
}

/**
 * Get the distance and travel time between two points.
 */
export async function getDistance(
  origin: string,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving',
): Promise<DistanceResult> {
  // TODO: Implement with Google Maps Distance Matrix API
  logger.warn('getDistance not yet implemented');
  throw new Error('Not implemented');
}
