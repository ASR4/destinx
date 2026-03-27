import { describe, it, expect } from 'vitest';
import { getNextState, isConfirmationInState, forceState } from '../services/conversation/state-machine.js';

describe('state machine transitions', () => {
  it('transitions from idle to gathering_info on new_trip', () => {
    expect(getNextState('idle', 'new_trip')).toBe('gathering_info');
  });

  it('stays in idle on greeting', () => {
    expect(getNextState('idle', 'greeting')).toBe('idle');
  });

  it('transitions from idle to post_trip on feedback', () => {
    expect(getNextState('idle', 'feedback')).toBe('post_trip');
  });

  it('transitions from reviewing_plan to pre_booking on book', () => {
    expect(getNextState('reviewing_plan', 'book')).toBe('pre_booking');
  });

  it('transitions from reviewing_plan to modifying_plan on modify_plan', () => {
    expect(getNextState('reviewing_plan', 'modify_plan')).toBe('modifying_plan');
  });

  it('transitions from reviewing_plan to gathering_info on new_trip', () => {
    expect(getNextState('reviewing_plan', 'new_trip')).toBe('gathering_info');
  });

  it('stays in current state if no valid transition exists', () => {
    expect(getNextState('booking_in_progress', 'new_trip')).toBe('booking_in_progress');
  });

  it('transitions to idle on opt_out from any state', () => {
    expect(getNextState('planning', 'opt_out')).toBe('idle');
    expect(getNextState('booking_in_progress', 'opt_out')).toBe('idle');
    expect(getNextState('reviewing_plan', 'opt_out')).toBe('idle');
  });

  it('transitions from pre_booking to booking_in_progress on book', () => {
    expect(getNextState('pre_booking', 'book')).toBe('booking_in_progress');
  });

  it('transitions from post_trip to gathering_info on new_trip', () => {
    expect(getNextState('post_trip', 'new_trip')).toBe('gathering_info');
  });

  it('transitions from post_trip to idle on general', () => {
    expect(getNextState('post_trip', 'general')).toBe('idle');
  });
});

describe('isConfirmationInState', () => {
  it('recognizes "looks good" as confirmation in reviewing_plan', () => {
    expect(isConfirmationInState('reviewing_plan', 'looks good')).toBe(true);
  });

  it('recognizes "yes" as confirmation in reviewing_plan', () => {
    expect(isConfirmationInState('reviewing_plan', 'yes')).toBe(true);
  });

  it('recognizes "book it" as confirmation in pre_booking', () => {
    expect(isConfirmationInState('pre_booking', 'book it')).toBe(true);
  });

  it('recognizes "let\'s do it" as confirmation in reviewing_plan', () => {
    expect(isConfirmationInState('reviewing_plan', "let's do it")).toBe(true);
  });

  it('does not treat random text as confirmation', () => {
    expect(isConfirmationInState('reviewing_plan', 'change the hotel')).toBe(false);
  });

  it('does not treat confirmation text in idle state as confirmation', () => {
    expect(isConfirmationInState('idle', 'yes')).toBe(false);
  });

  it('does not treat confirmation text in planning state as confirmation', () => {
    expect(isConfirmationInState('planning', 'looks good')).toBe(false);
  });
});

describe('forceState', () => {
  it('returns the provided state', () => {
    expect(forceState('reviewing_plan')).toBe('reviewing_plan');
    expect(forceState('idle')).toBe('idle');
  });
});
