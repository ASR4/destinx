import type Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Messages.Tool;

export function getTravelAgentTools(): Tool[] {
  return [
    {
      name: 'search_hotels',
      description:
        'Search for hotels in a destination for given dates. Returns availability and prices.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string', description: 'City or area name' },
          check_in: { type: 'string', description: 'YYYY-MM-DD' },
          check_out: { type: 'string', description: 'YYYY-MM-DD' },
          guests: { type: 'number' },
          budget_per_night: {
            type: 'number',
            description: 'Max price per night in USD',
          },
          style: {
            type: 'string',
            enum: ['luxury', 'boutique', 'mid-range', 'budget', 'hostel'],
          },
        },
        required: ['destination', 'check_in', 'check_out'],
      },
    },
    {
      name: 'search_flights',
      description: 'Search for flights between two airports/cities.',
      input_schema: {
        type: 'object' as const,
        properties: {
          origin: {
            type: 'string',
            description: 'Airport code or city name',
          },
          destination: {
            type: 'string',
            description: 'Airport code or city name',
          },
          departure_date: { type: 'string' },
          return_date: { type: 'string' },
          passengers: { type: 'number' },
          cabin_class: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
          },
          preferred_airlines: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['origin', 'destination', 'departure_date'],
      },
    },
    {
      name: 'search_restaurants',
      description: 'Find restaurants near a location matching preferences.',
      input_schema: {
        type: 'object' as const,
        properties: {
          location: { type: 'string' },
          cuisine: { type: 'string' },
          price_level: {
            type: 'string',
            enum: ['budget', 'moderate', 'fine_dining'],
          },
          dietary: { type: 'array', items: { type: 'string' } },
          meal: {
            type: 'string',
            enum: ['breakfast', 'lunch', 'dinner', 'brunch'],
          },
        },
        required: ['location'],
      },
    },
    {
      name: 'search_experiences',
      description:
        'Find tours, activities, and experiences at a destination.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string' },
          date: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'culture',
              'adventure',
              'food',
              'nature',
              'nightlife',
              'wellness',
              'family',
            ],
          },
          duration_hours: { type: 'number' },
          budget: { type: 'number' },
        },
        required: ['destination'],
      },
    },
    {
      name: 'search_transport',
      description:
        'Find transport options between two points (local transit, taxi, train, etc).',
      input_schema: {
        type: 'object' as const,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          date: { type: 'string' },
          preference: {
            type: 'string',
            enum: ['fastest', 'cheapest', 'scenic', 'most_comfortable'],
          },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'web_search',
      description:
        'Search the web for current information about a destination, event, restaurant, or travel topic.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'check_weather',
      description: 'Get weather forecast for a destination.',
      input_schema: {
        type: 'object' as const,
        properties: {
          location: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['location', 'date'],
      },
    },
    {
      name: 'create_trip_plan',
      description:
        'Generate a structured day-by-day trip itinerary. Call this after gathering enough info about the trip.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          travelers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age: { type: 'number' },
              },
            },
          },
          budget_total: { type: 'number' },
          interests: { type: 'array', items: { type: 'string' } },
          pace: {
            type: 'string',
            enum: ['packed', 'balanced', 'relaxed'],
          },
          must_dos: { type: 'array', items: { type: 'string' } },
          avoid: { type: 'array', items: { type: 'string' } },
        },
        required: ['destination', 'start_date', 'end_date'],
      },
    },
    {
      name: 'initiate_booking',
      description:
        'Start the browser-based booking process. This opens a live session the user can watch.',
      input_schema: {
        type: 'object' as const,
        properties: {
          booking_type: {
            type: 'string',
            enum: ['hotel', 'flight', 'restaurant', 'experience'],
          },
          provider: {
            type: 'string',
            description: 'Website to book on, e.g. marriott.com',
          },
          details: {
            type: 'object',
            description:
              'Booking-specific details (property, dates, room type, etc.)',
          },
        },
        required: ['booking_type', 'provider', 'details'],
      },
    },
    {
      name: 'save_preference',
      description:
        'Save something you learned about the user for future trips. Call this whenever the user reveals a preference.',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            enum: [
              'accommodation',
              'food',
              'transport',
              'budget',
              'travel_style',
              'loyalty',
              'dietary',
              'companion',
            ],
          },
          key: {
            type: 'string',
            description:
              'e.g., "hotel_style", "airline_preference", "spice_tolerance"',
          },
          value: { type: 'string', description: 'The preference value' },
          confidence: {
            type: 'number',
            description:
              '0-1, how confident you are about this preference',
          },
        },
        required: ['category', 'key', 'value'],
      },
    },
  ];
}
