import { describe, it, expect } from 'vitest';
import { validateTripPlan, formatForWhatsApp, buildStrictPlanPrompt } from '../services/planning/trip-schema.js';

describe('validateTripPlan', () => {
  const validPlan = {
    days: [
      {
        date: '2026-05-01',
        day_number: 1,
        theme: 'Arrival Day',
        items: [
          { time: '14:00', type: 'transport', name: 'Airport to hotel transfer' },
          { time: '16:00', type: 'experience', name: 'Walk around Shibuya', duration_min: 120 },
          { time: '19:00', type: 'restaurant', name: 'Ichiran Ramen', price: { amount: 15, currency: 'USD' } },
        ],
        accommodation: { name: 'Park Hyatt Tokyo', loyalty_program: 'World of Hyatt' },
        day_total: { amount: 350, currency: 'USD' },
      },
    ],
    overview: 'A wonderful day in Tokyo',
    total_budget: { amount: 350, currency: 'USD' },
  };

  it('validates a correct plan', () => {
    const result = validateTripPlan(validPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.days).toHaveLength(1);
      expect(result.plan.days[0]!.items).toHaveLength(3);
    }
  });

  it('rejects a plan with missing required fields', () => {
    const result = validateTripPlan({ days: [{ date: '2026-05-01' }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects a plan with empty days', () => {
    const result = validateTripPlan({ days: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a plan with invalid item type', () => {
    const result = validateTripPlan({
      days: [{
        date: '2026-05-01',
        day_number: 1,
        items: [{ time: '10:00', type: 'invalid_type', name: 'Test' }],
      }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object input', () => {
    const result = validateTripPlan('not a plan');
    expect(result.success).toBe(false);
  });

  it('accepts optional fields when missing', () => {
    const minimalPlan = {
      days: [{
        date: '2026-05-01',
        day_number: 1,
        items: [{ time: '10:00', type: 'experience', name: 'Test activity' }],
      }],
    };
    const result = validateTripPlan(minimalPlan);
    expect(result.success).toBe(true);
  });
});

describe('formatForWhatsApp', () => {
  it('generates per-day messages', () => {
    const plan = {
      days: [
        {
          date: '2026-05-01',
          day_number: 1,
          theme: 'Exploration',
          items: [{ time: '10:00', type: 'experience' as const, name: 'City tour' }],
        },
        {
          date: '2026-05-02',
          day_number: 2,
          items: [{ time: '09:00', type: 'restaurant' as const, name: 'Breakfast spot' }],
        },
      ],
      overview: 'Two days in the city',
    };

    const msgs = formatForWhatsApp(plan);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0]).toContain('Your Trip Plan');
    expect(msgs[1]).toContain('Day 1');
  });

  it('includes packing tips when present', () => {
    const plan = {
      days: [{
        date: '2026-05-01',
        day_number: 1,
        items: [{ time: '10:00', type: 'experience' as const, name: 'Test' }],
      }],
      packing_tips: ['Bring sunscreen', 'Pack light layers'],
    };

    const msgs = formatForWhatsApp(plan);
    const tipsMsg = msgs.find((m) => m.includes('Packing Tips'));
    expect(tipsMsg).toBeDefined();
    expect(tipsMsg).toContain('sunscreen');
  });

  it('keeps messages under WhatsApp character limit', () => {
    const longItems = Array.from({ length: 50 }, (_, i) => ({
      time: '10:00',
      type: 'experience' as const,
      name: `Activity ${i + 1} with a very long detailed description that goes on and on`,
      duration_min: 120,
      price: { amount: 100 + i, currency: 'USD' },
    }));

    const plan = {
      days: [{
        date: '2026-05-01',
        day_number: 1,
        items: longItems,
      }],
    };

    const msgs = formatForWhatsApp(plan);
    for (const msg of msgs) {
      expect(msg.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('buildStrictPlanPrompt', () => {
  it('includes all errors in the output', () => {
    const errors = ['days.0.date: Required', 'days.0.items: Too few items'];
    const prompt = buildStrictPlanPrompt(errors);
    expect(prompt).toContain('days.0.date: Required');
    expect(prompt).toContain('days.0.items: Too few items');
    expect(prompt).toContain('validation errors');
  });
});
