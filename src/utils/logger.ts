import pino from 'pino';
import { getCorrelation } from './correlation.js';

export const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const ctx = getCorrelation();
    if (!ctx) return {};
    return {
      correlationId: ctx.correlationId,
      ...(ctx.userId && { userId: ctx.userId }),
      ...(ctx.conversationId && { conversationId: ctx.conversationId }),
    };
  },
  redact: {
    paths: [
      'phone',
      'userPhone',
      'from',
      'to',
      '*.phone',
      '*.userPhone',
      '*.from',
      '*.to',
      'phoneNumber',
      '*.phoneNumber',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
