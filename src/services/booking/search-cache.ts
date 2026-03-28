import IORedis from 'ioredis';

const SEARCH_TTL_SECONDS = 1200; // 20 minutes

export interface CachedSearch {
  provider: string;
  offers: unknown[];
}

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (_redis) return _redis;
  _redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return _redis;
}

function generateSearchId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Store flight search results in Redis and return a short searchId.
 * Key format: search:{conversationId}:{searchId}
 * TTL: 20 minutes
 */
export async function storeSearchResults(
  conversationId: string,
  provider: string,
  offers: unknown[],
): Promise<string> {
  const redis = getRedis();
  const searchId = generateSearchId();
  const key = `search:${conversationId}:${searchId}`;
  const value: CachedSearch = { provider, offers };

  await redis.set(key, JSON.stringify(value), 'EX', SEARCH_TTL_SECONDS);

  return searchId;
}

/**
 * Retrieve cached search results by conversationId and searchId.
 * Returns null if not found or expired.
 */
export async function getSearchResults(
  conversationId: string,
  searchId: string,
): Promise<CachedSearch | null> {
  const redis = getRedis();
  const key = `search:${conversationId}:${searchId}`;
  const raw = await redis.get(key);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedSearch;
  } catch {
    return null;
  }
}
