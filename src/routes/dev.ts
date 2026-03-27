import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users, conversations, messages } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export async function devRoutes(app: FastifyInstance) {
  app.post<{ Body: { phone?: string; message: string } }>(
    '/dev/chat',
    async (request, reply) => {
      const { message, phone = '+15550001234' } = request.body;

      if (!message) {
        reply.status(400).send({ error: 'message is required' });
        return;
      }

      const db = getDb();

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
        logger.info({ userId }, 'Dev: new user created');
      }

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
      }

      await db.insert(messages).values({
        conversationId,
        role: 'user',
        content: message,
        messageType: 'text',
      });

      const { processMessage } = await import(
        '../services/conversation/engine.js'
      );

      const holdingMessages: string[] = [];

      try {
        const response = await processMessage(userId, conversationId, message, {
          userPhone: `whatsapp:${phone}`,
          onProgress: (msg: string) => holdingMessages.push(msg),
        });

        await db.insert(messages).values({
          conversationId,
          role: 'assistant',
          content: response,
          messageType: 'text',
        });

        reply.send({
          response,
          holdingMessages,
          meta: { userId, conversationId },
        });
      } catch (err) {
        logger.error({ err }, 'Dev chat error');
        reply.status(500).send({
          error: err instanceof Error ? err.message : 'Unknown error',
          meta: { userId, conversationId },
        });
      }
    },
  );

  app.get('/dev/conversations/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const db = getDb();

    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(50);

    rows.reverse();
    reply.send({ messages: rows });
  });
}
