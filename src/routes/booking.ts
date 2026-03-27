import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { startBookingSession } from '../services/booking/orchestrator.js';
import { getLiveViewUrl } from '../services/booking/live-view.js';
import { destroySession } from '../services/booking/session.js';
import { logger } from '../utils/logger.js';

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
   */
  app.get('/booking/live/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const liveViewIframeUrl = getLiveViewUrl(sessionId);

    const html = buildLiveViewPage(sessionId, liveViewIframeUrl);
    reply.type('text/html').send(html);
  });

  /**
   * POST /booking/live/:sessionId/cancel
   * Cancel an active booking session from the Live View page.
   */
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

function buildLiveViewPage(sessionId: string, iframeUrl: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Destinx — Live Booking</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; }
    .container { display: flex; flex-direction: column; height: 100dvh; }
    .header { padding: 12px 16px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155; flex-shrink: 0; }
    .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .brand-icon { font-size: 20px; }
    .brand-name { font-size: 16px; font-weight: 700; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .status-bar { display: flex; align-items: center; gap: 8px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
    .status-dot.waiting { background: #eab308; }
    .status-dot.error { background: #ef4444; animation: none; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .status-text { font-size: 13px; color: #94a3b8; }
    .iframe-container { flex: 1; position: relative; overflow: hidden; }
    .iframe-container iframe { width: 100%; height: 100%; border: none; }
    .footer { padding: 12px 16px; background: #1e293b; border-top: 1px solid #334155; flex-shrink: 0; }
    .cancel-btn { width: 100%; padding: 12px; border: 1px solid #ef4444; border-radius: 8px; background: transparent; color: #ef4444; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .cancel-btn:hover, .cancel-btn:active { background: #ef4444; color: #fff; }
    .cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <span class="brand-icon">✈️</span>
        <span class="brand-name">Destinx</span>
      </div>
      <div class="status-bar">
        <div class="status-dot" id="statusDot"></div>
        <span class="status-text" id="statusText">Connecting to booking session...</span>
      </div>
    </div>
    <div class="iframe-container">
      <iframe
        src="${iframeUrl}"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        id="liveViewFrame"
      ></iframe>
    </div>
    <div class="footer">
      <button class="cancel-btn" id="cancelBtn" onclick="cancelSession()">Cancel Booking</button>
    </div>
  </div>
  <script>
    const sessionId = '${sessionId}';
    const cancelUrl = '${appUrl}/booking/live/${sessionId}/cancel';
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    const STATUS_MESSAGES = {
      connecting: 'Connecting to booking session...',
      navigating: 'Navigating to the booking site...',
      login: 'Waiting for you to log in...',
      booking: 'Filling in your booking details...',
      approval: 'Ready for your approval — review and confirm!',
      complete: 'Booking complete!',
      error: 'Something went wrong',
    };

    function updateStatus(status) {
      statusText.textContent = STATUS_MESSAGES[status] || status;
      statusDot.className = 'status-dot';
      if (status === 'login' || status === 'approval') statusDot.classList.add('waiting');
      if (status === 'error') statusDot.classList.add('error');
    }

    async function cancelSession() {
      const btn = document.getElementById('cancelBtn');
      btn.disabled = true;
      btn.textContent = 'Cancelling...';
      try {
        const res = await fetch(cancelUrl, { method: 'POST' });
        if (res.ok) {
          updateStatus('Session cancelled');
          btn.textContent = 'Session Cancelled';
        } else {
          btn.textContent = 'Cancel Failed — Try Again';
          btn.disabled = false;
        }
      } catch {
        btn.textContent = 'Cancel Failed — Try Again';
        btn.disabled = false;
      }
    }

    const frame = document.getElementById('liveViewFrame');
    frame.addEventListener('load', () => updateStatus('navigating'));
    setTimeout(() => updateStatus('navigating'), 2000);
  </script>
</body>
</html>`;
}
