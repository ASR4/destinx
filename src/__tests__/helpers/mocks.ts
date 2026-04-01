/**
 * Centralized mock factories for integration and unit tests.
 */

// ---------------------------------------------------------------------------
// Mock user / conversation context
// ---------------------------------------------------------------------------

export const MOCK_USER_ID = 'user-test-123';
export const MOCK_CONVERSATION_ID = 'conv-test-456';
export const MOCK_USER_PHONE = '+15551234567';
export const MOCK_WHATSAPP_PHONE = `whatsapp:${MOCK_USER_PHONE}`;

export function mockUserProfile() {
  return {
    preferences: {
      accommodation: [],
      food: [],
      transport: [],
      budget: [],
      travel_style: [],
      loyalty: [],
      dietary: [],
      companion: [],
    },
    lastTrips: [],
    semanticMemories: [],
  };
}

// ---------------------------------------------------------------------------
// Mock flight offer (matches DuffelFlightProvider shape)
// ---------------------------------------------------------------------------

export function mockFlightOffer(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'off_test_123',
    flightNumber: 'BA456',
    airline: 'British Airways',
    departure: { airport: 'LHR', time: '2026-06-15T08:00:00Z' },
    arrival: { airport: 'JFK', time: '2026-06-15T11:00:00Z' },
    duration: '7h 00m',
    stops: 0,
    price: '$450.00',
    cabinClass: 'economy',
    conditions: { refundable: false },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    passengerIds: ['pas_test_1'],
    rawAmount: '450.00',
    rawCurrency: 'USD',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Anthropic client
// ---------------------------------------------------------------------------

export function mockAnthropicTextResponse(text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

export function mockAnthropicToolUseResponse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = 'tool_test_1',
) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

// ---------------------------------------------------------------------------
// Mock Twilio incoming message (WhatsApp webhook body)
// ---------------------------------------------------------------------------

export function mockTwilioWebhookBody(overrides: Record<string, string> = {}) {
  return {
    MessageSid: 'SM_test_' + Math.random().toString(36).slice(2),
    From: `whatsapp:${MOCK_USER_PHONE}`,
    To: 'whatsapp:+14155238886',
    Body: 'I want to plan a trip to Tokyo',
    NumMedia: '0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Duffel booking result
// ---------------------------------------------------------------------------

export function mockDuffelBookingResult(overrides: Record<string, unknown> = {}) {
  return {
    bookingReference: 'ABC123',
    orderId: 'ord_test_123',
    totalAmount: '450.00',
    totalCurrency: 'USD',
    ...overrides,
  };
}
