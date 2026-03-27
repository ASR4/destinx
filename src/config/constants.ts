export const WHATSAPP = {
  MAX_MESSAGE_LENGTH: 4096,
  MAX_INTERACTIVE_BODY_LENGTH: 1024,
  MAX_REPLY_BUTTONS: 3,
  MAX_LIST_ROWS: 10,
  MAX_BUTTON_TITLE_LENGTH: 20,
  MAX_LIST_TITLE_LENGTH: 24,
  MAX_LIST_DESCRIPTION_LENGTH: 72,
} as const;

export const CONVERSATION = {
  MAX_HISTORY_MESSAGES: 20,
  MAX_CONTEXT_TOKENS: 8000,
  TYPING_INDICATOR_TEXT: '✈️ Let me look into that...',
  HOLDING_MESSAGE_DELAY_MS: 8_000,
  MAX_TOOL_LOOP_ITERATIONS: 10,
} as const;

export const BOOKING = {
  SESSION_TIMEOUT_MS: 600_000,
  LOGIN_TIMEOUT_MS: 120_000,
  CONFIRMATION_TIMEOUT_MS: 180_000,
  POLL_INTERVAL_MS: 3_000,
  PLAYWRIGHT_LOGIN_WAIT_MS: 30_000,
  MAX_ACT_RETRIES: 1,
} as const;

export const QUEUE = {
  CONVERSATION_CONCURRENCY: 10,
  PLANNING_CONCURRENCY: 3,
  BOOKING_CONCURRENCY: 2,
  MEMORY_CONCURRENCY: 10,
} as const;

export const AI = {
  CONVERSATION_MODEL: 'claude-sonnet-4-20250514' as const,
  PLANNING_MODEL: 'claude-sonnet-4-20250514' as const,
  MAX_CONVERSATION_TOKENS: 2048,
  MAX_PLANNING_TOKENS: 4096,
  MEMORY_SIMILARITY_THRESHOLD: 0.3,
  EMBEDDING_DIMENSIONS: 1536,
  MAX_MEMORY_CONTEXT_TOKENS: 500,
} as const;

export const RATE_LIMITS = {
  USER_BROWSER_SESSIONS_PER_DAY: 5,
  USER_CLAUDE_CALLS_PER_HOUR: 50,
  USER_ACTIVE_TRIP_PLANS: 3,
  SYSTEM_CONCURRENT_BROWSER_SESSIONS: 10,
  SYSTEM_CONCURRENT_CLAUDE_CALLS: 20,
} as const;

export const MEMORY = {
  CONFIDENCE_DECAY_MONTHS: 6,
  CONFIDENCE_DECAY_AMOUNT: 0.1,
  CONFIDENCE_FLOOR: 0.2,
  RERANK_SIMILARITY_WEIGHT: 0.6,
  RERANK_RECENCY_WEIGHT: 0.2,
  RERANK_CONFIDENCE_WEIGHT: 0.2,
} as const;

export const CONVERSATION_STATES = [
  'idle',
  'gathering_info',
  'planning',
  'reviewing_plan',
  'modifying_plan',
  'pre_booking',
  'booking_in_progress',
  'awaiting_confirmation',
  'post_trip',
] as const;

export type ConversationFSMState = (typeof CONVERSATION_STATES)[number];

export const SUPPORTED_PROVIDERS = [
  'marriott.com',
  'booking.com',
  'airbnb.com',
  'skyscanner.com',
  'opentable.com',
  'viator.com',
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];
