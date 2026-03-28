import Twilio from 'twilio';
import type { DayPlan } from '../../types/trip.js';
import { formatCurrency } from '../../utils/currency.js';
import { logger } from '../../utils/logger.js';
import { WHATSAPP } from '../../config/constants.js';

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (_client) return _client;
  _client = Twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  return _client;
}

interface ContentTemplate {
  sid: string;
  friendlyName: string;
  status: string;
}

const TEMPLATE_DEFINITIONS = {
  day_plan_nav: {
    friendlyName: 'destinx_day_plan_navigation',
    types: {
      'twilio/quick-reply': {
        body: '{{1}}',
        actions: [
          { title: '⬅️ Previous day', id: 'prev_day' },
          { title: 'Next day ➡️', id: 'next_day' },
          { title: '📋 Overview', id: 'trip_overview' },
        ],
      },
    },
    language: 'en',
  },
  hotel_options: {
    friendlyName: 'destinx_hotel_options',
    types: {
      'twilio/list-picker': {
        body: '{{1}}',
        button: 'View Hotels',
        items: [] as Array<{ id: string; item: string; description: string }>,
      },
    },
    language: 'en',
  },
  booking_confirm: {
    friendlyName: 'destinx_booking_confirm',
    types: {
      'twilio/quick-reply': {
        body: '{{1}}',
        actions: [
          { title: '✅ Approve', id: 'approve_booking' },
          { title: '❌ Cancel', id: 'cancel_booking' },
        ],
      },
    },
    language: 'en',
  },
  live_view_link: {
    friendlyName: 'destinx_live_view',
    types: {
      'twilio/call-to-action': {
        body: '{{1}}',
        actions: [
          { title: '🔗 Watch Booking', type: 'URL', url: '{{2}}' },
        ],
      },
    },
    language: 'en',
  },
  question_2_options: {
    friendlyName: 'destinx_question_2_options',
    types: {
      'twilio/quick-reply': {
        body: '{{1}}',
        actions: [
          { title: '{{2}}', id: 'option_1' },
          { title: '{{3}}', id: 'option_2' },
        ],
      },
    },
    language: 'en',
  },
  question_3_options: {
    friendlyName: 'destinx_question_3_options',
    types: {
      'twilio/quick-reply': {
        body: '{{1}}',
        actions: [
          { title: '{{2}}', id: 'option_1' },
          { title: '{{3}}', id: 'option_2' },
          { title: '{{4}}', id: 'option_3' },
        ],
      },
    },
    language: 'en',
  },
} as const;

type TemplateName = keyof typeof TEMPLATE_DEFINITIONS;

const templateCache = new Map<string, ContentTemplate>();

/**
 * Ensure all required Content Templates exist in Twilio.
 * Creates them on first run; subsequent calls are cached.
 */
export async function ensureTemplates(): Promise<void> {
  const client = getClient();

  for (const [name, def] of Object.entries(TEMPLATE_DEFINITIONS)) {
    try {
      const existing = await client.content.v1.contents.list({ limit: 100 });
      const found = existing.find((c) => c.friendlyName === def.friendlyName);

      if (found) {
        templateCache.set(name, {
          sid: found.sid,
          friendlyName: found.friendlyName,
          status: 'approved',
        });
        logger.info({ name, sid: found.sid }, 'Template already exists');
        continue;
      }

      const created = await client.content.v1.contents.create({
        friendlyName: def.friendlyName,
        language: def.language,
        types: def.types as unknown as Record<string, unknown>,
      });

      templateCache.set(name, {
        sid: created.sid,
        friendlyName: created.friendlyName,
        status: 'pending',
      });
      logger.info({ name, sid: created.sid }, 'Template created');
    } catch (err: any) {
      const detail = err?.message ?? err?.code ?? String(err);
      logger.error(`Failed to ensure template [${name}]: ${detail}`);
    }
  }
}

function getTemplateSid(name: TemplateName): string | null {
  const t = templateCache.get(name);
  return t?.sid ?? null;
}

const ITEM_EMOJI: Record<string, string> = {
  flight: '✈️', hotel: '🏨', experience: '🎭',
  restaurant: '🍽️', transport: '🚕', free_time: '🌴',
};

/**
 * Send a day plan with navigation buttons.
 * Falls back to numbered text options if template isn't approved.
 */
export async function sendDayPlanWithNav(
  to: string,
  day: DayPlan,
  totalDays: number,
): Promise<void> {
  const body = formatDayForTemplate(day, totalDays);

  const sid = getTemplateSid('day_plan_nav');
  if (sid) {
    try {
      const client = getClient();
      await client.messages.create({
        contentSid: sid,
        contentVariables: JSON.stringify({ '1': body }),
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to,
      });
      return;
    } catch (err) {
      logger.warn({ err }, 'Template send failed, using plain text fallback');
    }
  }

  const fallback = [
    body,
    '',
    '---',
    'Reply *1* ⬅️ Previous day',
    'Reply *2* ➡️ Next day',
    'Reply *3* 📋 Overview',
  ].join('\n');

  const { sendText } = await import('./sender.js');
  await sendText(to, fallback);
}

/**
 * Send hotel options as a list.
 * Falls back to numbered plain text.
 */
export async function sendHotelOptions(
  to: string,
  hotels: Array<{ name: string; price: string; rating?: number; id: string }>,
): Promise<void> {
  const body = '🏨 *Hotel Options*\nHere are the best matches:';

  const sid = getTemplateSid('hotel_options');
  if (sid) {
    try {
      const client = getClient();
      await client.messages.create({
        contentSid: sid,
        contentVariables: JSON.stringify({ '1': body }),
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to,
      });
      return;
    } catch (err) {
      logger.warn({ err }, 'Hotel list template failed, using fallback');
    }
  }

  const lines = hotels.map(
    (h, i) =>
      `*${i + 1}.* ${h.name}\n   💰 ${h.price}${h.rating ? ` · ⭐ ${h.rating}` : ''}`,
  );
  const { sendText } = await import('./sender.js');
  await sendText(to, `${body}\n\n${lines.join('\n\n')}\n\nReply with a number to select.`);
}

/**
 * Send a booking confirmation with approve/cancel buttons.
 */
export async function sendBookingConfirmation(
  to: string,
  summary: string,
): Promise<void> {
  const sid = getTemplateSid('booking_confirm');
  if (sid) {
    try {
      const client = getClient();
      await client.messages.create({
        contentSid: sid,
        contentVariables: JSON.stringify({ '1': summary }),
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to,
      });
      return;
    } catch (err) {
      logger.warn({ err }, 'Booking confirmation template failed, using fallback');
    }
  }

  const { sendText } = await import('./sender.js');
  await sendText(to, `${summary}\n\nReply *1* ✅ Approve\nReply *2* ❌ Cancel`);
}

/**
 * Send a live view link message.
 */
export async function sendLiveViewLink(
  to: string,
  statusMessage: string,
  liveUrl: string,
): Promise<void> {
  const sid = getTemplateSid('live_view_link');
  if (sid) {
    try {
      const client = getClient();
      await client.messages.create({
        contentSid: sid,
        contentVariables: JSON.stringify({ '1': statusMessage, '2': liveUrl }),
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to,
      });
      return;
    } catch (err) {
      logger.warn({ err }, 'Live view link template failed, using fallback');
    }
  }

  const { sendText } = await import('./sender.js');
  await sendText(to, `${statusMessage}\n\n🔗 ${liveUrl}`);
}

function formatDayForTemplate(day: DayPlan, totalDays: number): string {
  const lines: string[] = [];
  lines.push(`📍 *Day ${day.day_number} of ${totalDays}: ${day.date}${day.theme ? ` — ${day.theme}` : ''}*`);
  lines.push('');

  for (const item of day.items) {
    const emoji = ITEM_EMOJI[item.type] || '📌';
    const priceStr = item.price
      ? ` (${formatCurrency(item.price.amount, item.price.currency)})`
      : '';
    lines.push(`${emoji} ${item.time} — ${item.name}${priceStr}`);
  }

  if (day.accommodation) {
    lines.push('');
    lines.push(`🏨 Staying at: ${day.accommodation.name}`);
  }

  const result = lines.join('\n');
  return result.slice(0, WHATSAPP.MAX_INTERACTIVE_BODY_LENGTH);
}

/**
 * Send a question with 2-3 interactive quick-reply buttons.
 * Falls back to numbered text if template isn't available.
 */
export async function sendQuestionWithOptions(
  to: string,
  body: string,
  options: string[],
): Promise<void> {
  const count = Math.min(options.length, 3);
  const templateName = count === 2 ? 'question_2_options' : 'question_3_options';
  const truncated = options.slice(0, count).map((o) => o.slice(0, WHATSAPP.MAX_BUTTON_TITLE_LENGTH));

  const sid = getTemplateSid(templateName);
  if (sid) {
    try {
      const client = getClient();
      const vars: Record<string, string> = { '1': body.slice(0, WHATSAPP.MAX_INTERACTIVE_BODY_LENGTH) };
      truncated.forEach((o, i) => { vars[String(i + 2)] = o; });

      await client.messages.create({
        contentSid: sid,
        contentVariables: JSON.stringify(vars),
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to,
      });
      return;
    } catch (err) {
      logger.warn({ err }, 'Question template failed, using plain text fallback');
    }
  }

  // Fallback: numbered text
  const fallbackOptions = truncated.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
  const { sendText } = await import('./sender.js');
  await sendText(to, `${body}\n\n${fallbackOptions}`);
}
