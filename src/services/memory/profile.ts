import { recallUserProfile, recallRelevantMemories } from './recall.js';
import type { UserProfile } from '../../types/memory.js';
import { logger } from '../../utils/logger.js';

/**
 * Build a complete user profile by combining:
 * 1. Structured preferences from the DB
 * 2. Relevant semantic memories (if a query context is provided)
 * 3. Recent trip history
 */
export async function buildUserProfile(
  userId: string,
  queryContext?: string,
): Promise<UserProfile> {
  const profile = await recallUserProfile(userId);

  if (queryContext) {
    const memories = await recallRelevantMemories(userId, queryContext);
    profile.semanticMemories = memories;
  }

  return profile;
}
