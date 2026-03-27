import { eq } from 'drizzle-orm';
import { generateTripPlan } from '../../services/planning/planner.js';
import { deliverTripPlan } from '../../services/planning/delivery.js';
import { sendText } from '../../services/whatsapp/sender.js';
import { getDb } from '../../db/client.js';
import { trips, conversations } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import type { PlanInput } from '../../types/trip.js';

export interface PlanGenerationJob {
  userId: string;
  tripId: string;
  userPhone: string;
  conversationId: string;
  input: PlanInput;
}

/**
 * Async worker: Generate a trip plan, persist it, and deliver it via WhatsApp.
 * Used when plan generation is queued separately (e.g. large/complex trips).
 */
export async function processPlanGeneration(
  data: PlanGenerationJob,
): Promise<void> {
  logger.info({ userId: data.userId, tripId: data.tripId }, 'Plan generation started');

  try {
    const plan = await generateTripPlan(data.userId, data.input);
    const db = getDb();

    // Persist the generated plan back to the trips row
    await db
      .update(trips)
      .set({
        plan: plan as unknown as Record<string, unknown>,
        status: 'planning',
        updatedAt: new Date(),
      })
      .where(eq(trips.id, data.tripId));

    // Deliver day-by-day to the user
    await deliverTripPlan(data.userPhone, plan, data.input.destination);

    // Advance the conversation FSM to reviewing_plan
    const [row] = await db
      .select({ context: conversations.context })
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1);

    const existing = (row?.context as Record<string, unknown>) ?? {};
    await db
      .update(conversations)
      .set({ context: { ...existing, fsmState: 'reviewing_plan' }, updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));

    logger.info({ tripId: data.tripId, dayCount: plan.days.length }, 'Plan generation completed');
  } catch (err) {
    logger.error({ err, tripId: data.tripId }, 'Plan generation failed');
    if (data.userPhone) {
      await sendText(
        data.userPhone,
        "Sorry, I ran into an issue building your plan. Could you try again or give me a bit more detail about your trip?",
      ).catch(() => undefined);
    }
    throw err;
  }
}
