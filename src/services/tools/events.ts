import { logger } from '../../utils/logger.js';

export interface EventResult {
  name: string;
  venue: string;
  date: string;
  time?: string;
  category: string;
  priceRange?: string;
  ticketUrl?: string;
  description?: string;
}

interface TicketmasterEvent {
  name: string;
  dates: { start: { localDate: string; localTime?: string } };
  classifications?: Array<{ segment?: { name?: string } }>;
  priceRanges?: Array<{ min: number; max: number; currency: string }>;
  url?: string;
  info?: string;
  _embedded?: {
    venues?: Array<{ name?: string; city?: { name?: string } }>;
  };
}

/**
 * Search for events at a destination around specific dates using Ticketmaster Discovery API.
 *
 * Falls back to Brave web search if no Ticketmaster API key is configured.
 * Gracefully returns empty array if both fail.
 */
export async function searchEvents(
  destination: string,
  dateRange: { start: string; end: string },
  category?: string,
): Promise<EventResult[]> {
  const ticketmasterKey = process.env.TICKETMASTER_API_KEY;

  if (ticketmasterKey) {
    return searchTicketmaster(destination, dateRange, category, ticketmasterKey);
  }

  // Fallback: Brave search for events
  return searchEventsBrave(destination, dateRange, category);
}

async function searchTicketmaster(
  destination: string,
  dateRange: { start: string; end: string },
  category: string | undefined,
  apiKey: string,
): Promise<EventResult[]> {
  const params = new URLSearchParams({
    apikey: apiKey,
    city: destination,
    startDateTime: `${dateRange.start}T00:00:00Z`,
    endDateTime: `${dateRange.end}T23:59:59Z`,
    size: '10',
    sort: 'relevance,desc',
  });

  if (category) {
    const segmentMap: Record<string, string> = {
      music: 'KZFzniwnSyZfZ7v7nJ',
      sports: 'KZFzniwnSyZfZ7v7nE',
      arts: 'KZFzniwnSyZfZ7v7na',
      family: 'KZFzniwnSyZfZ7v7n1',
      film: 'KZFzniwnSyZfZ7v7nn',
    };
    const segmentId = segmentMap[category.toLowerCase()];
    if (segmentId) params.set('segmentId', segmentId);
  }

  try {
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
    );

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Ticketmaster API error');
      return [];
    }

    const data = await res.json() as {
      _embedded?: { events?: TicketmasterEvent[] };
    };
    const events = data._embedded?.events ?? [];

    return events.map((e): EventResult => {
      const venue = e._embedded?.venues?.[0];
      const venueName = venue?.name && venue?.city?.name
        ? `${venue.name}, ${venue.city.name}`
        : venue?.name ?? destination;

      const classification = e.classifications?.[0]?.segment?.name ?? 'Event';

      const price = e.priceRanges?.[0];
      const priceRange = price
        ? `${price.currency} ${price.min} - ${price.max}`
        : undefined;

      return {
        name: e.name,
        venue: venueName,
        date: e.dates.start.localDate,
        time: e.dates.start.localTime,
        category: classification,
        priceRange,
        ticketUrl: e.url,
        description: e.info,
      };
    });
  } catch (err) {
    logger.error({ err }, 'Ticketmaster search failed');
    return [];
  }
}

async function searchEventsBrave(
  destination: string,
  dateRange: { start: string; end: string },
  category: string | undefined,
): Promise<EventResult[]> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) return [];

  const categoryTerm = category ? ` ${category}` : '';
  const query = `events${categoryTerm} in ${destination} ${dateRange.start} to ${dateRange.end}`;

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': braveKey,
        },
      },
    );

    if (!res.ok) return [];

    const data = await res.json() as {
      web?: { results?: Array<{ title: string; description?: string; url?: string }> };
    };

    return (data.web?.results ?? []).slice(0, 5).map((r): EventResult => ({
      name: r.title,
      venue: destination,
      date: dateRange.start,
      category: category ?? 'Event',
      description: r.description,
      ticketUrl: r.url,
    }));
  } catch (err) {
    logger.warn({ err }, 'Brave events search failed');
    return [];
  }
}
