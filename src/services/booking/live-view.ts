/**
 * Generate the Live View URL for a Browserbase session.
 * The user opens this on their phone to watch and interact with the booking.
 */
export function getLiveViewUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${sessionId}/live`;
}

/**
 * Generate an embeddable iframe URL for the live view
 * (for potential future web dashboard).
 */
export function getEmbeddableLiveViewUrl(sessionId: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${appUrl}/booking/live/${sessionId}`;
}
