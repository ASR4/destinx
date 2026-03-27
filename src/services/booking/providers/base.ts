import type { Stagehand } from '@browserbasehq/stagehand';
import type { BookingResult } from '../../../types/booking.js';
import { sendText } from '../../whatsapp/sender.js';
import { BOOKING } from '../../../config/constants.js';
import { logger } from '../../../utils/logger.js';

export abstract class BaseBookingProvider {
  abstract readonly providerName: string;

  abstract execute(
    stagehand: Stagehand,
    details: Record<string, unknown>,
  ): Promise<BookingResult>;

  /**
   * Wait for user login using cheap URL polling first,
   * falling back to Stagehand observe() only after 30 seconds.
   * URL polling has zero LLM cost — each observe() is an inference call.
   */
  protected async waitForLogin(
    stagehand: Stagehand,
    options: {
      indicator: string;
      urlPattern?: string | RegExp;
      loggedInSelector?: string;
      timeout?: number;
    },
  ): Promise<boolean> {
    const timeout = options.timeout ?? BOOKING.LOGIN_TIMEOUT_MS;
    const page = stagehand.context.activePage()!;

    // Phase 1: Cheap URL polling (no LLM calls)
    if (options.urlPattern) {
      const playwrightTimeout = Math.min(BOOKING.PLAYWRIGHT_LOGIN_WAIT_MS, timeout);
      const pollStart = Date.now();
      while (Date.now() - pollStart < playwrightTimeout) {
        const currentUrl = page.url();
        const matched = options.urlPattern instanceof RegExp
          ? options.urlPattern.test(currentUrl)
          : currentUrl.includes(options.urlPattern);
        if (matched) {
          logger.info('Login detected via URL pattern match');
          return true;
        }
        await sleep(500);
      }
    }

    // Phase 2: Fall back to Stagehand observe() polling for the remaining time
    const elapsed = options.urlPattern ? BOOKING.PLAYWRIGHT_LOGIN_WAIT_MS : 0;
    const remainingMs = timeout - elapsed;
    if (remainingMs <= 0) return false;

    const pollStart = Date.now();
    while (Date.now() - pollStart < remainingMs) {
      try {
        const result = await stagehand.observe(options.indicator);
        if (result && result.length > 0) {
          logger.info('Login detected via Stagehand observe fallback');
          return true;
        }
      } catch (err) {
        logger.warn({ err }, 'Error during login poll');
      }
      await sleep(BOOKING.POLL_INTERVAL_MS);
    }

    return false;
  }

  protected async waitForConfirmation(
    stagehand: Stagehand,
    options: {
      indicator: string;
      urlPattern?: string | RegExp;
      timeout?: number;
    },
  ): Promise<boolean> {
    const timeout = options.timeout ?? BOOKING.CONFIRMATION_TIMEOUT_MS;
    const page = stagehand.context.activePage()!;

    // Try URL pattern match first (cheap)
    if (options.urlPattern) {
      const pollStart = Date.now();
      while (Date.now() - pollStart < timeout) {
        const currentUrl = page.url();
        const matched = options.urlPattern instanceof RegExp
          ? options.urlPattern.test(currentUrl)
          : currentUrl.includes(options.urlPattern);
        if (matched) return true;
        await sleep(1000);
      }
      return false;
    }

    // Fall back to Stagehand observe
    const pollStart = Date.now();
    while (Date.now() - pollStart < timeout) {
      try {
        const result = await stagehand.observe(options.indicator);
        if (result && result.length > 0) return true;
      } catch (err) {
        logger.warn({ err }, 'Error during confirmation poll');
      }
      await sleep(5000);
    }
    return false;
  }

  /**
   * Retry a Stagehand act() call once with a rephrased instruction on failure.
   */
  protected async actWithRetry(
    stagehand: Stagehand,
    instruction: string,
  ): Promise<void> {
    try {
      await stagehand.act(instruction);
    } catch (firstErr) {
      logger.warn({ err: firstErr, instruction }, 'act() failed, retrying with rephrased instruction');
      const rephrased = `Please try to: ${instruction}. Look for alternative buttons or links that accomplish the same thing.`;
      await stagehand.act(rephrased);
    }
  }

  protected async handleCaptcha(
    stagehand: Stagehand,
    userPhone?: string,
  ): Promise<void> {
    const hasCaptcha = await stagehand.observe(
      'Is there a CAPTCHA, "verify you are human", or similar challenge visible?',
    );

    if (hasCaptcha && hasCaptcha.length > 0) {
      if (userPhone) {
        await sendText(
          userPhone,
          "🤖 There's a verification challenge on the page. Please solve it in the browser window — I'll continue once it's done!",
        );
      }
      await this.waitForLogin(stagehand, {
        indicator: 'Is the CAPTCHA challenge gone or solved?',
        timeout: 60000,
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
