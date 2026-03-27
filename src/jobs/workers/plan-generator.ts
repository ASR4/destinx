import { generateTripPlan } from '../../services/planning/planner.js';
import { logger } from '../../utils/logger.js';
import type { PlanInput } from '../../types/trip.js';

export interface PlanGenerationJob {
  userId: string;
  tripId: string;
  input: PlanInput;
}

/**
 * Async worker: Generate a trip plan and deliver it via WhatsApp.
 */
export async function processPlanGeneration(
  data: PlanGenerationJob,
): Promise<void> {
  logger.info({ userId: data.userId, tripId: data.tripId }, 'Plan generation started');

  try {
    const plan = await generateTripPlan(data.userId, data.input);
    // TODO: Save plan to trips table
    // TODO: Deliver plan day-by-day via WhatsApp
    logger.info({ tripId: data.tripId }, 'Plan generation completed');
  } catch (err) {
    logger.error({ err, tripId: data.tripId }, 'Plan generation failed');
    // TODO: Notify user of failure via WhatsApp
    throw err;
  }
}
