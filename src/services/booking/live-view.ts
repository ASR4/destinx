/**
 * Generate the Browserbase debug URL for a session.
 * This requires authentication — used as iframe src on our live view page.
 */
export function getLiveViewUrl(sessionId: string): string {
  return `https://www.browserbase.com/devtools-fullscreen/index.html?browserbaseSessionId=${sessionId}`;
}

/**
 * Generate the user-facing Live View URL on our own domain.
 * Our page wraps the Browserbase debug view in a branded UI.
 */
export function getEmbeddableLiveViewUrl(sessionId: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${appUrl}/booking/live/${sessionId}`;
}
