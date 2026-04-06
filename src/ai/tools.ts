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
      description:
        'Search for flights between two airports/cities. Returns real-time pricing from 300+ airlines via Duffel. The result includes a searchId — you MUST pass this searchId to book_flight so the booking can use the cached offer without re-fetching.',
      input_schema: {
        type: 'object' as const,
        properties: {
          origin: {
            type: 'string',
            description: 'IATA airport or city code (e.g. SFO, NYC, LHR)',
          },
          destination: {
            type: 'string',
            description: 'IATA airport or city code',
          },
          departure_date: {
            type: 'string',
            description: 'YYYY-MM-DD',
          },
          return_date: {
            type: 'string',
            description: 'YYYY-MM-DD for round trip',
          },
          passengers: { type: 'number' },
          cabin_class: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
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
        'Search the web for current information about destinations, events, visa requirements, travel advisories, weather, costs, or any travel topic. Returns rich snippets.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query (max 400 chars). Be specific for better results.',
          },
          freshness: {
            type: 'string',
            description:
              'Filter by recency: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year), or "YYYY-MM-DDtoYYYY-MM-DD" for a custom range.',
          },
          count: {
            type: 'number',
            description: 'Number of results (1-20, default 5).',
          },
          country: {
            type: 'string',
            description: 'Two-letter country code to localize results (e.g. US, GB, JP).',
          },
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
      name: 'book_flight',
      description:
        'Book a flight using the Duffel API. Pass the search_id returned by search_flights — this lets the system retrieve the cached offer without re-fetching and prevents expiry issues. Also include flight_number, origin, destination, and departure_date for auto-retry in case of a cache miss.',
      input_schema: {
        type: 'object' as const,
        properties: {
          search_id: {
            type: 'string',
            description: 'The searchId returned by search_flights. Required for the primary booking path.',
          },
          flight_number: {
            type: 'string',
            description: 'Flight number e.g. AI2710 — used to match the cached offer and for auto-retry if cache expires.',
          },
          origin: {
            type: 'string',
            description: 'IATA origin code from the search — needed for auto-retry fallback.',
          },
          destination: {
            type: 'string',
            description: 'IATA destination code from the search — needed for auto-retry fallback.',
          },
          departure_date: {
            type: 'string',
            description: 'YYYY-MM-DD departure date — needed for auto-retry fallback.',
          },
          cabin_class: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
          },
          passengers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                given_name: { type: 'string' },
                family_name: { type: 'string' },
                born_on: {
                  type: 'string',
                  description: 'Date of birth YYYY-MM-DD',
                },
                gender: { type: 'string', enum: ['m', 'f'] },
                email: { type: 'string' },
                phone_number: {
                  type: 'string',
                  description: 'E.164 format e.g. +14155552671',
                },
                title: {
                  type: 'string',
                  enum: ['mr', 'ms', 'mrs', 'miss', 'dr'],
                },
              },
              required: [
                'given_name',
                'family_name',
                'born_on',
                'gender',
                'email',
                'phone_number',
                'title',
              ],
            },
            description: 'One entry per passenger.',
          },
        },
        required: ['search_id', 'passengers', 'flight_number', 'origin', 'destination', 'departure_date'],
      },
    },
    {
      name: 'initiate_booking',
      description:
        'Start a browser-based booking process for hotels, restaurants, or experiences. Opens a live session the user can watch. Do NOT use this for flights — use book_flight instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          booking_type: {
            type: 'string',
            enum: ['hotel', 'restaurant', 'experience'],
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
      name: 'modify_trip_plan',
      description:
        'Apply a modification to an existing trip itinerary. Use this when the user wants to change, add, or remove something from their plan.',
      input_schema: {
        type: 'object' as const,
        properties: {
          trip_id: { type: 'string', description: 'The trip ID to modify' },
          modification: {
            type: 'string',
            description: 'Natural language description of the change, e.g. "replace the Nikko day trip with a day in Kyoto"',
          },
        },
        required: ['trip_id', 'modification'],
      },
    },
    {
      name: 'search_events',
      description:
        'Search for events, concerts, festivals, sports, and activities at a destination during travel dates.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string', description: 'City or region' },
          start_date: { type: 'string', description: 'YYYY-MM-DD' },
          end_date: { type: 'string', description: 'YYYY-MM-DD' },
          category: {
            type: 'string',
            enum: ['music', 'sports', 'arts', 'family', 'film', 'festival'],
            description: 'Filter by event type',
          },
        },
        required: ['destination', 'start_date', 'end_date'],
      },
    },
    {
      name: 'generate_itinerary_pdf',
      description:
        'Generate a beautiful PDF of the trip itinerary and return a shareable link. Call this when the user asks for a PDF, printable version, or wants to share their itinerary.',
      input_schema: {
        type: 'object' as const,
        properties: {
          trip_id: { type: 'string', description: 'The trip ID to export' },
          title: { type: 'string', description: 'Title for the PDF, e.g. "Tokyo Adventure 2026"' },
        },
        required: ['trip_id'],
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
    {
      name: 'confirm_booking',
      description:
        'Record that the user has confirmed a booking they made via a deep link. Call this when the user says they booked something (e.g. "I booked that hotel" or "Done, I reserved it").',
      input_schema: {
        type: 'object' as const,
        properties: {
          booking_type: {
            type: 'string',
            enum: ['hotel', 'restaurant', 'experience', 'flight'],
            description: 'Type of booking confirmed',
          },
          item_name: {
            type: 'string',
            description: 'Name of the hotel/restaurant/experience/flight',
          },
          reference_number: {
            type: 'string',
            description: 'Booking confirmation/reference number if the user shared it',
          },
          notes: {
            type: 'string',
            description: 'Any additional details the user shared about the booking',
          },
        },
        required: ['booking_type', 'item_name'],
      },
    },
  ];
}
