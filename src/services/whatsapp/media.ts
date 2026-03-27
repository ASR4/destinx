import { logger } from '../../utils/logger.js';

/**
 * Download media from a Twilio media URL (voice notes, images, PDFs sent by user).
 * Returns the file buffer and content type.
 */
export async function downloadMedia(
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  // TODO: Implement — fetch from Twilio with auth, return buffer
  logger.warn('downloadMedia not yet implemented');
  throw new Error('Not implemented');
}

/**
 * Upload a file (e.g., itinerary PDF) to Cloudflare R2 and return a public URL
 * that can be sent via WhatsApp.
 */
export async function uploadMediaForSharing(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  // TODO: Implement — upload to R2, return public URL
  logger.warn('uploadMediaForSharing not yet implemented');
  throw new Error('Not implemented');
}
