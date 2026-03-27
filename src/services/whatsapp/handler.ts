import { eq, and } from 'drizzle-orm';
import type { IncomingMessage } from '../../types/whatsapp.js';
import { parseWhatsAppNumber, toWhatsAppAddress } from '../../utils/phone.js';
import { sendTypingIndicator } from './sender.js';
import { conversationQueue } from '../../jobs/queue.js';
import { getDb } from '../../db/client.js';
import { users, conversations, messages } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

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
  const phone = parseWhatsAppNumber(message.from);
  const whatsappTo = toWhatsAppAddress(phone);
  logger.info({ messageSid: message.messageSid }, 'Incoming message');

  sendTypingIndicator(whatsappTo).catch((err) =>
    logger.error({ err }, 'Failed to send typing indicator'),
  );

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
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1);

  if (existingUsers.length > 0) {
    userId = existingUsers[0]!.id;
  } else {
    const inserted = await db
      .insert(users)
      .values({ phoneNumber: phone })
      .returning({ id: users.id });
    userId = inserted[0]!.id;
    logger.info({ userId }, 'New user created');
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

  // 5. Queue for async processing
  await conversationQueue.add('process', {
    userId,
    conversationId,
    message: message.body,
    userPhone: whatsappTo,
  });
}
