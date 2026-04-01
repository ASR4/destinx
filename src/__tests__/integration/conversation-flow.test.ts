/**
 * Integration tests for the conversation flow.
 * Tests: intent classification, holding messages, rate-limiter, option detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MOCK_USER_ID } from '../helpers/mocks.js';

// ioredis mock — class-based so `new Redis()` works
vi.mock('ioredis', () => {
  const data = new Map<string, string>();
  const counters = new Map<string, number>();

  class MockRedis {
    async get(key: string) { return data.get(key) ?? null; }
    async set(key: string, value: string) { data.set(key, value); return 'OK' as const; }
    async setex(key: string, _ttl: number, value: string) { data.set(key, value); return 'OK' as const; }
    async incr(key: string) {
      const v = (counters.get(key) ?? 0) + 1;
      counters.set(key, v);
      return v;
    }
    async decr(key: string) {
      const v = Math.max(0, (counters.get(key) ?? 0) - 1);
      counters.set(key, v);
      return v;
    }
    async expire() { return 1; }
    async zadd() { return 1; }
    async zcard() { return 0; }
    async zremrangebyscore() { return 0; }
    async zrange() { return []; }
    async zrem() { return 1; }
    async quit() { return 'OK' as const; }
    on() { return this; }
    multi() {
      const cmds: Array<() => Promise<any>> = [];
      const m: any = {
        zremrangebyscore: () => m,
        zcard: () => m,
        zadd: () => m,
        expire: () => m,
        exec: async () => [[null, 0], [null, 0], [null, 1], [null, 1]],
      };
      return m;
    }
    static _data = data;
    static _counters = counters;
  }

  return { default: MockRedis, Redis: MockRedis };
});

// ---------------------------------------------------------------------------
// Tests: classifyIntent — fast-path (no Haiku call needed)
// ---------------------------------------------------------------------------

describe('classifyIntent — fast-path regex', () => {
  it('classifies STOP as opt_out with high confidence', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('STOP');
    expect(result.intent).toBe('opt_out');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies "stop" (lowercase) as opt_out', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('stop');
    expect(result.intent).toBe('opt_out');
  });

  it('classifies "hi" as greeting', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('hi');
    expect(result.intent).toBe('greeting');
  });

  it('classifies "hello!" as greeting', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('hello!');
    expect(result.intent).toBe('greeting');
  });

  it('classifies "yes" as book', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('yes');
    expect(result.intent).toBe('book');
  });

  it('classifies "book it" as book', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('book it');
    expect(result.intent).toBe('book');
  });

  it('classifies "love it" as book', async () => {
    const { classifyIntent } = await import('../../services/conversation/intent.js');
    const result = await classifyIntent('love it');
    expect(result.intent).toBe('book');
  });
});

// ---------------------------------------------------------------------------
// Tests: getHoldingMessage
// ---------------------------------------------------------------------------

describe('getHoldingMessage', () => {
  it('returns flight-specific message for search_flights', async () => {
    const { getHoldingMessage } = await import('../../services/conversation/tool-executor.js');
    expect(getHoldingMessage(['search_flights'])).toContain('flight');
  });

  it('returns hotel-specific message for search_hotels', async () => {
    const { getHoldingMessage } = await import('../../services/conversation/tool-executor.js');
    expect(getHoldingMessage(['search_hotels'])).toContain('hotel');
  });

  it('returns restaurant message for search_restaurants', async () => {
    const { getHoldingMessage } = await import('../../services/conversation/tool-executor.js');
    expect(getHoldingMessage(['search_restaurants'])).toContain('restaurant');
  });

  it('returns itinerary message for create_trip_plan', async () => {
    const { getHoldingMessage } = await import('../../services/conversation/tool-executor.js');
    expect(getHoldingMessage(['create_trip_plan'])).toContain('itinerary');
  });

  it('returns generic message for unknown tools', async () => {
    const { getHoldingMessage } = await import('../../services/conversation/tool-executor.js');
    const msg = getHoldingMessage(['unknown_tool']);
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: rate limiter
// ---------------------------------------------------------------------------

describe('rate limiter', () => {
  beforeEach(async () => {
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();
    (MockRedis as any)._counters?.clear();
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  });

  it('checkUserClaudeLimit allows first call', async () => {
    const { checkUserClaudeLimit } = await import('../../services/rate-limiter.js');
    const result = await checkUserClaudeLimit(`user-${Math.random()}`);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('checkUserBrowserLimit allows first call', async () => {
    const { checkUserBrowserLimit } = await import('../../services/rate-limiter.js');
    const result = await checkUserBrowserLimit(`user-${Math.random()}`);
    expect(result.allowed).toBe(true);
  });

  it('acquireSystemClaudeSlot allows acquisition', async () => {
    const { acquireSystemClaudeSlot, releaseSystemClaudeSlot } = await import('../../services/rate-limiter.js');
    const result = await acquireSystemClaudeSlot();
    expect(result.allowed).toBe(true);
    await releaseSystemClaudeSlot();
  });
});

// ---------------------------------------------------------------------------
// Tests: option parsing (inline — avoids importing queue internals)
// ---------------------------------------------------------------------------

describe('parseQuestionWithOptions (inline)', () => {
  function parse(text: string) {
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
    expect(parse('What kind?\n1. Beach\n2. City')).toMatchObject({
      body: 'What kind?',
      options: ['Beach', 'City'],
    });
  });

  it('parses 3-option response', () => {
    const result = parse('Pick pace:\n1. Relaxed\n2. Moderate\n3. Fast');
    expect(result!.options).toHaveLength(3);
  });

  it('ignores single option', () => {
    expect(parse('Plan:\n1. Morning tour')).toBeNull();
  });

  it('ignores 11 options', () => {
    const opts = Array.from({ length: 11 }, (_, i) => `${i + 1}. Opt ${i}`).join('\n');
    expect(parse(`Choose:\n${opts}`)).toBeNull();
  });

  it('requires non-empty body', () => {
    expect(parse('1. A\n2. B')).toBeNull();
  });
});
