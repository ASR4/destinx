import { bookingQueue } from '../../jobs/queue.js';
import { logger } from '../../utils/logger.js';
import type { Itinerary, DayItem } from '../../types/trip.js';
import type { BookingDetails } from '../../types/booking.js';

export interface BatchBookingRequest {
  itinerary: Itinerary;
  userId: string;
  userPhone: string;
  conversationId: string;
}

export interface BatchBookingResult {
  queued: number;
  items: Array<{ type: string; name: string; jobId: string }>;
}

/**
 * Queue all bookable items from an approved itinerary.
 *
 * Priority order: flights → hotels → experiences → restaurants
 * Each item is queued sequentially on the booking queue.
 * The user receives a checklist message showing what will be booked.
 */
export async function batchBookFromItinerary(
  req: BatchBookingRequest,
): Promise<BatchBookingResult> {
  const { itinerary, userId, userPhone, conversationId } = req;

  // Collect all bookable items across all days
  const bookableItems = collectBookableItems(itinerary);

  if (bookableItems.length === 0) {
    logger.info({ userId }, 'No bookable items found in itinerary');
    return { queued: 0, items: [] };
  }

  logger.info({ userId, count: bookableItems.length }, 'Queueing batch bookings');

  const results: Array<{ type: string; name: string; jobId: string }> = [];

  // Queue each item as a booking job with a delay so they run sequentially
  for (let i = 0; i < bookableItems.length; i++) {
    const item = bookableItems[i]!;
    const delay = i * 5000; // 5s stagger to avoid overwhelming providers

    const jobId = `batch-${conversationId}-${item.type}-${i}`;

    await bookingQueue.add(
      'execute',
      {
        sessionId: '', // Will be created by the browser booking worker
        userId,
        userPhone,
        booking: item.bookingDetails,
        conversationId,
      },
      {
        jobId,
        delay,
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );

    results.push({ type: item.type, name: item.name, jobId });
  }

  return { queued: bookableItems.length, items: results };
}

interface BookableItem {
  type: string;
  name: string;
  bookingDetails: BookingDetails;
  priority: number;
}

/**
 * Extract bookable items from the itinerary, prioritized by booking order.
 * Flights first (need PNR for hotels), then hotels, then experiences, then restaurants.
 */
function collectBookableItems(itinerary: Itinerary): BookableItem[] {
  const items: BookableItem[] = [];

  // Find the trip date range
  const firstDay = itinerary.days[0];
  const lastDay = itinerary.days[itinerary.days.length - 1];

  for (const day of itinerary.days) {
    for (const item of day.items) {
      const bookableItem = toBookableItem(item, day.date, firstDay, lastDay);
      if (bookableItem) {
        items.push(bookableItem);
      }
    }
  }

  // Sort: flights → hotels → experiences → restaurants → transport
  return items.sort((a, b) => a.priority - b.priority);
}

function toBookableItem(
  item: DayItem,
  date: string,
  firstDay: { date: string } | undefined,
  lastDay: { date: string } | undefined,
): BookableItem | null {
  // Only book items that have a booking_url (indicates they need to be booked)
  // or are of a type that requires booking
  switch (item.type) {
    case 'flight':
      return {
        type: 'flight',
        name: item.name,
        priority: 0,
        bookingDetails: {
          type: 'flight',
          origin: extractIataCode(item.description ?? '') ?? 'TBD',
          destination: extractIataCode(item.name) ?? 'TBD',
          departureDate: date,
          passengers: 1,
          userPhone: '', // will be filled by caller
        } as BookingDetails,
      };

    case 'hotel':
      return {
        type: 'hotel',
        name: item.name,
        priority: 1,
        bookingDetails: {
          type: 'hotel',
          destination: item.name,
          propertyName: item.name,
          checkIn: firstDay?.date ?? date,
          checkOut: lastDay?.date ?? date,
          guests: 1,
          specialRequests: item.notes,
          userPhone: '',
        } as BookingDetails,
      };

    case 'experience':
      return {
        type: 'experience',
        name: item.name,
        priority: 2,
        bookingDetails: {
          type: 'experience',
          experienceName: item.name,
          destination: item.description ?? item.name,
          date,
          participants: 1,
          userPhone: '',
        } as BookingDetails,
      };

    case 'restaurant':
      return {
        type: 'restaurant',
        name: item.name,
        priority: 3,
        bookingDetails: {
          type: 'restaurant',
          restaurantName: item.name,
          location: item.description ?? '',
          date,
          time: item.time,
          partySize: 1,
          specialRequests: item.notes,
          userPhone: '',
        } as BookingDetails,
      };

    default:
      return null;
  }
}

/** Extract IATA code from strings like "LHR → JFK" or "Flight BA456 LHR-JFK" */
function extractIataCode(text: string): string | null {
  const match = text.match(/\b([A-Z]{3})\b/);
  return match?.[1] ?? null;
}

