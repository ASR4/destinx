import Twilio from 'twilio';
import type {
  ReplyButton,
  ListSection,
} from '../../types/whatsapp.js';
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

function getFromNumber(): string {
  return `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
}

export async function sendText(to: string, body: string): Promise<void> {
  const truncated = body.slice(0, WHATSAPP.MAX_MESSAGE_LENGTH);
  try {
    await getClient().messages.create({
      body: truncated,
      from: getFromNumber(),
      to,
    });
  } catch (err: any) {
    const code = err?.code ?? err?.status ?? 'unknown';
    const msg = err?.message ?? String(err);
    logger.error(
      `WhatsApp send failed [${code}]: ${msg} (to=${to}, bodyLen=${truncated.length})`,
    );
    throw err;
  }
}

/**
 * Send a message with up to 3 reply buttons.
 * Requires Twilio Content API template (ContentSid).
 */
export async function sendInteractiveButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
): Promise<void> {
  if (buttons.length > WHATSAPP.MAX_REPLY_BUTTONS) {
    throw new Error(`Max ${WHATSAPP.MAX_REPLY_BUTTONS} reply buttons allowed`);
  }
  // TODO: Implement using Twilio Content API templates
  // See: https://www.twilio.com/docs/content/create-templates
  logger.warn('sendInteractiveButtons not yet implemented, falling back to text');
  const buttonText = buttons.map((b) => `• ${b.title}`).join('\n');
  await sendText(to, `${body}\n\n${buttonText}`);
}

/**
 * Send an interactive list message (up to 10 rows).
 */
export async function sendListMessage(
  to: string,
  body: string,
  buttonText: string,
  sections: ListSection[],
): Promise<void> {
  // TODO: Implement using Twilio Content API templates
  logger.warn('sendListMessage not yet implemented, falling back to text');
  const listText = sections
    .map(
      (s) =>
        `*${s.title}*\n${s.rows.map((r) => `  • ${r.title}${r.description ? ` — ${r.description}` : ''}`).join('\n')}`,
    )
    .join('\n\n');
  await sendText(to, `${body}\n\n${listText}`);
}

export async function sendMedia(
  to: string,
  mediaUrl: string,
  caption: string,
): Promise<void> {
  try {
    await getClient().messages.create({
      body: caption,
      mediaUrl: [mediaUrl],
      from: getFromNumber(),
      to,
    });
  } catch (err) {
    logger.error({ err, to }, 'Failed to send WhatsApp media');
    throw err;
  }
}

export async function sendTypingIndicator(to: string): Promise<void> {
  await sendText(to, '✈️ Let me look into that...');
}
