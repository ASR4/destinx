import { Redis } from 'ioredis';

let _redis: Redis | null = null;

/**
 * Returns the process-wide shared Redis client.
 * All modules should use this instead of creating their own `new Redis()`.
 */
export function getRedisClient(): Redis | null {
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) return null;
  try {
    // enableOfflineQueue must stay true: rate-limiter + intent cache run during BullMQ jobs.
    // If false, a reconnecting/not-ready socket throws "Stream isn't writeable and enableOfflineQueue options is false".
    _redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 20,
    });
    _redis.on('error', () => {}); // suppress unhandled error events
    return _redis;
  } catch {
    return null;
  }
}
