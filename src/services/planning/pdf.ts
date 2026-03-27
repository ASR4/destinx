import { logger } from '../../utils/logger.js';
import type { Itinerary } from '../../types/trip.js';

/**
 * Generate a shareable PDF of a trip itinerary.
 * Upload to R2 and return a public URL for WhatsApp sharing.
 */
export async function generateItineraryPdf(
  itinerary: Itinerary,
  tripTitle: string,
): Promise<string> {
  // TODO: Implement with a PDF library (e.g., @react-pdf/renderer, pdfkit, or jspdf)
  // - Render itinerary days with times, venues, prices
  // - Include maps/directions between venues
  // - Add booking confirmation references
  // - Upload to Cloudflare R2
  // - Return public URL
  logger.warn('generateItineraryPdf not yet implemented');
  throw new Error('Not implemented');
}
