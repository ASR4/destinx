import { getAnthropicClient } from '../../ai/client.js';
import { getTravelAgentTools } from '../../ai/tools.js';
import { buildPlanningPrompt } from '../../ai/prompts/planning.js';
import { recallUserProfile } from '../memory/recall.js';
import { AI } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import type { PlanInput, Itinerary } from '../../types/trip.js';

/**
 * Generate a complete day-by-day trip itinerary.
 *
 * Uses Claude with search tools to:
 * 1. Research the destination (events, weather, logistics)
 * 2. Find real hotels, restaurants, experiences
 * 3. Build a structured day-by-day plan
 * 4. Verify all venues exist and prices are reasonable
 * 5. Calculate total budget
 *
 * This is a multi-turn Claude conversation — Claude calls tools,
 * we execute them, and feed results back until the plan is complete.
 */
export async function generateTripPlan(
  userId: string,
  input: PlanInput,
): Promise<Itinerary> {
  logger.info({ userId, destination: input.destination }, 'Generating trip plan');

  const userProfile = await recallUserProfile(userId);
  const anthropic = getAnthropicClient();

  const prompt = buildPlanningPrompt(input, userProfile);

  const response = await anthropic.messages.create({
    model: AI.PLANNING_MODEL,
    max_tokens: AI.MAX_PLANNING_TOKENS,
    messages: [{ role: 'user', content: prompt }],
    tools: getTravelAgentTools(),
  });

  // TODO: Implement tool-use loop
  // - While response contains tool_use blocks, execute tools and feed results back
  // - Parse final text response into Itinerary structure
  // - Validate all venues exist

  logger.warn('generateTripPlan: tool-use loop not yet implemented');

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock && 'text' in textBlock ? textBlock.text : '{}';

  try {
    return JSON.parse(rawText) as Itinerary;
  } catch {
    return { days: [], overview: rawText };
  }
}
