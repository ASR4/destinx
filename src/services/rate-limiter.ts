import { RATE_LIMITS } from '../config/constants.js';
import { getRedisClient } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

function getRedis() {
  const redis = getRedisClient();
  if (!redis) throw new Error('Redis not configured');
  return redis;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Generic sliding-window rate limiter backed by Redis sorted sets.
 */
async function checkRateLimit(
  key: string,
  maxCount: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, now - windowMs);
  multi.zcard(key);
  multi.zadd(key, String(now), `${now}-${Math.random()}`);
  multi.expire(key, windowSeconds);
  const results = await multi.exec();

  const currentCount = (results?.[1]?.[1] as number) ?? 0;
  const allowed = currentCount < maxCount;

  if (!allowed) {
    const redis2 = getRedis();
    await redis2.zrem(key, `${now}-${Math.random()}`);
  }

  const oldestStr = await redis.zrange(key, 0, 0, 'WITHSCORES');
  const oldestTimestamp = oldestStr.length >= 2 ? parseInt(oldestStr[1]!, 10) : now;
  const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

  return {
    allowed,
    remaining: Math.max(0, maxCount - currentCount - (allowed ? 1 : 0)),
    resetInSeconds: Math.max(0, resetInSeconds),
  };
}

/**
 * Atomic counter for concurrency limits (increment/decrement).
 */
async function checkConcurrencyLimit(
  key: string,
  maxConcurrent: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const current = await redis.get(key);
  const count = parseInt(current ?? '0', 10);

  if (count >= maxConcurrent) {
    return { allowed: false, remaining: 0, resetInSeconds: 60 };
  }

  await redis.incr(key);
  await redis.expire(key, 3600);
  return { allowed: true, remaining: maxConcurrent - count - 1, resetInSeconds: 0 };
}

async function releaseConcurrency(key: string): Promise<void> {
  const redis = getRedis();
  const val = await redis.decr(key);
  if (val < 0) await redis.set(key, '0');
}

// --- Public API ---

export async function checkUserBrowserLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `rl:browser:${userId}`,
    RATE_LIMITS.USER_BROWSER_SESSIONS_PER_DAY,
    86400,
  );
}

export async function checkUserClaudeLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `rl:claude:${userId}`,
    RATE_LIMITS.USER_CLAUDE_CALLS_PER_HOUR,
    3600,
  );
}

export async function checkUserActiveTripLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `rl:trips:${userId}`,
    RATE_LIMITS.USER_ACTIVE_TRIP_PLANS,
    86400 * 30,
  );
}

export async function acquireSystemBrowserSlot(): Promise<RateLimitResult> {
  return checkConcurrencyLimit(
    'rl:sys:browser',
    RATE_LIMITS.SYSTEM_CONCURRENT_BROWSER_SESSIONS,
  );
}

export async function releaseSystemBrowserSlot(): Promise<void> {
  return releaseConcurrency('rl:sys:browser');
}

export async function acquireSystemClaudeSlot(): Promise<RateLimitResult> {
  return checkConcurrencyLimit(
    'rl:sys:claude',
    RATE_LIMITS.SYSTEM_CONCURRENT_CLAUDE_CALLS,
  );
}

export async function releaseSystemClaudeSlot(): Promise<void> {
  return releaseConcurrency('rl:sys:claude');
}

export const RATE_LIMIT_MESSAGES = {
  browser: "I'm a bit overwhelmed with bookings right now — give me a few minutes and I'll be ready to help! 🙏",
  claude: "I've been thinking a lot today! Give me a quick breather and I'll be right back. 😅",
  trips: "You've got quite a few trips in the works! Let's wrap one up before starting another. ✈️",
  system: "I'm a bit overwhelmed right now, give me a minute and try again! 🙏",
} as const;

export async function closeRateLimiter(): Promise<void> {
  // Redis client lifecycle is managed by src/utils/redis.ts
}
