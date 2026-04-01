import { eq, and } from 'drizzle-orm';
import type { IncomingMessage } from '../../types/whatsapp.js';
import { parseWhatsAppNumber, toWhatsAppAddress } from '../../utils/phone.js';
import { conversationQueue } from '../../jobs/queue.js';
import { getDb } from '../../db/client.js';
import { users, conversations, messages } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { generateCorrelationId, withCorrelation } from '../../utils/correlation.js';

const OPT_OUT_PATTERN = /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)\s*$/i;
const OPT_IN_PATTERN = /^\s*(start|subscribe|yes|ok|hello|hi)\s*$/i;

/**
 * Entry point for all incoming WhatsApp messages.
 *
 * 1. Sends immediate typing indicator (within 2s)
 * 2. Deduplicates by MessageSid
 * 3. Upserts user by phone number
 * 4. Finds or creates active conversation
 * 5. Stores inbound message
 * 6. Queues conversation processing
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  const correlationId = generateCorrelationId();
  return withCorrelation({ correlationId }, () => _handleIncomingMessage(message, correlationId));
}

async function _handleIncomingMessage(
  message: IncomingMessage,
  correlationId: string,
): Promise<void> {
  const phone = parseWhatsAppNumber(message.from);
  const whatsappTo = toWhatsAppAddress(phone);
  logger.info({ messageSid: message.messageSid }, 'Incoming message');

  const db = getDb();

  // 1. Dedup check by whatsapp_message_id
  const existingMsg = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.whatsappMessageId, message.messageSid))
    .limit(1);

  if (existingMsg.length > 0) {
    logger.info({ messageSid: message.messageSid }, 'Duplicate message — skipping');
    return;
  }

  // 2. Find or create user by phone number (upsert)
  let userId: string;
  let isNewUser = false;
  let userActive = true;
  const existingUsers = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1);

  if (existingUsers.length > 0) {
    userId = existingUsers[0]!.id;
    userActive = existingUsers[0]!.active ?? true;
  } else {
    const inserted = await db
      .insert(users)
      .values({ phoneNumber: phone, active: true })
      .returning({ id: users.id });
    userId = inserted[0]!.id;
    isNewUser = true;
    logger.info({ userId }, 'New user created');
  }

  // Handle STOP / opt-out — mark inactive and reply, then stop processing
  if (OPT_OUT_PATTERN.test(message.body)) {
    await db
      .update(users)
      .set({ active: false, optedOutAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
    const { sendText } = await import('./sender.js');
    await sendText(whatsappTo, 'You have been unsubscribed from Destinx. Reply START at any time to re-enable messages.').catch(() => {});
    logger.info({ userId }, 'User opted out — marked inactive');
    return;
  }

  // Handle opt-in after previous opt-out
  if (!userActive && OPT_IN_PATTERN.test(message.body)) {
    await db
      .update(users)
      .set({ active: true, optedOutAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    userActive = true;
    logger.info({ userId }, 'User opted back in');
  }

  // Block outbound to inactive users
  if (!userActive) {
    logger.info({ userId }, 'Message from inactive user — not processing');
    return;
  }

  // Send opt-in greeting for brand-new users
  if (isNewUser) {
    const { sendText } = await import('./sender.js');
    await sendText(
      whatsappTo,
      "👋 Welcome to Destinx — your AI travel agent! I can plan trips, search flights & hotels, and book for you.\n\nReply *STOP* at any time to unsubscribe.",
    ).catch(() => {});
  }

  // 3. Find or create active conversation for this user
  let conversationId: string;
  const activeConvos = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.status, 'active'),
      ),
    )
    .limit(1);

  if (activeConvos.length > 0) {
    conversationId = activeConvos[0]!.id;
  } else {
    const inserted = await db
      .insert(conversations)
      .values({ userId, status: 'active', context: { fsmState: 'idle' } })
      .returning({ id: conversations.id });
    conversationId = inserted[0]!.id;
    logger.info({ conversationId, userId }, 'New conversation created');
  }

  // 4. Store the inbound message
  await db.insert(messages).values({
    conversationId,
    role: 'user',
    content: message.body,
    messageType: 'text',
    whatsappMessageId: message.messageSid,
    metadata: {
      ...(message.latitude != null && { latitude: message.latitude }),
      ...(message.longitude != null && { longitude: message.longitude }),
      ...(message.buttonPayload && { buttonPayload: message.buttonPayload }),
      ...(message.listSelection && { listSelection: message.listSelection }),
    },
  });

  // 5. Queue for async processing (propagate correlation ID for end-to-end tracing)
  await conversationQueue.add('process', {
    userId,
    conversationId,
    message: message.body,
    userPhone: whatsappTo,
    correlationId,
  });
}
