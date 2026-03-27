import type { FastifyInstance } from 'fastify';
import { handleIncomingMessage } from '../services/whatsapp/handler.js';
import { logger } from '../utils/logger.js';
import type { TwilioWebhookPayload } from '../types/whatsapp.js';

export async function whatsappRoutes(app: FastifyInstance) {
  /**
   * POST /webhook/whatsapp
   * Twilio sends form-urlencoded data here when a user messages the WhatsApp number.
   * Validates Twilio request signature, then queues processing.
   */
  app.post('/webhook/whatsapp', async (request, reply) => {
    const body = request.body as TwilioWebhookPayload;

    // Validate Twilio request signature
    const isValid = await validateTwilioSignature(request);
    if (!isValid) {
      logger.warn({ messageSid: body.MessageSid }, 'Invalid Twilio signature — rejecting');
      reply.status(403).send('Forbidden');
      return;
    }

    logger.info(
      { messageSid: body.MessageSid },
      'WhatsApp webhook received',
    );

    reply.type('text/xml').status(200).send('<Response></Response>');

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

  app.get('/webhook/whatsapp', async (_request, reply) => {
    reply.status(200).send('OK');
  });
}

async function validateTwilioSignature(
  request: { headers: Record<string, string | string[] | undefined>; body: unknown },
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn('TWILIO_AUTH_TOKEN not set — skipping signature validation');
    return true;
  }

  const signature = request.headers['x-twilio-signature'] as string | undefined;
  if (!signature) {
    return false;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    logger.warn('APP_URL not set — skipping signature validation');
    return true;
  }

  const url = `${appUrl}/webhook/whatsapp`;
  const params = request.body as Record<string, string>;

  try {
    const { default: Twilio } = await import('twilio');
    const isValid = Twilio.validateRequest(authToken, signature, url, params);
    return isValid;
  } catch (err) {
    logger.error({ err }, 'Twilio signature validation error');
    return false;
  }
}
