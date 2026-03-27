import Browserbase from '@browserbasehq/sdk';
import { logger } from '../../utils/logger.js';
import { BOOKING } from '../../config/constants.js';

let _bb: Browserbase | null = null;

function getBrowserbase(): Browserbase {
  if (_bb) return _bb;
  _bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
  return _bb;
}

export interface BrowserSession {
  id: string;
  connectUrl: string;
}

/**
 * Create a new Browserbase session with stealth mode, proxy, and CAPTCHA solving.
 */
export async function createBrowserSession(): Promise<BrowserSession> {
  const bb = getBrowserbase();

  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      advancedStealth: true,
      solveCaptchas: true,
    },
    keepAlive: true,
    timeout: BOOKING.SESSION_TIMEOUT_MS / 1000,
  });

  logger.info({ sessionId: session.id }, 'Browser session created');

  return {
    id: session.id,
    connectUrl: session.connectUrl,
  };
}

/**
 * Destroy a browser session after booking completes or times out.
 */
export async function destroySession(sessionId: string): Promise<void> {
  try {
    const bb = getBrowserbase();
    await bb.sessions.update(sessionId, { status: 'REQUEST_RELEASE' });
    logger.info({ sessionId }, 'Browser session destroyed');
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to destroy browser session');
  }
}
