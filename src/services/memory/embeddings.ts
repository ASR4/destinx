import { getDb } from '../../db/client.js';
import { userMemoryEmbeddings } from '../../db/schema.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

/**
 * Generate an embedding vector for a text string.
 * Uses Voyage AI or OpenAI embeddings API.
 */
export async function embedText(text: string): Promise<number[]> {
  // TODO: Implement with Voyage AI or OpenAI
  // const response = await voyageClient.embed({ input: text, model: 'voyage-2' });
  // return response.data[0].embedding;
  logger.warn('embedText not yet implemented — returning zero vector');
  return new Array(AI.EMBEDDING_DIMENSIONS).fill(0);
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
