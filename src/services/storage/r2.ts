import { S3Client, PutObjectCommand, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import { logger } from '../../utils/logger.js';

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (_client) return _client;

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  _client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

/**
 * Upload a buffer to Cloudflare R2.
 * Returns the public URL on success, or null if R2 is not configured.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? 'travel-agent';
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT ?? '';

  const params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };

  try {
    await client.send(new PutObjectCommand(params));
    // Derive public URL from endpoint (R2 public bucket format)
    const baseUrl = endpoint.replace(/\/+$/, '');
    return `${baseUrl}/${bucket}/${key}`;
  } catch (err) {
    logger.warn({ err, key }, 'Failed to upload to R2');
    return null;
  }
}

/**
 * Upload a PNG screenshot buffer to R2 under the bookings/screenshots/ prefix.
 * Returns the public URL or null.
 */
export async function uploadScreenshot(
  buffer: Buffer,
  sessionId: string,
  stepName: string,
): Promise<string | null> {
  const timestamp = Date.now();
  const key = `bookings/screenshots/${sessionId}/${timestamp}_${stepName}.png`;
  return uploadToR2(buffer, key, 'image/png');
}
