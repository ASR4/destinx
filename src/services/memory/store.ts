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
 * Confidence scoring rules (Upgrade 5a):
 *
 * | Signal                                  | Confidence  |
 * |-----------------------------------------|-------------|
 * | User explicitly states preference       | 0.7         |
 * | Agent infers from behavior/context      | 0.4         |
 * | User confirms an inferred preference    | +0.2 (cap 0.95) |
 * | User acts consistently with preference  | +0.1 (cap 0.95) |
 * | User contradicts a stored preference    | Reset to 0.3, set needs_clarification |
 * | Not referenced in 6+ months             | Decay by 0.1 |
 */
const CONFIDENCE = {
  EXPLICIT: 0.7,
  INFERRED: 0.4,
  CONFIRMATION_BUMP: 0.2,
  CONSISTENCY_BUMP: 0.1,
  CONTRADICTION_RESET: 0.3,
  CAP: 0.95,
} as const;

/**
 * Check if a new preference contradicts an existing one.
 * Returns the existing preference if contradiction detected, null otherwise.
 */
export async function detectContradiction(
  userId: string,
  category: PreferenceCategory,
  key: string,
  newValue: unknown,
): Promise<Preference | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.category, category),
        eq(userPreferences.key, key),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const existing = rows[0]!;
  const existingVal = typeof existing.value === 'string' ? existing.value : JSON.stringify(existing.value);
  const newVal = typeof newValue === 'string' ? newValue : JSON.stringify(newValue);

  if (existingVal.toLowerCase() === newVal.toLowerCase()) return null;
  if ((existing.confidence ?? 0.5) < 0.3) return null;

  return {
    id: existing.id,
    userId: existing.userId,
    category: existing.category as PreferenceCategory,
    key: existing.key,
    value: existing.value,
    confidence: existing.confidence ?? 0.5,
    source: existing.source as Preference['source'],
    lastConfirmedAt: existing.lastConfirmedAt ?? undefined,
    createdAt: existing.createdAt ?? new Date(),
    updatedAt: existing.updatedAt ?? new Date(),
  };
}

/**
 * Upsert a user preference using ON CONFLICT DO UPDATE.
 * Handles contradiction detection and confidence scoring.
 */
export async function upsertPreference(
  userId: string,
  pref: ExtractedPreference,
): Promise<{ contradiction?: Preference }> {
  const db = getDb();

  // Check for contradiction before upserting
  const contradiction = await detectContradiction(userId, pref.category, pref.key, pref.value);

  let confidence: number;
  if (contradiction) {
    confidence = CONFIDENCE.CONTRADICTION_RESET;
    logger.info(
      { userId, category: pref.category, key: pref.key, oldValue: contradiction.value, newValue: pref.value },
      'Preference contradiction detected — resetting confidence',
    );
  } else if (pref.source === 'explicit') {
    confidence = Math.max(CONFIDENCE.EXPLICIT, pref.confidence);
  } else if (pref.source === 'feedback') {
    confidence = Math.min(CONFIDENCE.CAP, pref.confidence + CONFIDENCE.CONFIRMATION_BUMP);
  } else {
    confidence = Math.max(CONFIDENCE.INFERRED, pref.confidence);
  }

  const metadata = contradiction ? { needs_clarification: true } : undefined;

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
        confidence: contradiction
          ? sql`${CONFIDENCE.CONTRADICTION_RESET}`
          : sql`LEAST(${CONFIDENCE.CAP}, GREATEST(${userPreferences.confidence}, ${confidence}))`,
        source: pref.source,
        updatedAt: new Date(),
        lastConfirmedAt: pref.source === 'explicit'
          ? new Date()
          : sql`COALESCE(${userPreferences.lastConfirmedAt}, excluded.last_confirmed_at)`,
      },
    });

  logger.debug({ userId, category: pref.category, key: pref.key, confidence }, 'Preference upserted');
  return contradiction ? { contradiction } : {};
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
      confidence: sql`LEAST(${CONFIDENCE.CAP}, ${userPreferences.confidence} + ${CONFIDENCE.CONSISTENCY_BUMP})`,
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
