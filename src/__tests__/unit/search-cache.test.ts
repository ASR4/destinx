/**
 * Unit tests for search-cache.ts — Redis store/retrieve with TTL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ioredis mock must use a class so `new IORedis()` works
vi.mock('ioredis', () => {
  const data = new Map<string, string>();

  class MockRedis {
    async get(key: string) { return data.get(key) ?? null; }
    async set(key: string, value: string) { data.set(key, value); return 'OK' as const; }
    async setex(key: string, _ttl: number, value: string) { data.set(key, value); return 'OK' as const; }
    async del(key: string) { data.delete(key); return 1; }
    async quit() { return 'OK' as const; }
    on() { return this; }
    // expose for beforeEach cleanup
    static _data = data;
  }

  return { default: MockRedis, Redis: MockRedis };
});

describe('storeSearchResults', () => {
  beforeEach(async () => {
    // Clear mock store between tests
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();
  });

  it('generates a 6-character searchId', async () => {
    const { storeSearchResults } = await import('../../services/booking/search-cache.js');
    const id = await storeSearchResults('conv-1', 'duffel', [{ flightNumber: 'BA100' }]);
    expect(id).toHaveLength(6);
    expect(typeof id).toBe('string');
  });

  it('generates unique IDs on repeated calls', async () => {
    const { storeSearchResults } = await import('../../services/booking/search-cache.js');
    const ids = await Promise.all([
      storeSearchResults('conv-1', 'duffel', []),
      storeSearchResults('conv-1', 'duffel', []),
      storeSearchResults('conv-1', 'duffel', []),
    ]);
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});

describe('getSearchResults', () => {
  beforeEach(async () => {
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();
  });

  it('retrieves stored offers', async () => {
    const { storeSearchResults, getSearchResults } = await import('../../services/booking/search-cache.js');
    const offers = [{ flightNumber: 'LH400', price: '$300' }, { flightNumber: 'LH401', price: '$320' }];
    const id = await storeSearchResults('conv-abc', 'duffel', offers);
    const cached = await getSearchResults('conv-abc', id);
    expect(cached).not.toBeNull();
    expect(cached!.provider).toBe('duffel');
    expect(cached!.offers).toHaveLength(2);
    expect((cached!.offers[0] as any).flightNumber).toBe('LH400');
  });

  it('returns null for missing key', async () => {
    const { getSearchResults } = await import('../../services/booking/search-cache.js');
    const result = await getSearchResults('conv-none', 'ZZZZZZ');
    expect(result).toBeNull();
  });

  it('returns null for different conversationId', async () => {
    const { storeSearchResults, getSearchResults } = await import('../../services/booking/search-cache.js');
    const id = await storeSearchResults('conv-A', 'duffel', [{ x: 1 }]);
    const result = await getSearchResults('conv-B', id);
    expect(result).toBeNull();
  });
});
