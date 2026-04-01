/**
 * Integration tests for the flight search + booking flow.
 * Mocks: Duffel API, Redis (class-based), Anthropic SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MOCK_USER_ID,
  MOCK_CONVERSATION_ID,
  mockFlightOffer,
} from '../helpers/mocks.js';

// ioredis mock — must use a class for `new IORedis()` to work
vi.mock('ioredis', () => {
  const data = new Map<string, string>();
  class MockRedis {
    async get(key: string) { return data.get(key) ?? null; }
    async set(key: string, value: string) { data.set(key, value); return 'OK' as const; }
    async setex(key: string, _ttl: number, value: string) { data.set(key, value); return 'OK' as const; }
    async del(key: string) { data.delete(key); return 1; }
    async quit() { return 'OK' as const; }
    on() { return this; }
    static _data = data;
  }
  return { default: MockRedis, Redis: MockRedis };
});

// ---------------------------------------------------------------------------
// Tests: search cache
// ---------------------------------------------------------------------------

describe('search cache: storeSearchResults / getSearchResults', () => {
  beforeEach(async () => {
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();
  });

  it('stores flight offers and retrieves them by conversationId + searchId', async () => {
    const { storeSearchResults, getSearchResults } = await import(
      '../../services/booking/search-cache.js'
    );

    const offers = [mockFlightOffer(), mockFlightOffer({ flightNumber: 'UA789' })];
    const searchId = await storeSearchResults(MOCK_CONVERSATION_ID, 'duffel', offers);

    expect(searchId).toHaveLength(6);

    const cached = await getSearchResults(MOCK_CONVERSATION_ID, searchId);
    expect(cached).not.toBeNull();
    expect(cached!.provider).toBe('duffel');
    expect(cached!.offers).toHaveLength(2);
  });

  it('returns null for an unknown searchId', async () => {
    const { getSearchResults } = await import('../../services/booking/search-cache.js');
    const result = await getSearchResults(MOCK_CONVERSATION_ID, 'XXXXXX');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: book_flight — test mode (no Stripe)
// ---------------------------------------------------------------------------

describe('book_flight tool handler — test mode (no Stripe)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DUFFEL_API_KEY', 'duffel_test_fake');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
  });

  it('returns test-mode failure when no cached offer and no real Duffel', async () => {
    // Clear cache so no hit
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();

    const { executeToolCalls } = await import('../../services/conversation/tool-executor.js');

    const results = await executeToolCalls(
      [{
        id: 'tool_1',
        name: 'book_flight',
        input: {
          search_id: 'NONE99',
          flight_number: 'BA456',
          origin: 'LHR',
          destination: 'JFK',
          departure_date: '2026-06-15',
          passengers: [],
        },
      }],
      {
        userId: MOCK_USER_ID,
        userPhone: 'whatsapp:+15551234567',
        conversationId: MOCK_CONVERSATION_ID,
      },
    );

    const result = JSON.parse(results[0]!.result);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('test mode');
  });
});

// ---------------------------------------------------------------------------
// Tests: book_flight — Stripe flow
// ---------------------------------------------------------------------------

vi.mock('stripe', () => {
  class MockStripe {
    checkout = {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
        }),
      },
    };
    webhooks = {
      constructEvent: vi.fn(),
    };
  }
  return { default: MockStripe };
});

// Mock DB for book_flight Stripe path (trips lookup for tripId)
vi.mock('../../db/client.js', () => ({
  getDb: () => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-trip-id' }]),
        // Make values() itself thenable so .catch() works on it too
        then: vi.fn().mockImplementation((_res: unknown, _rej: unknown) => Promise.resolve([])),
        catch: vi.fn().mockImplementation(() => Promise.resolve([])),
      }),
    }),
  }),
}));

describe('book_flight tool handler — Stripe flow', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DUFFEL_API_KEY', 'duffel_live_fake');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('STRIPE_SERVICE_FEE_CENTS', '1500');

    // Seed the mock Redis with a cached offer including rawAmount
    const { default: MockRedis } = await import('ioredis');
    (MockRedis as any)._data?.clear();
  });

  it('returns payment_required with checkoutUrl when offer has rawAmount', async () => {
    // Store a valid offer
    const { storeSearchResults } = await import('../../services/booking/search-cache.js');
    const offers = [mockFlightOffer({ rawAmount: '450.00', rawCurrency: 'USD' })];
    const searchId = await storeSearchResults(MOCK_CONVERSATION_ID, 'duffel', offers);

    const { executeToolCalls } = await import('../../services/conversation/tool-executor.js');

    const results = await executeToolCalls(
      [{
        id: 'tool_1',
        name: 'book_flight',
        input: {
          search_id: searchId,
          flight_number: 'BA456',
          origin: 'LHR',
          destination: 'JFK',
          departure_date: '2026-06-15',
          cabin_class: 'economy',
          passengers: [{
            title: 'Mr', given_name: 'John', family_name: 'Doe',
            born_on: '1990-01-01', gender: 'm',
            email: 'john@example.com', phone_number: '+15551234567',
          }],
        },
      }],
      {
        userId: MOCK_USER_ID,
        userPhone: 'whatsapp:+15551234567',
        conversationId: MOCK_CONVERSATION_ID,
      },
    );

    const result = JSON.parse(results[0]!.result);
    expect(result.status).toBe('payment_required');
    expect(result.checkoutUrl).toBeDefined();
    expect(result.checkoutUrl).toContain('stripe.com');
  });

  it('returns price_unavailable if no rawAmount in offer', async () => {
    const { storeSearchResults } = await import('../../services/booking/search-cache.js');
    // Offer without rawAmount
    const offers = [{ flightNumber: 'BA456', price: '$450', expiresAt: new Date().toISOString() }];
    const searchId = await storeSearchResults(MOCK_CONVERSATION_ID, 'duffel', offers);

    const { executeToolCalls } = await import('../../services/conversation/tool-executor.js');

    const results = await executeToolCalls(
      [{
        id: 'tool_2',
        name: 'book_flight',
        input: {
          search_id: searchId,
          flight_number: 'BA456',
          origin: 'LHR',
          destination: 'JFK',
          departure_date: '2026-06-15',
          passengers: [],
        },
      }],
      {
        userId: MOCK_USER_ID,
        userPhone: 'whatsapp:+15551234567',
        conversationId: MOCK_CONVERSATION_ID,
      },
    );

    const result = JSON.parse(results[0]!.result);
    expect(result.status).toBe('price_unavailable');
  });
});
