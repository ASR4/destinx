import { getDb } from '../../db/client.js';
import { userMemoryEmbeddings } from '../../db/schema.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

/**
 * Generate an embedding vector using Voyage AI (voyage-large-2).
 * Falls back to a zero vector if the API key is missing or the call fails.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    logger.warn('VOYAGE_API_KEY not set — returning zero vector');
    return new Array(AI.EMBEDDING_DIMENSIONS).fill(0);
  }

  try {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-large-2',
        input: [text],
        input_type: 'document',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, body: errorText }, 'Voyage AI embedding failed');
      return new Array(AI.EMBEDDING_DIMENSIONS).fill(0);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (!data.data?.[0]?.embedding) {
      logger.error('Voyage AI returned no embedding data');
      return new Array(AI.EMBEDDING_DIMENSIONS).fill(0);
    }

    return data.data[0].embedding;
  } catch (err) {
    logger.error({ err }, 'Voyage AI embedding request failed');
    return new Array(AI.EMBEDDING_DIMENSIONS).fill(0);
  }
}

/**
 * Embed a text snippet and store it as a semantic memory for the user.
 */
export async function storeMemoryEmbedding(
  userId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const embedding = await embedText(content);
  const db = getDb();

  await db.insert(userMemoryEmbeddings).values({
    userId,
    content,
    embedding,
    metadata: metadata ?? null,
  });

  logger.debug({ userId, content: content.slice(0, 80) }, 'Semantic memory stored');
}
