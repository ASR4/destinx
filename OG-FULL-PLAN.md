# AI Travel Agent — Full Implementation Spec
# WhatsApp-first, browser-automation-powered, memory-driven

## PROJECT OVERVIEW

Build a conversational AI travel agent that:
1. Talks to users via WhatsApp (Business API)
2. Plans trips end-to-end (flights, stays, experiences, restaurants, transport)
3. Remembers user preferences across conversations (taste, budget, style, dietary, loyalty programs)
4. Books through the user's own accounts via cloud browser automation (preserving loyalty points/status)
5. Lets users watch and approve bookings live on their phone

---

## TECH STACK

### Core
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Fastify (lightweight, fast, good for webhooks)
- **Database**: PostgreSQL 16 with JSONB (user profiles, conversation history, trip plans)
- **Cache**: Redis (session state, rate limiting, conversation context window)
- **ORM**: Drizzle ORM (type-safe, lightweight)
- **Queue**: BullMQ on Redis (async jobs: browser sessions, plan generation, notifications)

### AI Layer
- **LLM**: Anthropic Claude API (claude-sonnet-4-20250514 for conversation, claude-sonnet-4-20250514 for planning)
- **Embeddings**: Voyage AI or OpenAI text-embedding-3-small (for memory similarity search)
- **Vector Store**: pgvector extension on PostgreSQL (keeps infra simple)

### WhatsApp
- **Provider**: Twilio WhatsApp Business API (or WATI if targeting India-first)
- **Webhook handler**: Fastify route receiving Twilio webhooks
- **Message types**: Text, interactive lists, reply buttons, media (images/PDFs), location

### Browser Automation
- **Cloud Browser**: Browserbase (managed, stealth, CAPTCHA solving, Live View)
- **Agent Framework**: Stagehand (TypeScript, Playwright-based, act/extract/observe)
- **CAPTCHA Fallback**: 2Captcha API (human solvers, highest reliability)
- **Proxy**: Browserbase built-in proxy super network (residential IPs)

### Infrastructure
- **Hosting**: Railway or Fly.io (easy deploy, auto-scaling)
- **File Storage**: Cloudflare R2 (itinerary PDFs, screenshots)
- **Monitoring**: Sentry (errors), Browserbase Inspector (session replays)
- **Secrets**: Environment variables via hosting platform

---

## DATABASE SCHEMA

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) UNIQUE NOT NULL, -- E.164 format
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User memory/preferences (structured)
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL, -- 'accommodation', 'food', 'transport', 'budget', 'travel_style', 'loyalty', 'dietary', 'companion'
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  confidence FLOAT DEFAULT 0.5, -- 0-1, increases with repeated signals
  source VARCHAR(50) NOT NULL, -- 'explicit' (user said it), 'inferred' (extracted from behavior), 'feedback' (post-trip)
  last_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, key)
);

-- Semantic memory (for fuzzy preference matching)
CREATE TABLE user_memory_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- natural language memory snippet
  embedding vector(1536), -- voyage/openai embedding
  metadata JSONB, -- { trip_id, category, date }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON user_memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'planning', 'booking', 'completed', 'archived'
  trip_id UUID REFERENCES trips(id),
  context JSONB DEFAULT '{}', -- running conversation context for LLM
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text', -- 'text', 'interactive', 'media', 'location'
  whatsapp_message_id VARCHAR(100), -- for dedup
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trips
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  destination VARCHAR(255),
  start_date DATE,
  end_date DATE,
  status VARCHAR(20) DEFAULT 'planning', -- 'planning', 'confirmed', 'in_progress', 'completed', 'cancelled'
  plan JSONB NOT NULL DEFAULT '{}', -- full structured itinerary
  budget JSONB, -- { total: number, currency: string, breakdown: {...} }
  travelers JSONB, -- [{ name, age, relation }]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings (individual items within a trip)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL, -- 'flight', 'hotel', 'experience', 'restaurant', 'transport'
  provider VARCHAR(100), -- 'marriott.com', 'delta.com', 'opentable.com'
  status VARCHAR(20) DEFAULT 'planned', -- 'planned', 'pending_booking', 'booked', 'cancelled', 'failed'
  details JSONB NOT NULL, -- provider-specific booking details
  booking_reference VARCHAR(100), -- confirmation number after booking
  price JSONB, -- { amount, currency, loyalty_points_used }
  browser_session_id VARCHAR(100), -- Browserbase session ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking automation scripts (cached Stagehand flows per provider)
CREATE TABLE automation_scripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(100) NOT NULL, -- 'marriott.com'
  script_type VARCHAR(30) NOT NULL, -- 'search', 'login', 'book', 'cancel'
  steps JSONB NOT NULL, -- cached Stagehand action sequence
  last_validated_at TIMESTAMPTZ,
  success_rate FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, script_type)
);
```

---

## PROJECT STRUCTURE

```
travel-agent/
├── src/
│   ├── index.ts                    # Fastify server entry point
│   ├── config/
│   │   ├── env.ts                  # Environment variable validation (zod)
│   │   └── constants.ts            # App-wide constants
│   ├── db/
│   │   ├── client.ts               # Drizzle client setup
│   │   ├── schema.ts               # Drizzle schema definitions
│   │   └── migrations/             # SQL migrations
│   ├── routes/
│   │   ├── whatsapp.ts             # POST /webhook/whatsapp — Twilio webhook
│   │   ├── booking.ts              # POST /booking/start, GET /booking/live/:sessionId
│   │   └── health.ts               # GET /health
│   ├── services/
│   │   ├── whatsapp/
│   │   │   ├── handler.ts          # Incoming message router
│   │   │   ├── sender.ts           # Outgoing message formatter + sender
│   │   │   ├── templates.ts        # WhatsApp message templates (list, buttons, etc.)
│   │   │   └── media.ts            # PDF/image attachment handling
│   │   ├── conversation/
│   │   │   ├── engine.ts           # Main conversation orchestrator
│   │   │   ├── intent.ts           # Intent classifier (new trip, modify, book, question, feedback)
│   │   │   ├── clarifier.ts        # Asks follow-up questions based on missing info
│   │   │   └── context.ts          # Manages sliding context window for LLM
│   │   ├── planning/
│   │   │   ├── planner.ts          # Trip plan generator (calls LLM with tools)
│   │   │   ├── research.ts         # Web search for destinations, events, restaurants
│   │   │   ├── itinerary.ts        # Structures plan into day-by-day itinerary
│   │   │   ├── pricing.ts          # Fetches live prices via APIs/scraping
│   │   │   └── pdf.ts              # Generates shareable itinerary PDF
│   │   ├── memory/
│   │   │   ├── extractor.ts        # Extracts preferences from conversation
│   │   │   ├── store.ts            # CRUD for user_preferences table
│   │   │   ├── embeddings.ts       # Embeds + stores semantic memories
│   │   │   ├── recall.ts           # Retrieves relevant memories for context
│   │   │   └── profile.ts          # Builds full user profile from all memory sources
│   │   ├── booking/
│   │   │   ├── orchestrator.ts     # Manages the full booking flow
│   │   │   ├── session.ts          # Browserbase session lifecycle
│   │   │   ├── live-view.ts        # Generates + manages Live View links
│   │   │   └── providers/
│   │   │       ├── base.ts         # Abstract BookingProvider class
│   │   │       ├── marriott.ts     # Marriott-specific Stagehand flow
│   │   │       ├── booking-com.ts  # Booking.com flow
│   │   │       ├── airbnb.ts       # Airbnb flow
│   │   │       ├── skyscanner.ts   # Flight search + deep link
│   │   │       ├── opentable.ts    # Restaurant reservation
│   │   │       └── viator.ts       # Experience booking
│   │   ├── search/
│   │   │   ├── flights.ts          # Amadeus Self-Service API (search only)
│   │   │   ├── hotels.ts           # Google Places + direct provider search
│   │   │   ├── restaurants.ts      # Google Places + Yelp Fusion API
│   │   │   ├── experiences.ts      # GetYourGuide / Viator API
│   │   │   └── transport.ts        # Rome2Rio API for local transport
│   │   └── tools/
│   │       ├── web-search.ts       # Brave Search API wrapper
│   │       ├── maps.ts             # Google Maps API (distances, directions)
│   │       ├── weather.ts          # OpenWeatherMap API
│   │       └── events.ts           # Ticketmaster / local events API
│   ├── ai/
│   │   ├── client.ts               # Anthropic SDK client
│   │   ├── prompts/
│   │   │   ├── system.ts           # Base system prompt for the travel agent
│   │   │   ├── planning.ts         # Trip planning prompt with tool definitions
│   │   │   ├── extraction.ts       # Memory extraction prompt
│   │   │   ├── clarification.ts    # Clarifying questions prompt
│   │   │   └── booking.ts          # Booking confirmation prompt
│   │   └── tools.ts                # Claude tool definitions (function calling)
│   ├── jobs/
│   │   ├── queue.ts                # BullMQ queue setup
│   │   ├── workers/
│   │   │   ├── plan-generator.ts   # Async trip plan generation
│   │   │   ├── browser-booking.ts  # Async browser automation booking
│   │   │   ├── memory-extract.ts   # Background preference extraction
│   │   │   ├── price-check.ts      # Periodic price monitoring
│   │   │   └── post-trip.ts        # Post-trip feedback collection
│   │   └── scheduler.ts            # Cron jobs (price alerts, trip reminders)
│   ├── utils/
│   │   ├── phone.ts                # Phone number normalization
│   │   ├── currency.ts             # Currency formatting + conversion
│   │   ├── date.ts                 # Date parsing + timezone handling
│   │   ├── deeplink.ts             # Deep link generator for booking platforms
│   │   └── logger.ts               # Structured logging (pino)
│   └── types/
│       ├── whatsapp.ts             # Twilio webhook payload types
│       ├── trip.ts                 # Trip, Itinerary, DayPlan types
│       ├── booking.ts              # Booking, Provider types
│       ├── memory.ts               # Preference, Memory types
│       └── conversation.ts         # Message, Intent, ConversationState types
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## IMPLEMENTATION GUIDE — BUILD IN THIS ORDER

### PHASE 1: WhatsApp + Conversation Loop (Week 1-2)

#### Step 1: Project setup
```bash
mkdir travel-agent && cd travel-agent
npm init -y
npm install fastify @fastify/cors @fastify/formbody
npm install @anthropic-ai/sdk
npm install twilio
npm install drizzle-orm postgres
npm install bullmq ioredis
npm install zod pino
npm install -D typescript @types/node tsx drizzle-kit
```

Create tsconfig.json with strict mode, ESM output, path aliases.

#### Step 2: WhatsApp Webhook (src/routes/whatsapp.ts)

```typescript
// This is the entry point for ALL user messages.
// Twilio sends a POST to this endpoint whenever a user messages your WhatsApp number.
//
// Key behaviors:
// 1. Validate the Twilio signature (security)
// 2. Dedup messages using whatsapp_message_id
// 3. Find or create user by phone number
// 4. Find or create active conversation
// 5. Pass to conversation engine
// 6. Return 200 immediately (process async via queue)
//
// IMPORTANT: Twilio expects a response within 15 seconds.
// Heavy processing (LLM calls, planning) MUST be queued.
// Send a "typing indicator" or "thinking..." message while processing.

import { FastifyInstance } from 'fastify';
import { handleIncomingMessage } from '../services/whatsapp/handler';

export async function whatsappRoutes(app: FastifyInstance) {
  app.post('/webhook/whatsapp', async (request, reply) => {
    // Twilio sends form-urlencoded data
    const { Body, From, MessageSid, NumMedia, MediaUrl0 } = request.body as any;

    // Respond to Twilio immediately
    reply.status(200).send('<Response></Response>');

    // Process async
    await handleIncomingMessage({
      body: Body,
      from: From,           // e.g., "whatsapp:+919876543210"
      messageSid: MessageSid,
      numMedia: parseInt(NumMedia || '0'),
      mediaUrl: MediaUrl0,
    });
  });
}
```

#### Step 3: Conversation Engine (src/services/conversation/engine.ts)

```typescript
// This is the BRAIN of the application.
// It receives a user message and decides what to do.
//
// Flow:
// 1. Load user profile + preferences from memory
// 2. Load conversation history (last N messages)
// 3. Load active trip context (if any)
// 4. Classify intent
// 5. Route to appropriate handler:
//    - NEW_TRIP → clarifier (ask questions) → planner
//    - MODIFY_PLAN → planner with existing plan
//    - BOOK → booking orchestrator
//    - QUESTION → answer from context/search
//    - FEEDBACK → memory extractor
//    - GENERAL → conversational response
// 6. Send response via WhatsApp
// 7. Queue memory extraction from this exchange
//
// The system prompt should include:
// - User preferences (from memory)
// - Current trip context (if any)
// - Today's date and user's timezone
// - Available actions the agent can take

export async function processMessage(
  userId: string,
  conversationId: string,
  userMessage: string
): Promise<void> {

  // 1. Build context
  const userProfile = await recallUserProfile(userId);
  const history = await getConversationHistory(conversationId, { limit: 20 });
  const activeTrip = await getActiveTrip(userId);

  // 2. Call Claude with tools
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: buildSystemPrompt(userProfile, activeTrip),
    messages: history,
    tools: getTravelAgentTools(), // defined in src/ai/tools.ts
  });

  // 3. Handle tool calls (search, plan, book, etc.)
  // 4. Send response via WhatsApp
  // 5. Queue memory extraction
}
```

#### Step 4: AI System Prompt (src/ai/prompts/system.ts)

```typescript
// Build the system prompt dynamically per conversation.
// This is the most important prompt in the entire application.

export function buildSystemPrompt(
  userProfile: UserProfile | null,
  activeTrip: Trip | null
): string {
  return `You are a world-class travel agent on WhatsApp. You help people plan
and book incredible trips. You are warm, knowledgeable, and efficient.

## Your personality
- You speak like a well-traveled friend, not a corporate bot
- You're opinionated — you make specific recommendations, not generic lists
- You ask smart clarifying questions (max 2-3 at a time, not 10)
- You use WhatsApp-appropriate formatting: short paragraphs, occasional emoji, no markdown headers
- You proactively suggest things the user hasn't thought of (local events, hidden gems, logistics)

## Current date: ${new Date().toISOString().split('T')[0]}

${userProfile ? `## What you know about this traveler
${formatUserProfile(userProfile)}` : `## New traveler
You don't know this person yet. In the first interaction, naturally learn:
- What kind of trips they enjoy
- Budget comfort zone (ask indirectly: "are you thinking boutique hotel or something more casual?")
- Dietary restrictions or preferences
- Travel companion situation
- Any loyalty programs they use
Do NOT ask all of these at once. Weave them into the conversation naturally.`}

${activeTrip ? `## Active trip being planned
${JSON.stringify(activeTrip.plan, null, 2)}` : ''}

## How you handle booking
When the user is ready to book:
1. Confirm the exact details (property, dates, room type, price)
2. Explain you'll open a browser session where they can log into their own account
3. They'll watch the booking happen live and approve the final step
4. Their loyalty points and status are fully preserved

## Important rules
- NEVER make up prices. If you don't have a live price, say "I'll check current rates"
- NEVER hallucinate hotel names or restaurant names. Use search tools to verify
- Keep messages under 300 words. WhatsApp is for short exchanges
- If a plan has multiple days, send one day at a time, ask if they want to continue
- Always mention what loyalty program applies when recommending a hotel/airline
- When you learn something new about the user's preferences, acknowledge it naturally
  ("Good to know you prefer window seats — I'll keep that in mind!")
`;
}
```

#### Step 5: Claude Tool Definitions (src/ai/tools.ts)

```typescript
// These are the tools Claude can call during conversation.
// Each tool maps to a service function.

export function getTravelAgentTools() {
  return [
    {
      name: 'search_hotels',
      description: 'Search for hotels in a destination for given dates. Returns availability and prices.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string', description: 'City or area name' },
          check_in: { type: 'string', description: 'YYYY-MM-DD' },
          check_out: { type: 'string', description: 'YYYY-MM-DD' },
          guests: { type: 'number' },
          budget_per_night: { type: 'number', description: 'Max price per night in USD' },
          style: { type: 'string', enum: ['luxury', 'boutique', 'mid-range', 'budget', 'hostel'] },
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
          origin: { type: 'string', description: 'Airport code or city name' },
          destination: { type: 'string', description: 'Airport code or city name' },
          departure_date: { type: 'string' },
          return_date: { type: 'string' },
          passengers: { type: 'number' },
          cabin_class: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] },
          preferred_airlines: { type: 'array', items: { type: 'string' } },
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
          price_level: { type: 'string', enum: ['budget', 'moderate', 'fine_dining'] },
          dietary: { type: 'array', items: { type: 'string' } },
          meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'brunch'] },
        },
        required: ['location'],
      },
    },
    {
      name: 'search_experiences',
      description: 'Find tours, activities, and experiences at a destination.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string' },
          date: { type: 'string' },
          category: { type: 'string', enum: ['culture', 'adventure', 'food', 'nature', 'nightlife', 'wellness', 'family'] },
          duration_hours: { type: 'number' },
          budget: { type: 'number' },
        },
        required: ['destination'],
      },
    },
    {
      name: 'search_transport',
      description: 'Find transport options between two points (local transit, taxi, train, etc).',
      input_schema: {
        type: 'object' as const,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          date: { type: 'string' },
          preference: { type: 'string', enum: ['fastest', 'cheapest', 'scenic', 'most_comfortable'] },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for current information about a destination, event, restaurant, or travel topic.',
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
      description: 'Generate a structured day-by-day trip itinerary. Call this after gathering enough info about the trip.',
      input_schema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          travelers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } } } },
          budget_total: { type: 'number' },
          interests: { type: 'array', items: { type: 'string' } },
          pace: { type: 'string', enum: ['packed', 'balanced', 'relaxed'] },
          must_dos: { type: 'array', items: { type: 'string' } },
          avoid: { type: 'array', items: { type: 'string' } },
        },
        required: ['destination', 'start_date', 'end_date'],
      },
    },
    {
      name: 'initiate_booking',
      description: 'Start the browser-based booking process. This opens a live session the user can watch.',
      input_schema: {
        type: 'object' as const,
        properties: {
          booking_type: { type: 'string', enum: ['hotel', 'flight', 'restaurant', 'experience'] },
          provider: { type: 'string', description: 'Website to book on, e.g. marriott.com' },
          details: { type: 'object', description: 'Booking-specific details (property, dates, room type, etc.)' },
        },
        required: ['booking_type', 'provider', 'details'],
      },
    },
    {
      name: 'save_preference',
      description: 'Save something you learned about the user for future trips. Call this whenever the user reveals a preference.',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: { type: 'string', enum: ['accommodation', 'food', 'transport', 'budget', 'travel_style', 'loyalty', 'dietary', 'companion'] },
          key: { type: 'string', description: 'e.g., "hotel_style", "airline_preference", "spice_tolerance"' },
          value: { type: 'string', description: 'The preference value' },
          confidence: { type: 'number', description: '0-1, how confident you are about this preference' },
        },
        required: ['category', 'key', 'value'],
      },
    },
  ];
}
```

#### Step 6: WhatsApp Message Sender (src/services/whatsapp/sender.ts)

```typescript
// Handles all outgoing WhatsApp messages.
// IMPORTANT: WhatsApp has specific formatting rules:
// - Max 1024 chars for interactive list body
// - Max 3 reply buttons per message
// - Max 10 rows in a list message
// - Bold: *text*, Italic: _text_, Monospace: ```text```
//
// Strategy for long responses:
// - Trip plans: Send day-by-day as separate messages with reply buttons ("Next day" / "Modify" / "Book this")
// - Hotel options: Send as interactive list (max 10 options)
// - Booking confirmation: Send with reply buttons ("Approve" / "Change" / "Cancel")

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendText(to: string, body: string): Promise<void> {
  await client.messages.create({
    body,
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to,
  });
}

export async function sendInteractiveButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>  // max 3
): Promise<void> {
  // Twilio ContentSid template for button messages
  // Or use the Twilio Content API to create templates dynamically
  // See: https://www.twilio.com/docs/content/create-templates
}

export async function sendListMessage(
  to: string,
  body: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>
): Promise<void> {
  // Twilio interactive list message
}

export async function sendMedia(
  to: string,
  mediaUrl: string,
  caption: string
): Promise<void> {
  await client.messages.create({
    body: caption,
    mediaUrl: [mediaUrl],
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to,
  });
}

// Send a "thinking" indicator while processing
export async function sendTypingIndicator(to: string): Promise<void> {
  await sendText(to, '✈️ Let me look into that...');
}
```

---

### PHASE 2: Memory System (Week 2-3)

#### Step 7: Preference Extractor (src/services/memory/extractor.ts)

```typescript
// This runs AFTER every conversation exchange (queued, not blocking).
// It reads the latest messages and extracts any new preferences.
//
// Two extraction methods:
// 1. Structured extraction: Claude extracts key-value preferences
// 2. Semantic memory: Store natural language snippets as embeddings
//
// Examples of what to extract:
// - "I hate early flights" → { category: 'transport', key: 'flight_time_preference', value: 'afternoon_or_later' }
// - "We're vegetarian" → { category: 'dietary', key: 'diet', value: 'vegetarian' }
// - "Usually spend about $200/night" → { category: 'budget', key: 'hotel_nightly_rate', value: { amount: 200, currency: 'USD' } }
// - "I have Marriott Bonvoy Platinum" → { category: 'loyalty', key: 'marriott_bonvoy', value: 'platinum' }
// - "Last time in Tokyo we loved the ramen in Shinjuku" → semantic memory, not structured

export async function extractPreferences(
  userId: string,
  messages: Message[]
): Promise<void> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are a preference extraction system. Analyze the conversation
and extract any travel preferences, constraints, or facts about the user.

Return JSON only. Format:
{
  "structured_preferences": [
    {
      "category": "accommodation|food|transport|budget|travel_style|loyalty|dietary|companion",
      "key": "descriptive_key",
      "value": "the preference",
      "confidence": 0.0-1.0,
      "source": "explicit|inferred"
    }
  ],
  "semantic_memories": [
    "Natural language snippet worth remembering for future trips"
  ],
  "no_new_preferences": false
}

Only extract NEW information not already in the user's profile.
Be conservative — only extract what's clearly stated or strongly implied.`,
    messages: [
      {
        role: 'user',
        content: `Current user profile: ${JSON.stringify(await getUserProfile(userId))}

Recent conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Extract any new preferences or memories.`,
      },
    ],
  });

  // Parse and store extracted preferences
  // Upsert into user_preferences (increase confidence if already exists)
  // Embed and store semantic memories
}
```

#### Step 8: Memory Recall (src/services/memory/recall.ts)

```typescript
// When building context for a conversation, recall relevant memories.
// Uses both structured lookup and semantic similarity search.
//
// For a query like "plan a trip to Bali":
// 1. Structured: pull all preferences (budget, style, dietary, loyalty, companions)
// 2. Semantic: search embeddings for anything related to "Bali", "beach", "Indonesia", "tropical"
//    This might surface: "Loved the villa with private pool in Seminyak last year"

export async function recallUserProfile(userId: string): Promise<UserProfile> {
  // Get all structured preferences
  const preferences = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  return {
    preferences: groupByCategory(preferences),
    lastTrips: await getRecentTrips(userId, 3),
  };
}

export async function recallRelevantMemories(
  userId: string,
  query: string,
  limit: number = 5
): Promise<string[]> {
  // 1. Embed the query
  const queryEmbedding = await embedText(query);

  // 2. Similarity search against user's memories
  const memories = await db.execute(sql`
    SELECT content, 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
    FROM user_memory_embeddings
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${limit}
  `);

  return memories
    .filter(m => m.similarity > 0.3)  // threshold
    .map(m => m.content);
}
```

---

### PHASE 3: Trip Planning (Week 3-4)

#### Step 9: Planner (src/services/planning/planner.ts)

```typescript
// The planner generates a structured trip itinerary.
// It uses Claude with tools to research and build the plan.
//
// Planning flow:
// 1. User provides: destination, dates, rough idea of what they want
// 2. System enriches with: user preferences, weather, local events, budget constraints
// 3. Claude generates day-by-day plan using search tools
// 4. Plan is verified: all venues exist, prices are reasonable, logistics work
// 5. Plan is structured into the Trip schema and saved
//
// A day in the plan looks like:
// {
//   date: "2026-04-15",
//   theme: "Old Town & Street Food",
//   items: [
//     { time: "09:00", type: "experience", name: "Walking tour of Old Quarter", duration_min: 120, price: { amount: 25, currency: "USD" }, booking_url: "..." },
//     { time: "12:00", type: "restaurant", name: "Bun Cha Huong Lien", cuisine: "Vietnamese", price_level: "budget", rating: 4.5, maps_url: "..." },
//     { time: "14:00", type: "experience", name: "Water Puppet Theatre", duration_min: 60, price: { amount: 8, currency: "USD" } },
//     { time: "16:00", type: "transport", mode: "grab_taxi", from: "Theatre", to: "Hotel", est_cost: { amount: 3, currency: "USD" } },
//     { time: "19:00", type: "restaurant", name: "Cha Ca La Vong", cuisine: "Vietnamese", price_level: "moderate", rating: 4.3 },
//   ],
//   accommodation: { name: "Hotel de l'Opera Hanoi", check_in: true, loyalty_program: "Marriott Bonvoy" }
// }

export async function generateTripPlan(input: PlanInput): Promise<Trip> {
  // Implementation: multi-turn Claude conversation with tool use
  // Claude calls search_hotels, search_restaurants, search_experiences, etc.
  // Then structures everything into the day-by-day format
  // Verify all venues with web_search
  // Calculate total budget
}
```

#### Step 10: WhatsApp Plan Delivery (in conversation engine)

```typescript
// Plans are delivered incrementally, not all at once.
// Send one day at a time with interactive buttons.
//
// Message format for a day:
// "📍 *Day 1: April 15 — Old Town & Street Food*
//
// 🌅 9:00 AM — Walking tour of the Old Quarter (2 hrs, ~$25)
// 🍜 12:00 PM — Lunch at Bún Chả Hương Liên — legendary Obama spot
// 🎭 2:00 PM — Water Puppet Theatre ($8)
// 🚕 4:00 PM — Grab back to hotel (~$3)
// 🍽️ 7:00 PM — Dinner at Chả Cá Lã Vọng — must-try fish dish
//
// 🏨 Staying at: Hotel de l'Opera Hanoi (Marriott Bonvoy ✨)
//
// Day total: ~$120 per person"
//
// Buttons: ["👍 Love it" | "✏️ Modify" | "➡️ Next day"]

export function formatDayPlan(day: DayPlan, dayNumber: number, totalDays: number): string {
  // Format as WhatsApp-friendly text (under 1024 chars)
  // Use emoji sparingly but meaningfully
  // Highlight loyalty program applicability
  // Show running budget
}
```

---

### PHASE 4: Browser Booking (Week 4-6)

#### Step 11: Booking Orchestrator (src/services/booking/orchestrator.ts)

```typescript
// This is the most complex service. It manages the full booking lifecycle:
//
// 1. User confirms they want to book
// 2. We create a Browserbase session
// 3. We generate a Live View link and send it via WhatsApp
// 4. User opens the link on their phone (sees the browser)
// 5. Agent navigates to the booking site
// 6. Agent gets to the login page → PAUSES
// 7. User logs in themselves (via Live View)
// 8. Agent detects login success, continues to fill booking details
// 9. Agent reaches final confirmation page → PAUSES
// 10. User reviews and clicks "Confirm Booking" themselves
// 11. Agent captures confirmation number
// 12. Session is destroyed
// 13. Confirmation sent via WhatsApp
//
// CRITICAL: The agent NEVER clicks the final "Confirm" or "Pay" button.
// The user ALWAYS does this step themselves.

import Browserbase from '@browserbasehq/sdk';
import { Stagehand } from '@browserbasehq/stagehand';

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

export async function startBookingSession(
  userId: string,
  booking: BookingDetails
): Promise<{ sessionId: string; liveViewUrl: string }> {

  // 1. Create Browserbase session with stealth mode
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserSettings: {
      // Stealth mode: fingerprint randomization, proxy rotation
      fingerprint: {
        browsers: ['chrome'],
        operatingSystems: ['macos'],
      },
      // Enable CAPTCHA solving
      solveCaptchas: true,
    },
    // Keep session alive for up to 10 minutes
    keepAlive: true,
    timeout: 600000,
  });

  // 2. Get Live View URL (user watches on their phone)
  const liveViewUrl = `https://www.browserbase.com/sessions/${session.id}/live`;
  // OR use the embeddable iframe:
  // const liveViewUrl = `${process.env.APP_URL}/booking/live/${session.id}`;

  // 3. Send Live View link to user via WhatsApp
  await sendText(
    userPhone,
    `🔗 Your booking session is ready!\n\nTap the link below to watch and control the booking:\n${liveViewUrl}\n\nI'll navigate to ${booking.provider} — you'll need to log in with your account to keep your loyalty points.`
  );

  // 4. Start the automation in background
  await bookingQueue.add('execute-booking', {
    sessionId: session.id,
    userId,
    booking,
  });

  return { sessionId: session.id, liveViewUrl };
}
```

#### Step 12: Provider-Specific Booking Flows (src/services/booking/providers/marriott.ts)

```typescript
// Each provider has a specific Stagehand flow.
// Use act() for interactions, extract() for data, observe() for state detection.
//
// The flow uses HYBRID approach:
// - Deterministic Playwright code for known, stable elements
// - Stagehand AI for dynamic elements, pop-ups, layout changes
//
// Stagehand caches successful action sequences.
// After first successful booking, subsequent runs are faster (no LLM calls for cached steps).

import { Stagehand } from '@browserbasehq/stagehand';

export class MarriottBookingProvider extends BaseBookingProvider {
  async execute(stagehand: Stagehand, details: HotelBookingDetails): Promise<BookingResult> {

    const page = stagehand.page;

    // === DETERMINISTIC SECTION (Playwright) ===
    // Navigate to Marriott
    await page.goto('https://www.marriott.com');

    // Close cookie banner if present (AI handles variable banners)
    await stagehand.act({ action: 'close any cookie consent or popup banners' });

    // Fill search form (deterministic — Marriott's search form is stable)
    await page.fill('[data-testid="destination-input"]', details.destination);
    await page.waitForTimeout(1000);
    // Select from autocomplete
    await stagehand.act({
      action: `select "${details.destination}" from the autocomplete dropdown`
    });

    // Set dates
    await stagehand.act({
      action: `set check-in date to ${details.checkIn} and check-out date to ${details.checkOut}`
    });

    // Set guests
    await stagehand.act({
      action: `set the number of guests to ${details.guests} adults`
    });

    // Search
    await stagehand.act({ action: 'click the search or find hotels button' });
    await page.waitForLoadState('networkidle');

    // === FIND THE RIGHT PROPERTY ===
    if (details.propertyName) {
      // If user specified a property, find it in results
      await stagehand.act({
        action: `find and click on "${details.propertyName}" in the search results`
      });
    }

    // === SELECT ROOM TYPE ===
    await stagehand.act({
      action: `select a ${details.roomType || 'standard'} room and click to book it`
    });

    // === LOGIN GATE ===
    // PAUSE HERE — user needs to log in
    // Check if we're on a login page
    const needsLogin = await stagehand.observe({
      instruction: 'Is there a sign-in or login form visible on the page?'
    });

    if (needsLogin) {
      // Notify user via WhatsApp
      await sendText(
        details.userPhone,
        '🔐 Please log into your Marriott Bonvoy account in the browser window. I\'ll continue once you\'re logged in!'
      );

      // Wait for login to complete (poll for logged-in state)
      await this.waitForLogin(stagehand, {
        indicator: 'look for a user name, account icon, or "My Account" link that indicates the user is logged in',
        timeout: 120000, // 2 minutes
        pollInterval: 3000,
      });

      await sendText(details.userPhone, '✅ Logged in! Continuing with the booking...');
    }

    // === FILL BOOKING DETAILS ===
    // Fill any remaining details (special requests, etc.)
    if (details.specialRequests) {
      await stagehand.act({
        action: `add special request: "${details.specialRequests}"`
      });
    }

    // === FINAL CONFIRMATION GATE ===
    // Navigate to the final review/confirmation page
    await stagehand.act({ action: 'proceed to the final booking review or confirmation page' });

    // Extract the booking summary for user verification
    const summary = await stagehand.extract({
      instruction: 'Extract the booking summary including: hotel name, dates, room type, total price, loyalty points earned, cancellation policy',
      schema: z.object({
        hotelName: z.string(),
        checkIn: z.string(),
        checkOut: z.string(),
        roomType: z.string(),
        totalPrice: z.string(),
        loyaltyPoints: z.string().optional(),
        cancellationPolicy: z.string().optional(),
      }),
    });

    // Send summary to user via WhatsApp
    await sendText(
      details.userPhone,
      `📋 *Booking Summary*\n\n🏨 ${summary.hotelName}\n📅 ${summary.checkIn} → ${summary.checkOut}\n🛏️ ${summary.roomType}\n💰 ${summary.totalPrice}\n${summary.loyaltyPoints ? `✨ Points earned: ${summary.loyaltyPoints}` : ''}\n${summary.cancellationPolicy ? `📝 ${summary.cancellationPolicy}` : ''}\n\n👆 *Please review and tap "Confirm Booking" in the browser window when ready!*`
    );

    // PAUSE — wait for user to click confirm
    // Monitor for confirmation success page
    const confirmed = await this.waitForConfirmation(stagehand, {
      indicator: 'look for a booking confirmation number, "thank you" message, or confirmation page',
      timeout: 180000, // 3 minutes
    });

    if (confirmed) {
      // Extract confirmation number
      const confirmation = await stagehand.extract({
        instruction: 'Extract the booking confirmation number or reference code',
        schema: z.object({
          confirmationNumber: z.string(),
        }),
      });

      return {
        status: 'confirmed',
        confirmationNumber: confirmation.confirmationNumber,
        summary,
      };
    }

    return { status: 'timeout', summary };
  }
}
```

#### Step 13: Base Booking Provider (src/services/booking/providers/base.ts)

```typescript
// Abstract base class for all booking providers.
// Handles common patterns: login detection, confirmation waiting, error recovery.

export abstract class BaseBookingProvider {
  abstract execute(stagehand: Stagehand, details: any): Promise<BookingResult>;

  protected async waitForLogin(
    stagehand: Stagehand,
    options: { indicator: string; timeout: number; pollInterval: number }
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < options.timeout) {
      const result = await stagehand.observe({ instruction: options.indicator });
      if (result && result.length > 0) return true;
      await new Promise(r => setTimeout(r, options.pollInterval));
    }
    return false;
  }

  protected async waitForConfirmation(
    stagehand: Stagehand,
    options: { indicator: string; timeout: number }
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < options.timeout) {
      const result = await stagehand.observe({ instruction: options.indicator });
      if (result && result.length > 0) return true;
      await new Promise(r => setTimeout(r, 5000));
    }
    return false;
  }

  protected async handleCaptcha(stagehand: Stagehand): Promise<void> {
    // Browserbase handles most CAPTCHAs automatically.
    // If one slips through, notify the user to solve it in Live View.
    const hasCaptcha = await stagehand.observe({
      instruction: 'Is there a CAPTCHA, "verify you are human", or similar challenge visible?'
    });
    if (hasCaptcha) {
      // User solves it via Live View — just wait
      await this.waitForLogin(stagehand, {
        indicator: 'Is the CAPTCHA challenge gone or solved?',
        timeout: 60000,
        pollInterval: 3000,
      });
    }
  }
}
```

---

### PHASE 5: Search Integrations (Week 4-5, parallel with Phase 4)

#### Step 14: Hotel Search (src/services/search/hotels.ts)

```typescript
// Multi-source hotel search. Combines:
// 1. Google Places API — for hotel data, ratings, photos
// 2. Stagehand scraping — for live prices from booking sites
// 3. Cached results — to avoid redundant scraping
//
// For MVP, start with Google Places + deep links.
// Add price scraping in Phase 2.

export async function searchHotels(params: HotelSearchParams): Promise<HotelResult[]> {
  // 1. Google Places text search
  const places = await googlePlaces.textSearch({
    query: `hotels in ${params.destination}`,
    type: 'lodging',
    minPrice: params.budget_per_night ? mapBudgetToGooglePrice(params.budget_per_night) : undefined,
  });

  // 2. Enrich with details
  const hotels = await Promise.all(
    places.slice(0, 10).map(async (place) => {
      const details = await googlePlaces.placeDetails(place.place_id);
      return {
        name: details.name,
        address: details.formatted_address,
        rating: details.rating,
        reviewCount: details.user_ratings_total,
        priceLevel: details.price_level,
        photos: details.photos?.slice(0, 3).map(p => getPhotoUrl(p.photo_reference)),
        website: details.website,
        mapsUrl: details.url,
        // Generate deep links
        bookingComUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(details.name + ' ' + params.destination)}&checkin=${params.check_in}&checkout=${params.check_out}`,
        marriottUrl: details.name.toLowerCase().includes('marriott') || details.name.toLowerCase().includes('sheraton') || details.name.toLowerCase().includes('westin')
          ? `https://www.marriott.com/search/default.mi?destinationAddress=${encodeURIComponent(params.destination)}&arrivalDate=${params.check_in}&departureDate=${params.check_out}`
          : null,
      };
    })
  );

  return hotels;
}
```

#### Step 15: Flight Search (src/services/search/flights.ts)

```typescript
// Amadeus Self-Service API for flight search.
// Free tier: 500 requests/month, test environment.
// Production: Apply for production access.
//
// Returns search results only — booking happens via browser automation
// or deep links to the airline's website.

import Amadeus from 'amadeus';

const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_CLIENT_ID,
  clientSecret: process.env.AMADEUS_CLIENT_SECRET,
});

export async function searchFlights(params: FlightSearchParams): Promise<FlightResult[]> {
  const response = await amadeus.shopping.flightOffersSearch.get({
    originLocationCode: params.origin,
    destinationLocationCode: params.destination,
    departureDate: params.departure_date,
    returnDate: params.return_date,
    adults: params.passengers || 1,
    travelClass: mapCabinClass(params.cabin_class),
    max: 10,
    currencyCode: 'USD',
  });

  return response.data.map(formatFlightOffer);
}
```

---

### PHASE 6: Deep Links + Fallback (Week 5-6)

#### Step 16: Deep Link Generator (src/utils/deeplink.ts)

```typescript
// For cases where browser automation isn't needed or fails,
// generate pre-filled deep links that open the booking site
// with all details pre-populated.
//
// This is also the Phase 1 MVP approach — always have deep links ready
// even when browser automation is the primary path.

export function generateDeepLinks(booking: BookingDetails): DeepLinks {
  switch (booking.type) {
    case 'hotel':
      return {
        bookingCom: buildBookingComLink(booking),
        agoda: buildAgodaLink(booking),
        direct: booking.directUrl || null,
      };
    case 'flight':
      return {
        skyscanner: buildSkyscannerLink(booking),
        googleFlights: buildGoogleFlightsLink(booking),
        direct: booking.airlineUrl || null,
      };
    case 'restaurant':
      return {
        opentable: buildOpenTableLink(booking),
        googleMaps: booking.mapsUrl,
      };
    case 'experience':
      return {
        getYourGuide: buildGYGLink(booking),
        viator: buildViatorLink(booking),
      };
  }
}

function buildBookingComLink(b: HotelBookingDetails): string {
  const params = new URLSearchParams({
    ss: b.propertyName || b.destination,
    checkin: b.checkIn,
    checkout: b.checkOut,
    group_adults: String(b.guests || 2),
    no_rooms: '1',
  });
  return `https://www.booking.com/searchresults.html?${params}`;
}

function buildSkyscannerLink(b: FlightBookingDetails): string {
  // Skyscanner deep link format:
  // /transport/flights/{origin}/{dest}/{outDate}/{inDate}/
  return `https://www.skyscanner.com/transport/flights/${b.origin}/${b.destination}/${formatSkyscannerDate(b.departureDate)}/${b.returnDate ? formatSkyscannerDate(b.returnDate) : ''}`;
}

function buildGoogleFlightsLink(b: FlightBookingDetails): string {
  return `https://www.google.com/travel/flights?q=flights+from+${b.origin}+to+${b.destination}+on+${b.departureDate}`;
}
```

---

### PHASE 7: Background Jobs (Week 5-6)

#### Step 17: Job Queue Setup (src/jobs/queue.ts)

```typescript
// BullMQ queues for async processing.
// Why queue? WhatsApp requires fast webhook responses.
// All heavy work happens async with status updates sent via WhatsApp.

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export const conversationQueue = new Queue('conversation', { connection: redis });
export const planningQueue = new Queue('planning', { connection: redis });
export const bookingQueue = new Queue('booking', { connection: redis });
export const memoryQueue = new Queue('memory', { connection: redis });
export const priceCheckQueue = new Queue('price-check', { connection: redis });

// Worker for conversation processing
new Worker('conversation', async (job) => {
  const { userId, conversationId, message } = job.data;
  await processMessage(userId, conversationId, message);
}, { connection: redis, concurrency: 10 });

// Worker for plan generation (heavy, limit concurrency)
new Worker('planning', async (job) => {
  const { userId, tripId, input } = job.data;
  const plan = await generateTripPlan(input);
  await saveTripPlan(tripId, plan);
  await deliverPlanViaWhatsApp(userId, plan);
}, { connection: redis, concurrency: 3 });

// Worker for browser bookings (resource-heavy, limit concurrency)
new Worker('booking', async (job) => {
  const { sessionId, userId, booking } = job.data;
  await executeBookingSession(sessionId, userId, booking);
}, { connection: redis, concurrency: 2 });

// Worker for memory extraction (lightweight, high concurrency)
new Worker('memory', async (job) => {
  const { userId, messages } = job.data;
  await extractPreferences(userId, messages);
}, { connection: redis, concurrency: 10 });
```

---

## ENVIRONMENT VARIABLES (.env.example)

```env
# Server
PORT=3000
APP_URL=https://your-app.railway.app

# Database
DATABASE_URL=postgresql://user:pass@host:5432/travel_agent

# Redis
REDIS_URL=redis://default:pass@host:6379

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886

# Browserbase
BROWSERBASE_API_KEY=bb_...
BROWSERBASE_PROJECT_ID=proj_...

# Search APIs
GOOGLE_MAPS_API_KEY=AIza...
AMADEUS_CLIENT_ID=...
AMADEUS_CLIENT_SECRET=...
BRAVE_SEARCH_API_KEY=BSA...

# CAPTCHA fallback
TWO_CAPTCHA_API_KEY=...

# Embeddings
VOYAGE_API_KEY=pa-... # or OPENAI_API_KEY

# File Storage
CLOUDFLARE_R2_ACCESS_KEY=...
CLOUDFLARE_R2_SECRET_KEY=...
CLOUDFLARE_R2_BUCKET=travel-agent
CLOUDFLARE_R2_ENDPOINT=https://...r2.cloudflarestorage.com
```

---

## WHATSAPP COMPLIANCE CHECKLIST

Meta's 2026 policy allows business-specific AI chatbots. To stay compliant:

1. ✅ Bot serves a specific business function (travel booking)
2. ✅ AI is incidental to the service, not the primary product
3. ✅ All messages relate to travel planning/booking
4. ✅ Use approved WhatsApp message templates for outbound messages
5. ✅ Collect explicit opt-in before first message
6. ✅ Provide opt-out mechanism ("type STOP to unsubscribe")
7. ✅ Use an approved BSP (Twilio, WATI, Gupshup)
8. ✅ Don't use the bot for general-purpose AI chat
9. ✅ Register as a WhatsApp Business API user with business verification

---

## IMPLEMENTATION ORDER (for Cursor)

Work through these in sequence. Each step should be a working, testable unit.

1. **Fastify server + health route** — just get it running
2. **Database setup** — run migrations, verify schema
3. **Twilio webhook** — receive a WhatsApp message, log it, echo it back
4. **User management** — create/find user from phone number
5. **Conversation management** — create/find active conversation, store messages
6. **Claude integration** — basic conversation (no tools yet), respond via WhatsApp
7. **System prompt** — implement the dynamic system prompt builder
8. **Tool definitions** — register all tools, implement web_search first
9. **Memory extractor** — run after each exchange, store to user_preferences
10. **Memory recall** — inject user preferences into system prompt
11. **Hotel search** — Google Places integration
12. **Flight search** — Amadeus API integration
13. **Restaurant search** — Google Places with cuisine filtering
14. **Trip planner** — multi-tool Claude conversation that builds itineraries
15. **WhatsApp plan delivery** — day-by-day with interactive buttons
16. **Deep link generator** — for all booking types
17. **Browserbase session** — create session, get Live View URL
18. **Stagehand integration** — basic navigation test
19. **Marriott booking flow** — first full provider implementation
20. **Login gate** — pause for user login, detect completion
21. **Confirmation gate** — pause for user approval, capture confirmation
22. **Booking.com flow** — second provider
23. **WhatsApp booking UX** — live status updates during booking
24. **BullMQ queues** — move all heavy processing to background workers
25. **Error handling** — retry logic, user-friendly error messages
26. **Itinerary PDF** — generate shareable PDF of the trip plan
27. **Post-trip feedback** — scheduled job to ask how the trip went
28. **Price monitoring** — alert user if a booked item drops in price

---

## KEY DESIGN DECISIONS

### Why Fastify over Express?
Faster, built-in TypeScript support, schema validation, better plugin system.

### Why Drizzle over Prisma?
Lighter weight, SQL-first, better for complex queries (pgvector), faster cold starts.

### Why BullMQ over simple async?
Reliability. If the server crashes mid-booking, the job survives in Redis and retries.
Rate limiting. Control concurrency of expensive browser sessions.
Visibility. Built-in dashboard (Bull Board) to monitor job status.

### Why PostgreSQL for everything (relational + vectors)?
Simplicity. One database to manage, backup, and scale.
pgvector is good enough for <100K embeddings per user.
JSONB handles flexible schemas (trip plans, booking details).

### Why not store credentials?
Legal risk (CFAA, Computer Misuse Act, IT Act Section 43).
Security risk (single breach exposes all users' accounts).
Trust risk (users won't give passwords to a startup).
The Live View approach preserves all the value (loyalty, points)
while keeping credentials ephemeral and user-controlled.

### Why Stagehand over raw Playwright or Browser Use?
Hybrid approach: deterministic code for stable elements, AI for dynamic ones.
Caching: after first success, subsequent runs skip LLM calls.
TypeScript-native: matches the rest of the stack.
Browserbase integration: first-party SDK, best support.