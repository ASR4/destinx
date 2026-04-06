import { logger } from './logger.js';

export type ErrorCategory =
  | 'claude_timeout'
  | 'claude_rate_limit'
  | 'search_api_failure'
  | 'twilio_failure'
  | 'database_error'
  | 'booking_failure'
  | 'payment_failure'
  | 'unsupported_media'
  | 'unknown';

const USER_MESSAGES: Record<ErrorCategory, string> = {
  claude_timeout: "Give me one more second...",
  claude_rate_limit: "I'm juggling a few conversations — give me 10 seconds",
  search_api_failure: "I couldn't check live data for that right now. Let me work with what I know.",
  twilio_failure: '', // user sees nothing
  database_error: "I'm having a moment — try again in a sec?",
  booking_failure: "That couldn't be booked right now — it might have sold out. Want me to find alternatives?",
  payment_failure: "The payment didn't go through. Want to try again?",
  unsupported_media: "I can read text and images — could you type that out for me?",
  unknown: "Sorry, I hit an unexpected error — please try again in a moment.",
};

export function getUserMessage(category: ErrorCategory): string {
  return USER_MESSAGES[category] || USER_MESSAGES.unknown;
}

export function categorizeError(err: unknown, context?: string): ErrorCategory {
  if (!(err instanceof Error)) return 'unknown';
  const msg = err.message.toLowerCase();
  const name = err.name?.toLowerCase() ?? '';

  if (context === 'claude' || msg.includes('anthropic')) {
    if (msg.includes('timeout') || msg.includes('529') || msg.includes('500')) return 'claude_timeout';
    if (msg.includes('rate') || msg.includes('429')) return 'claude_rate_limit';
  }
  if (context === 'twilio' || msg.includes('twilio')) return 'twilio_failure';
  if (context === 'database' || msg.includes('postgres') || msg.includes('connection')) return 'database_error';
  if (context === 'booking' || msg.includes('duffel')) return 'booking_failure';
  if (context === 'payment' || msg.includes('stripe')) return 'payment_failure';
  if (msg.includes('search') || msg.includes('api')) return 'search_api_failure';

  return 'unknown';
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 30_000, onRetry } = opts;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      onRetry?.(attempt + 1, lastError);
      logger.warn({ attempt: attempt + 1, maxRetries, delay, error: lastError.message }, 'Retrying after failure');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

export function isCircuitOpen(serviceName: string): boolean {
  const state = circuits.get(serviceName);
  if (!state) return false;
  if (!state.open) return false;

  if (Date.now() - state.openedAt > CIRCUIT_COOLDOWN_MS) {
    state.open = false;
    state.failures = 0;
    logger.info({ serviceName }, 'Circuit breaker half-open — allowing requests');
    return false;
  }

  return true;
}

export function recordFailure(serviceName: string): void {
  const now = Date.now();
  let state = circuits.get(serviceName);

  if (!state) {
    state = { failures: 0, lastFailure: 0, open: false, openedAt: 0 };
    circuits.set(serviceName, state);
  }

  if (now - state.lastFailure > CIRCUIT_WINDOW_MS) {
    state.failures = 0;
  }

  state.failures++;
  state.lastFailure = now;

  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.open = true;
    state.openedAt = now;
    logger.error({ serviceName, failures: state.failures }, 'Circuit breaker OPEN — blocking requests for 2 minutes');
  }
}

export function recordSuccess(serviceName: string): void {
  const state = circuits.get(serviceName);
  if (state) {
    state.failures = 0;
    state.open = false;
  }
}

export async function withCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>,
  fallback?: () => T,
): Promise<T> {
  if (isCircuitOpen(serviceName)) {
    logger.warn({ serviceName }, 'Circuit open — using fallback');
    if (fallback) return fallback();
    throw new Error(`Service ${serviceName} is temporarily unavailable`);
  }

  try {
    const result = await fn();
    recordSuccess(serviceName);
    return result;
  } catch (err) {
    recordFailure(serviceName);
    throw err;
  }
}
