import type { ConversationFSMState } from '../../config/constants.js';
import type { Intent } from '../../types/conversation.js';
import { logger } from '../../utils/logger.js';

interface StateTransition {
  from: ConversationFSMState;
  intent: Intent;
  to: ConversationFSMState;
}

const TRANSITIONS: StateTransition[] = [
  { from: 'idle', intent: 'new_trip', to: 'gathering_info' },
  { from: 'idle', intent: 'greeting', to: 'idle' },
  { from: 'idle', intent: 'question', to: 'idle' },
  { from: 'idle', intent: 'feedback', to: 'post_trip' },

  { from: 'gathering_info', intent: 'general', to: 'gathering_info' },
  { from: 'gathering_info', intent: 'question', to: 'gathering_info' },
  // Transition to planning is triggered programmatically when enough info is collected

  { from: 'planning', intent: 'general', to: 'planning' },
  { from: 'planning', intent: 'question', to: 'planning' },

  { from: 'reviewing_plan', intent: 'modify_plan', to: 'modifying_plan' },
  { from: 'reviewing_plan', intent: 'book', to: 'pre_booking' },
  { from: 'reviewing_plan', intent: 'general', to: 'reviewing_plan' },
  { from: 'reviewing_plan', intent: 'new_trip', to: 'gathering_info' },

  { from: 'modifying_plan', intent: 'general', to: 'modifying_plan' },
  // Goes back to reviewing_plan after modification completes

  { from: 'pre_booking', intent: 'book', to: 'booking_in_progress' },
  { from: 'pre_booking', intent: 'modify_plan', to: 'modifying_plan' },
  { from: 'pre_booking', intent: 'general', to: 'pre_booking' },

  { from: 'booking_in_progress', intent: 'general', to: 'booking_in_progress' },

  { from: 'awaiting_confirmation', intent: 'general', to: 'awaiting_confirmation' },

  { from: 'post_trip', intent: 'feedback', to: 'post_trip' },
  { from: 'post_trip', intent: 'new_trip', to: 'gathering_info' },
  { from: 'post_trip', intent: 'general', to: 'idle' },
];

/**
 * Determine the next state given current state and classified intent.
 * Returns the current state if no valid transition exists.
 */
export function getNextState(
  current: ConversationFSMState,
  intent: Intent,
): ConversationFSMState {
  if (intent === 'opt_out') return 'idle';

  const transition = TRANSITIONS.find(
    (t) => t.from === current && t.intent === intent,
  );

  if (transition) {
    logger.debug(
      { from: current, intent, to: transition.to },
      'State transition',
    );
    return transition.to;
  }

  return current;
}

/**
 * Force a state transition programmatically (e.g., when plan generation completes).
 */
export function forceState(newState: ConversationFSMState): ConversationFSMState {
  return newState;
}

/**
 * Determine if a user message in the given state should be treated as a confirmation.
 * E.g., "looks good" in reviewing_plan state = plan approval.
 */
export function isConfirmationInState(
  state: ConversationFSMState,
  message: string,
): boolean {
  if (state !== 'reviewing_plan' && state !== 'pre_booking') return false;

  const confirmPatterns = /\b(yes|yeah|yep|looks? good|perfect|love it|great|go ahead|confirm|approve|let'?s? do it|book it|sounds? good)\b/i;
  return confirmPatterns.test(message);
}
