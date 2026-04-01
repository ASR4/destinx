import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface CorrelationContext {
  correlationId: string;
  userId?: string;
  conversationId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a short correlation ID for tracing a request through the system.
 */
export function generateCorrelationId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Run a function with a correlation context attached to the async local storage.
 * All logs emitted within this scope will include the correlationId.
 */
export function withCorrelation<T>(
  context: CorrelationContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * Get the current correlation context, or undefined if not in a traced scope.
 */
export function getCorrelation(): CorrelationContext | undefined {
  return storage.getStore();
}

/**
 * Get just the current correlationId string, or undefined.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
