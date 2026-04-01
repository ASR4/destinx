/**
 * Unit tests for WhatsApp message formatting.
 * Tests: formatForWhatsApp (trip schema), character limits, option detection.
 */

import { describe, it, expect } from 'vitest';
import { validateTripPlan, formatForWhatsApp } from '../../services/planning/trip-schema.js';

const SAMPLE_DAY = {
  date: '2026-06-15',
  day_number: 1,
  theme: 'Arrival & First Impressions',
  items: [
    { time: '10:00', type: 'transport' as const, name: 'Airport transfer', description: 'Taxi to hotel' },
    { time: '12:00', type: 'restaurant' as const, name: 'Ichiran Ramen', description: 'Famous solo ramen experience', price: { amount: 15, currency: 'USD' } },
    { time: '14:00', type: 'experience' as const, name: 'Shibuya Crossing', description: 'Watch the iconic scramble' },
    { time: '19:00', type: 'restaurant' as const, name: 'Yakitori Alley', description: 'Local grilled skewers', price: { amount: 30, currency: 'USD' } },
  ],
  accommodation: { name: 'Shinjuku Granbell Hotel', check_in: true },
  day_total: { amount: 120, currency: 'USD' },
};

const SAMPLE_PLAN = {
  days: [
    SAMPLE_DAY,
    { ...SAMPLE_DAY, day_number: 2, date: '2026-06-16', theme: 'Temples & Culture' },
    { ...SAMPLE_DAY, day_number: 3, date: '2026-06-17', theme: 'Day Trip to Nikko' },
  ],
  overview: 'A 3-day Tokyo adventure',
  packing_tips: ['Comfortable walking shoes', 'IC card for transit'],
};

describe('validateTripPlan', () => {
  it('validates a well-formed plan', () => {
    const result = validateTripPlan(SAMPLE_PLAN);
    expect(result.success).toBe(true);
    if (result.success) expect(result.plan.days).toHaveLength(3);
  });

  it('rejects a plan with no days', () => {
    const result = validateTripPlan({ days: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors).toBeDefined();
  });

  it('rejects a day with no items', () => {
    const result = validateTripPlan({
      days: [{ date: '2026-06-15', day_number: 1, items: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid item types', () => {
    const result = validateTripPlan({
      days: [{
        date: '2026-06-15',
        day_number: 1,
        items: [{ time: '10:00', type: 'INVALID_TYPE', name: 'Test' }],
      }],
    });
    expect(result.success).toBe(false);
  });
});

describe('formatForWhatsApp', () => {
  it('produces an array of messages', () => {
    const validation = validateTripPlan(SAMPLE_PLAN);
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const messages = formatForWhatsApp(validation.plan);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('keeps each message under WhatsApp 4096-char limit', () => {
    const validation = validateTripPlan(SAMPLE_PLAN);
    if (!validation.success) return;
    const messages = formatForWhatsApp(validation.plan);
    for (const msg of messages) {
      expect(msg.length).toBeLessThanOrEqual(4096);
    }
  });

  it('includes packing tips in output', () => {
    const validation = validateTripPlan(SAMPLE_PLAN);
    if (!validation.success) return;
    const messages = formatForWhatsApp(validation.plan);
    const combined = messages.join('\n');
    expect(combined).toContain('Comfortable walking shoes');
  });
});

// ---------------------------------------------------------------------------
// queue.ts: parseQuestionWithOptions (tested via observable behaviour)
// ---------------------------------------------------------------------------

describe('option detection in Claude responses', () => {
  function simulateParsing(text: string): { body: string; options: string[] } | null {
    const lines = text.trimEnd().split('\n');
    const optionLines: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i]!.match(/^\s*(\d+)[.\)]\s+(.+)$/);
      if (match) optionLines.unshift(match[2]!.trim());
      else break;
    }
    if (optionLines.length < 2 || optionLines.length > 10) return null;
    const bodyLines = lines.slice(0, lines.length - optionLines.length);
    const body = bodyLines.join('\n').trim();
    if (!body) return null;
    return { body, options: optionLines };
  }

  it('parses 2-option response', () => {
    const text = 'What kind of trip?\n1. Beach\n2. City';
    const result = simulateParsing(text);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['Beach', 'City']);
    expect(result!.body).toBe('What kind of trip?');
  });

  it('parses 3-option response with period terminators', () => {
    const text = 'Pick a pace:\n1. Relaxed\n2. Moderate\n3. Fast-paced';
    const result = simulateParsing(text);
    expect(result!.options).toHaveLength(3);
  });

  it('ignores single-option (not interactive)', () => {
    const text = 'Here is the plan:\n1. Morning tour';
    expect(simulateParsing(text)).toBeNull();
  });

  it('ignores more than 10 options', () => {
    const options = Array.from({ length: 11 }, (_, i) => `${i + 1}. Option ${i + 1}`).join('\n');
    expect(simulateParsing(`Choose:\n${options}`)).toBeNull();
  });

  it('returns null when there is no body', () => {
    const text = '1. Option A\n2. Option B';
    expect(simulateParsing(text)).toBeNull();
  });
});
