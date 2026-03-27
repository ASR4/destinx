import type { IncomingMessage } from '../../types/whatsapp.js';
import { parseWhatsAppNumber, toWhatsAppAddress } from '../../utils/phone.js';
import { sendText, sendTypingIndicator } from './sender.js';
import { conversationQueue } from '../../jobs/queue.js';
import { logger } from '../../utils/logger.js';

/**
 * Entry point for all incoming WhatsApp messages.
 *
 * Sends an immediate typing indicator within 2 seconds, then queues
 * the heavy LLM processing. The queue worker uses BullMQ progress
 * events to send contextual holding messages if processing is slow.
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  const phone = parseWhatsAppNumber(message.from);
  const whatsappTo = toWhatsAppAddress(phone);
  logger.info({ phone, messageSid: message.messageSid }, 'Incoming message');

  // Immediate typing indicator — must happen within 2 seconds
  sendTypingIndicator(whatsappTo).catch((err) =>
    logger.error({ err }, 'Failed to send typing indicator'),
  );

  // TODO: Implement in Phase 1
  // 1. Dedup check against messages.whatsapp_message_id
  // 2. Find or create user by phone
  // 3. Find or create active conversation
  // 4. Insert message into messages table

  const userId = 'stub-user-id';
  const conversationId = 'stub-conversation-id';

  // Queue for async processing with progress-event-based holding messages
  const job = await conversationQueue.add('process', {
    userId,
    conversationId,
    message: message.body,
    userPhone: whatsappTo,
  });

  // Listen for progress events to send intermediate holding messages
  job.isCompleted().then(async () => {
    // Final response is sent by the worker
  }).catch((err) => {
    logger.error({ err, jobId: job.id }, 'Conversation job failed');
    sendText(
      whatsappTo,
      "Sorry, I hit a snag processing your message. Could you try again?",
    ).catch(() => {});
  });
}
