import { sendText } from '../whatsapp/sender.js';
import {
  formatDayPlan,
  formatPlanOverview,
  formatPlanActions,
} from '../whatsapp/formatter.js';
import { logger } from '../../utils/logger.js';
import type { Itinerary } from '../../types/trip.js';

/** Pause between day messages so WhatsApp preserves ordering. */
const DAY_DELAY_MS = 1_200;

/**
 * Deliver a complete trip plan to the user via WhatsApp.
 *
 * Sends:
 *   1. Overview message
 *   2. One message per day (with a short delay between each)
 *   3. Action prompt ("LOVE IT / CHANGE / DAY X")
 */
export async function deliverTripPlan(
  userPhone: string,
  plan: Itinerary,
  destination: string,
): Promise<void> {
  if (!plan.days.length) {
    logger.warn({ destination }, 'Plan has no days — cannot deliver');
    await sendText(
      userPhone,
      "I wasn't able to build a full itinerary — could you give me a bit more detail about your trip?",
    );
    return;
  }

  logger.info({ destination, dayCount: plan.days.length }, 'Delivering trip plan');

  await sendText(userPhone, formatPlanOverview(plan, destination));
  await pause(DAY_DELAY_MS);

  for (const day of plan.days) {
    await sendText(userPhone, formatDayPlan(day));
    await pause(DAY_DELAY_MS);
  }

  await sendText(userPhone, formatPlanActions(plan.days.length));

  logger.info({ destination, dayCount: plan.days.length }, 'Trip plan delivery complete');
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
