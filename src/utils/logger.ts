import pino from 'pino';

export const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  level: process.env.LOG_LEVEL || 'info',
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
