import { eq, and, sql, lt } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { userPreferences } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { MEMORY } from '../../config/constants.js';
import type {
  Preference,
  PreferenceCategory,
  ExtractedPreference,
} from '../../types/memory.js';

/**
 * Upsert a user preference using ON CONFLICT DO UPDATE.
 * If a preference with the same (userId, category, key) already exists,
 * updates it rather than creating a duplicate — resolving conflicts
 * by taking the higher confidence value.
 */
export async function upsertPreference(
  userId: string,
  pref: ExtractedPreference,
): Promise<void> {
  const db = getDb();

  const confidence = pref.source === 'explicit'
    ? Math.max(0.8, pref.confidence)
    : pref.confidence;

  await db
    .insert(userPreferences)
    .values({
      userId,
      category: pref.category,
      key: pref.key,
      value: pref.value,
      confidence,
      source: pref.source,
      lastConfirmedAt: pref.source === 'explicit' ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [userPreferences.userId, userPreferences.category, userPreferences.key],
      set: {
        value: pref.value,
        confidence: sql`GREATEST(${userPreferences.confidence}, ${confidence})`,
        source: pref.source,
        updatedAt: new Date(),
        lastConfirmedAt: pref.source === 'explicit'
          ? new Date()
          : sql`COALESCE(${userPreferences.lastConfirmedAt}, excluded.last_confirmed_at)`,
      },
    });

  logger.debug({ userId, category: pref.category, key: pref.key }, 'Preference upserted');
}

/**
 * Reaffirm a preference — update lastConfirmedAt and bump confidence.
 */
export async function reaffirmPreference(
  userId: string,
  category: PreferenceCategory,
  key: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(userPreferences)
    .set({
      lastConfirmedAt: new Date(),
      confidence: sql`LEAST(1.0, ${userPreferences.confidence} + 0.1)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.category, category),
        eq(userPreferences.key, key),
      ),
    );
}

/**
 * Decay confidence for stale preferences.
 * Preferences not confirmed in CONFIDENCE_DECAY_MONTHS have confidence
 * reduced by CONFIDENCE_DECAY_AMOUNT, with a floor of CONFIDENCE_FLOOR.
 */
export async function decayPreferenceConfidence(): Promise<number> {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - MEMORY.CONFIDENCE_DECAY_MONTHS);

  const result = await db
    .update(userPreferences)
    .set({
      confidence: sql`GREATEST(${MEMORY.CONFIDENCE_FLOOR}, ${userPreferences.confidence} - ${MEMORY.CONFIDENCE_DECAY_AMOUNT})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        lt(
          sql`COALESCE(${userPreferences.lastConfirmedAt}, ${userPreferences.createdAt})`,
          cutoffDate,
        ),
        sql`${userPreferences.confidence} > ${MEMORY.CONFIDENCE_FLOOR}`,
      ),
    )
    .returning({ id: userPreferences.id });

  const count = result.length;
  if (count > 0) {
    logger.info({ count }, 'Decayed stale preference confidence');
  }
  return count;
}

/**
 * Get all preferences for a user, optionally filtered by category.
 */
export async function getPreferences(
  userId: string,
  category?: PreferenceCategory,
): Promise<Preference[]> {
  const db = getDb();

  const conditions = [eq(userPreferences.userId, userId)];
  if (category) {
    conditions.push(eq(userPreferences.category, category));
  }

  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(...conditions));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    category: r.category as PreferenceCategory,
    key: r.key,
    value: r.value,
    confidence: r.confidence ?? 0.5,
    source: r.source as Preference['source'],
    lastConfirmedAt: r.lastConfirmedAt ?? undefined,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}
