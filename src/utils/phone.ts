/**
 * Strip the "whatsapp:" prefix from Twilio's From field
 * e.g. "whatsapp:+919876543210" → "+919876543210"
 */
export function parseWhatsAppNumber(from: string): string {
  return from.replace(/^whatsapp:/, '');
}

/**
 * Normalize a phone number to E.164 format.
 * Strips spaces, dashes, parens. Prepends + if missing.
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }
  return cleaned;
}

/**
 * Format a phone number back to WhatsApp's expected "whatsapp:+..." format.
 * Idempotent — safe to call on values that already have the prefix.
 */
export function toWhatsAppAddress(phone: string): string {
  const stripped = phone.replace(/^whatsapp:/, '');
  const normalized = normalizePhone(stripped);
  return `whatsapp:${normalized}`;
}
