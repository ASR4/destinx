import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { startBookingSession } from '../services/booking/orchestrator.js';
import { getLiveViewUrl } from '../services/booking/live-view.js';
import { destroySession } from '../services/booking/session.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const liveViewTemplate = readFileSync(
  resolve(__dirname, '../templates/live-view.html'),
  'utf-8',
);

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/booking/start', async (request, reply) => {
    const { userId, userPhone, booking } = request.body as {
      userId: string;
      userPhone: string;
      booking: Record<string, unknown>;
    };

    try {
      const session = await startBookingSession(
        userId,
        userPhone,
        booking as any,
      );
      reply.status(200).send(session);
    } catch (err) {
      logger.error({ err }, 'Failed to start booking session');
      reply.status(500).send({ error: 'Failed to start booking session' });
    }
  });

  /**
   * GET /booking/live/:sessionId
   * Mobile-optimized Live View embed page with booking status and cancel button.
   * Served from src/templates/live-view.html with placeholder substitution.
   */
  app.get('/booking/live/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const iframeUrl = getLiveViewUrl(sessionId);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const cancelUrl = `${appUrl}/booking/live/${sessionId}/cancel`;

    const html = liveViewTemplate
      .replace(/\{\{IFRAME_URL\}\}/g, iframeUrl)
      .replace(/\{\{SESSION_ID\}\}/g, sessionId)
      .replace(/\{\{CANCEL_URL\}\}/g, cancelUrl);

    reply.type('text/html').send(html);
  });

  app.post('/booking/live/:sessionId/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      await destroySession(sessionId);
      reply.status(200).send({ status: 'cancelled' });
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to cancel session');
      reply.status(500).send({ error: 'Failed to cancel session' });
    }
  });
}
