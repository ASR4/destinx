import type { Stagehand } from '@browserbasehq/stagehand';
import { BaseBookingProvider } from './base.js';
import { sendText } from '../../whatsapp/sender.js';
import { logger } from '../../../utils/logger.js';
import type { BookingResult, RestaurantBookingDetails } from '../../../types/booking.js';

/**
 * Resy API-based restaurant reservation provider.
 *
 * Resy offers a partner API for making reservations programmatically.
 * This avoids browser automation entirely — much more reliable.
 *
 * API flow:
 * 1. Find the venue by name + location using /3/venue/search
 * 2. Get available slots using /4/find
 * 3. Book the slot using /3/details + /3/book
 *
 * Note: The Resy API requires users to authenticate with their own Resy
 * account (OAuth token). Without a user token we fall back to the "reserve"
 * endpoint which allows guest reservations at some venues.
 */
export class ResyProvider extends BaseBookingProvider {
  readonly providerName = 'resy.com';

  private readonly apiKey = process.env.RESY_API_KEY!;
  private readonly baseUrl = 'https://api.resy.com';

  async execute(
    _stagehand: Stagehand,
    details: Record<string, unknown>,
    _context?: { sessionId?: string },
  ): Promise<BookingResult> {
    const d = details as unknown as RestaurantBookingDetails;

    logger.info({ provider: this.providerName, restaurant: d.restaurantName }, 'Starting Resy API flow');

    try {
      // Step 1: Find the venue
      const venueId = await this.findVenue(d.restaurantName, d.location);
      if (!venueId) {
        logger.warn({ restaurant: d.restaurantName }, 'Resy venue not found — falling through');
        return { status: 'failed', error: `Restaurant "${d.restaurantName}" not found on Resy` };
      }

      // Step 2: Find available slots
      const slot = await this.findSlot(venueId, d.date, d.time, d.partySize);
      if (!slot) {
        await sendText(
          d.userPhone,
          `😔 No availability found on Resy for *${d.restaurantName}* at ${d.time} on ${d.date} for ${d.partySize} guests.\n\nWould you like me to check OpenTable instead, or try a different time?`,
        );
        return { status: 'failed', error: 'No availability found on Resy' };
      }

      // Step 3: Get booking details (config token required by Resy)
      const configToken = await this.getBookingConfig(slot.config.token, d.partySize, d.date);
      if (!configToken) {
        return { status: 'failed', error: 'Could not retrieve Resy booking config' };
      }

      // Step 4: Book the slot (requires user auth token or guest path)
      const booking = await this.bookSlot(configToken, d.specialRequests);

      if (!booking.reservation_id) {
        return { status: 'failed', error: 'Resy booking did not return a confirmation' };
      }

      const confNumber = String(booking.reservation_id);

      await sendText(
        d.userPhone,
        `✅ *Reservation Confirmed — Resy*\n\n🍽️ ${d.restaurantName}\n📅 ${d.date} at ${slot.date.start.replace('T', ' at ').slice(0, 19)}\n👥 ${d.partySize} guest(s)\n🎫 Confirmation: ${confNumber}\n\nA confirmation has been sent to your email. Enjoy your meal! 🥂`,
      );

      return {
        status: 'confirmed',
        confirmationNumber: confNumber,
        summary: { hotelName: d.restaurantName },
      };
    } catch (err) {
      logger.error({ err, restaurant: d.restaurantName }, 'Resy API error');
      return { status: 'failed', error: `Resy API error: ${String(err)}` };
    }
  }

  private async findVenue(name: string, location: string): Promise<string | null> {
    const params = new URLSearchParams({
      query: `${name} ${location}`,
      geo: JSON.stringify({ latitude: 0, longitude: 0, radius: 0 }),
    });

    const res = await fetch(`${this.baseUrl}/3/venue/search?${params}`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Resy venue search failed');
      return null;
    }

    const data = await res.json() as { search?: { hits?: Array<{ id: { resy: number } }> } };
    const hit = data.search?.hits?.[0];
    return hit ? String(hit.id.resy) : null;
  }

  private async findSlot(
    venueId: string,
    date: string,
    preferredTime: string,
    partySize: number,
  ): Promise<ResySlot | null> {
    const params = new URLSearchParams({
      lat: '0',
      long: '0',
      day: date,
      party_size: String(partySize),
      venue_id: venueId,
    });

    const res = await fetch(`${this.baseUrl}/4/find?${params}`, {
      headers: this.headers(),
    });

    if (!res.ok) return null;

    const data = await res.json() as { results?: { venues?: Array<{ slots: ResySlot[] }> } };
    const slots = data.results?.venues?.[0]?.slots ?? [];

    if (slots.length === 0) return null;

    // Find the slot closest to the preferred time
    const [preferredHour, preferredMinute] = preferredTime.split(':').map(Number) as [number, number];
    const preferredMinutes = preferredHour * 60 + preferredMinute;

    const sorted = slots.slice().sort((a, b) => {
      const aTime = parseTimeMinutes(a.date.start);
      const bTime = parseTimeMinutes(b.date.start);
      return Math.abs(aTime - preferredMinutes) - Math.abs(bTime - preferredMinutes);
    });

    return sorted[0] ?? null;
  }

  private async getBookingConfig(
    configToken: string,
    partySize: number,
    date: string,
  ): Promise<string | null> {
    const params = new URLSearchParams({
      config_id: configToken,
      party_size: String(partySize),
      day: date,
    });

    const res = await fetch(`${this.baseUrl}/3/details?${params}`, {
      headers: this.headers(),
    });

    if (!res.ok) return null;

    const data = await res.json() as { book_token?: { value: string } };
    return data.book_token?.value ?? null;
  }

  private async bookSlot(
    bookToken: string,
    specialRequests?: string,
  ): Promise<{ reservation_id?: number }> {
    const body: Record<string, unknown> = { book_token: bookToken };
    if (specialRequests) body.spec_requests = specialRequests;

    const res = await fetch(`${this.baseUrl}/3/book`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resy book failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<{ reservation_id?: number }>;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      'Content-Type': 'application/json',
      'X-Origin': 'https://resy.com',
    };
  }
}

interface ResySlot {
  date: { start: string; end: string };
  config: { token: string; type: string };
  availability: { id: number };
}

function parseTimeMinutes(isoTime: string): number {
  const time = isoTime.split('T')[1] ?? isoTime;
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}
