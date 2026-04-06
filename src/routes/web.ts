import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { trips, users, userPreferences } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { renderItineraryPage } from '../templates/itinerary.js';
import { renderProfilePage } from '../templates/profile.js';
import { renderComparisonPage } from '../templates/comparison.js';
import { getRedisClient } from '../utils/redis.js';
import crypto from 'crypto';

/**
 * Generate a short-lived, unguessable token for securing web pages.
 */
function generatePageToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Store a page token in Redis with a TTL.
 */
async function storePageToken(key: string, token: string, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.setex(`page_token:${key}`, ttlSeconds, token);
    }
  } catch {
    // Fail silently — pages still work, just less secure
  }
}

async function validatePageToken(key: string, token: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) return true; // no Redis = skip validation
    const stored = await redis.get(`page_token:${key}`);
    return stored === token;
  } catch {
    return true; // on error, allow access
  }
}

export async function webRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Trip itinerary page — mobile-optimized, server-rendered HTML
   */
  app.get<{ Params: { tripId: string }; Querystring: { token?: string } }>(
    '/trip/:tripId',
    async (request, reply) => {
      const { tripId } = request.params;
      const { token } = request.query;

      if (token) {
        const valid = await validatePageToken(`trip:${tripId}`, token);
        if (!valid) {
          return reply.status(403).send('Invalid or expired link');
        }
      }

      const db = getDb();
      const rows = await db
        .select()
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send('Trip not found');
      }

      const trip = rows[0]!;
      const html = renderItineraryPage({
        destination: trip.destination ?? 'Trip',
        startDate: trip.startDate ?? '',
        endDate: trip.endDate ?? '',
        status: trip.status ?? 'planning',
        plan: trip.plan as any,
        budget: trip.budget as any,
        travelers: trip.travelers as any,
      });

      return reply.type('text/html').send(html);
    },
  );

  /**
   * User travel DNA profile page
   */
  app.get<{ Params: { userId: string }; Querystring: { token?: string } }>(
    '/profile/:userId',
    async (request, reply) => {
      const { userId } = request.params;
      const { token } = request.query;

      if (token) {
        const valid = await validatePageToken(`profile:${userId}`, token);
        if (!valid) {
          return reply.status(403).send('Invalid or expired link');
        }
      }

      const db = getDb();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return reply.status(404).send('Profile not found');
      }

      const prefs = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));

      const recentTrips = await db
        .select()
        .from(trips)
        .where(eq(trips.userId, userId))
        .limit(5);

      const html = renderProfilePage({
        userName: user.name ?? 'Traveler',
        preferences: prefs.map((p) => ({
          category: p.category,
          key: p.key,
          value: p.value,
          confidence: p.confidence ?? 0.5,
        })),
        trips: recentTrips.map((t) => ({
          destination: t.destination ?? 'Unknown',
          startDate: t.startDate ?? '',
          endDate: t.endDate ?? '',
          status: t.status ?? 'planning',
        })),
      });

      return reply.type('text/html').send(html);
    },
  );

  /**
   * Comparison page (hotels, flights, etc.)
   * Data stored in Redis with 24-hour TTL
   */
  app.get<{ Params: { comparisonId: string } }>(
    '/compare/:comparisonId',
    async (request, reply) => {
      const { comparisonId } = request.params;

      try {
        const redis = getRedisClient();
        if (!redis) {
          return reply.status(503).send('Comparison service unavailable');
        }

        const data = await redis.get(`comparison:${comparisonId}`);
        if (!data) {
          return reply.status(404).send('Comparison expired or not found');
        }

        const comparison = JSON.parse(data) as {
          title: string;
          type: string;
          options: Array<{
            name: string;
            price?: string;
            rating?: number;
            location?: string;
            highlights: string[];
            bookingUrl?: string;
            recommended?: boolean;
            recommendReason?: string;
          }>;
          userPhone: string;
        };

        const html = renderComparisonPage(comparison);
        return reply.type('text/html').send(html);
      } catch (err) {
        logger.error({ err }, 'Failed to load comparison');
        return reply.status(500).send('Something went wrong');
      }
    },
  );
}

/**
 * Create a trip page link with a secure token.
 */
export async function createTripPageLink(tripId: string): Promise<string> {
  const token = generatePageToken();
  await storePageToken(`trip:${tripId}`, token, 7 * 24 * 3600); // 7 days
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${baseUrl}/trip/${tripId}?token=${token}`;
}

/**
 * Create a profile page link with a secure token.
 */
export async function createProfilePageLink(userId: string): Promise<string> {
  const token = generatePageToken();
  await storePageToken(`profile:${userId}`, token, 30 * 24 * 3600); // 30 days
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${baseUrl}/profile/${userId}?token=${token}`;
}

/**
 * Create a comparison page and return the link.
 */
export async function createComparisonPage(data: {
  title: string;
  type: string;
  options: Array<{
    name: string;
    price?: string;
    rating?: number;
    location?: string;
    highlights: string[];
    bookingUrl?: string;
    recommended?: boolean;
    recommendReason?: string;
  }>;
  userPhone: string;
}): Promise<string> {
  const redis = getRedisClient();
  if (!redis) throw new Error('Redis not available for comparison pages');

  const comparisonId = crypto.randomBytes(12).toString('base64url');
  await redis.setex(`comparison:${comparisonId}`, 24 * 3600, JSON.stringify(data));

  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${baseUrl}/compare/${comparisonId}`;
}
