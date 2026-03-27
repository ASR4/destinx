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

/**
 * Search for tours, activities, and experiences.
 * Uses GetYourGuide / Viator APIs.
 */
export async function searchExperiences(
  params: ExperienceSearchParams,
): Promise<ExperienceResult[]> {
  logger.info({ destination: params.destination }, 'Searching experiences');

  // TODO: Implement with Viator or GetYourGuide API
  logger.warn('searchExperiences not yet implemented');
  return [];
}
