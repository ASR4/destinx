import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { userPreferences, userMemoryEmbeddings, trips } from '../../db/schema.js';
import { embedText } from './embeddings.js';
import { AI, MEMORY } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import type { UserProfile, GroupedPreferences, PreferenceCategory } from '../../types/memory.js';

const CATEGORIES: PreferenceCategory[] = [
  'accommodation', 'food', 'transport', 'budget',
  'travel_style', 'loyalty', 'dietary', 'companion',
];

export async function recallUserProfile(
  userId: string,
): Promise<UserProfile> {
  const db = getDb();

  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  const grouped: GroupedPreferences = {
    accommodation: [], food: [], transport: [], budget: [],
    travel_style: [], loyalty: [], dietary: [], companion: [],
  };

  for (const p of prefs) {
    const cat = p.category as PreferenceCategory;
    if (grouped[cat]) {
      grouped[cat].push({
        id: p.id,
        userId: p.userId,
        category: cat,
        key: p.key,
        value: p.value,
        confidence: p.confidence ?? 0.5,
        source: p.source as 'explicit' | 'inferred' | 'feedback',
        lastConfirmedAt: p.lastConfirmedAt ?? undefined,
        createdAt: p.createdAt ?? new Date(),
        updatedAt: p.updatedAt ?? new Date(),
      });
    }
  }

  const recentTrips = await db
    .select()
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(sql`created_at DESC`)
    .limit(3);

  return {
    preferences: grouped,
    lastTrips: recentTrips.map((t) => ({
      destination: t.destination ?? 'Unknown',
      dates: `${t.startDate ?? '?'} to ${t.endDate ?? '?'}`,
      status: t.status ?? 'unknown',
    })),
  };
}

interface RankedMemory {
  content: string;
  similarity: number;
  createdAt: string;
  confidence: number;
  finalScore: number;
}

/**
 * Search semantic memories by similarity, then rerank using a composite score:
 * final_score = 0.6 * similarity + 0.2 * recency_score + 0.2 * confidence_score
 *
 * Recency score: 1 / (1 + days_since_creation / 365)
 * Confidence score: the confidence value from memory metadata (default 0.5)
 *
 * Returns up to MAX_MEMORY_CONTEXT_TOKENS worth of memory text.
 */
export async function recallRelevantMemories(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<string[]> {
  const queryEmbedding = await embedText(query);
  const db = getDb();

  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const rawMemories = await db.execute(sql`
    SELECT
      content,
      1 - (embedding <=> ${vectorStr}::vector) as similarity,
      created_at,
      COALESCE((metadata->>'confidence')::real, 0.5) as confidence
    FROM user_memory_embeddings
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  const memories = (rawMemories as unknown as Array<{
    content: string;
    similarity: number;
    created_at: string;
    confidence: number;
  }>).filter((m) => m.similarity > AI.MEMORY_SIMILARITY_THRESHOLD);

  if (memories.length === 0) return [];

  const now = Date.now();
  const ranked: RankedMemory[] = memories.map((m) => {
    const createdAtMs = new Date(m.created_at).getTime();
    const daysSince = (now - createdAtMs) / (1000 * 60 * 60 * 24);
    const recencyScore = 1 / (1 + daysSince / 365);
    const confidenceScore = m.confidence;

    const finalScore =
      MEMORY.RERANK_SIMILARITY_WEIGHT * m.similarity +
      MEMORY.RERANK_RECENCY_WEIGHT * recencyScore +
      MEMORY.RERANK_CONFIDENCE_WEIGHT * confidenceScore;

    return {
      content: m.content,
      similarity: m.similarity,
      createdAt: m.created_at,
      confidence: m.confidence,
      finalScore,
    };
  });

  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // Cap at MAX_MEMORY_CONTEXT_TOKENS (~4 chars per token estimate)
  const maxChars = AI.MAX_MEMORY_CONTEXT_TOKENS * 4;
  const result: string[] = [];
  let charCount = 0;

  for (const mem of ranked) {
    if (charCount + mem.content.length > maxChars) break;
    result.push(mem.content);
    charCount += mem.content.length;
  }

  logger.debug(
    { userId, candidateCount: memories.length, returnedCount: result.length },
    'Recalled and reranked memories',
  );

  return result;
}
