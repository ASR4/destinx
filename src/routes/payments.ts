import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { constructWebhookEvent } from '../services/payments/stripe.js';
import { handleCheckoutCompleted } from '../services/payments/webhook.js';
import { logger } from '../utils/logger.js';

export async function paymentRoutes(app: FastifyInstance) {
  /**
   * POST /webhook/stripe
   * Stripe sends signed events here. Must use raw body for signature verification.
   *
   * The `addContentTypeParser` is scoped to a child plugin so it does NOT override
   * JSON parsing for any other route in the application.
   */
  await app.register(async (sub) => {
    sub.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );

    sub.post('/webhook/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        reply.status(400).send({ error: 'Missing stripe-signature header' });
        return;
      }

      let event;
      try {
        event = constructWebhookEvent(request.body as Buffer, signature);
      } catch (err) {
        logger.warn({ err }, 'Stripe webhook signature verification failed');
        reply.status(400).send({ error: 'Invalid signature' });
        return;
      }

      // Acknowledge immediately — process async to avoid Stripe timeout
      reply.status(200).send({ received: true });

      if (event.type === 'checkout.session.completed') {
        handleCheckoutCompleted(event.data.object as any).catch((err) =>
          logger.error({ err, eventId: event.id }, 'Failed to handle checkout.session.completed'),
        );
      } else {
        logger.debug({ type: event.type }, 'Unhandled Stripe event type');
      }
    });
  });

  /**
   * GET /payment/success — shown after successful payment
   */
  app.get('/payment/success', async (_request, reply) => {
    reply.type('text/html').send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>✅ Payment successful!</h1>
        <p>Your booking is being confirmed. You'll receive a WhatsApp message shortly.</p>
      </body></html>
    `);
  });

  /**
   * GET /payment/cancel — shown when user cancels checkout
   */
  app.get('/payment/cancel', async (_request, reply) => {
    reply.type('text/html').send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>Payment cancelled</h1>
        <p>No charge was made. Return to WhatsApp to try again.</p>
      </body></html>
    `);
  });
}
