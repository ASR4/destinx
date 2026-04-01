import type { BookingDetails } from '../../../types/booking.js';
import type { BaseBookingProvider } from './base.js';

/**
 * Marriott brand names for loyalty-aware routing.
 * Guests with Bonvoy points get routed to the direct Marriott flow.
 */
const MARRIOTT_BRANDS = [
  'marriott',
  'westin',
  'sheraton',
  'w hotel',
  'w hotels',
  'st. regis',
  'st regis',
  'ritz-carlton',
  'ritz carlton',
  'renaissance',
  'courtyard',
  'fairfield',
  'springhill',
  'residence inn',
  'towneplace',
  'autograph collection',
  'delta hotels',
  'le méridien',
  'le meridien',
  'four points',
  'aloft',
  'element',
  'tribute portfolio',
  'design hotels',
  'bonvoy',
];

/**
 * Resy uses an API, not browser automation — prefer it if the key is configured.
 */
function hasResyKey(): boolean {
  return Boolean(process.env.RESY_API_KEY);
}

/**
 * Select the most appropriate booking provider for the given booking details.
 *
 * Routing logic:
 * - Hotels: Marriott brands → MarriottBookingProvider, else → BookingComProvider
 * - Restaurants: Resy API available → ResyProvider, else → OpenTableProvider
 * - Experiences: ViatorProvider
 * - Accommodation (non-hotel): AirbnbProvider
 */
export async function selectProvider(booking: BookingDetails): Promise<BaseBookingProvider> {
  switch (booking.type) {
    case 'hotel': {
      const propertyName = booking.propertyName?.toLowerCase() ?? '';
      const isMarriottBrand = MARRIOTT_BRANDS.some((brand) => propertyName.includes(brand));

      if (isMarriottBrand) {
        const { MarriottBookingProvider } = await import('./marriott.js');
        return new MarriottBookingProvider();
      }

      const { BookingComProvider } = await import('./booking-com.js');
      return new BookingComProvider();
    }

    case 'restaurant': {
      if (hasResyKey()) {
        // Resy is API-based — only use if key is configured
        try {
          const { ResyProvider } = await import('./resy.js');
          return new ResyProvider();
        } catch {
          // Resy module not yet available — fall through to OpenTable
        }
      }
      const { OpenTableProvider } = await import('./opentable.js');
      return new OpenTableProvider();
    }

    case 'experience': {
      const { ViatorProvider } = await import('./viator.js');
      return new ViatorProvider();
    }

    case 'flight':
      // Flights go through Duffel API, not browser automation
      throw new Error('Flights are booked via Duffel API, not browser automation');

    default: {
      // Fallback: use Booking.com (covers hotels, apartments, etc.)
      const { BookingComProvider } = await import('./booking-com.js');
      return new BookingComProvider();
    }
  }
}

/**
 * Returns a human-readable description of which provider will be used.
 * Used for logging and user-facing messages.
 */
export function describeProvider(booking: BookingDetails): string {
  switch (booking.type) {
    case 'hotel': {
      const propertyName = booking.propertyName?.toLowerCase() ?? '';
      const isMarriottBrand = MARRIOTT_BRANDS.some((brand) => propertyName.includes(brand));
      return isMarriottBrand ? 'Marriott Bonvoy' : 'Booking.com';
    }
    case 'restaurant':
      return hasResyKey() ? 'Resy' : 'OpenTable';
    case 'experience':
      return 'Viator';
    case 'flight':
      return 'Duffel';
    default:
      return 'Booking.com';
  }
}
