import type { FastifyInstance } from 'fastify';
import { handleIncomingMessage } from '../services/whatsapp/handler.js';
import { logger } from '../utils/logger.js';
import type { TwilioWebhookPayload } from '../types/whatsapp.js';

export async function whatsappRoutes(app: FastifyInstance) {
  /**
   * POST /webhook/whatsapp
   * Twilio sends form-urlencoded data here when a user messages the WhatsApp number.
   * Must respond within 15 seconds — heavy processing is queued.
   */
  app.post('/webhook/whatsapp', async (request, reply) => {
    const body = request.body as TwilioWebhookPayload;

    logger.info(
      { messageSid: body.MessageSid, from: body.From },
      'WhatsApp webhook received',
    );

    // Respond to Twilio immediately with empty TwiML
    reply.type('text/xml').status(200).send('<Response></Response>');

    // Process the message async (don't await in the request handler)
    handleIncomingMessage({
      body: body.Body,
      from: body.From,
      messageSid: body.MessageSid,
      numMedia: parseInt(body.NumMedia || '0', 10),
      mediaUrl: body.MediaUrl0,
      latitude: body.Latitude ? parseFloat(body.Latitude) : undefined,
      longitude: body.Longitude ? parseFloat(body.Longitude) : undefined,
      buttonPayload: body.ButtonText,
      listSelection: body.ListId,
    }).catch((err) => {
      logger.error({ err, messageSid: body.MessageSid }, 'Failed to process message');
    });
  });

  /**
   * GET /webhook/whatsapp
   * Twilio verification endpoint for webhook setup.
   */
  app.get('/webhook/whatsapp', async (_request, reply) => {
    reply.status(200).send('OK');
  });
}
