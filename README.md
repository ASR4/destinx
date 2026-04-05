# Destinx — AI Travel Agent

An AI-powered travel agent that operates entirely through WhatsApp. It plans end-to-end trips, searches flights/hotels/restaurants/experiences, books via API or browser automation (preserving user loyalty accounts), remembers preferences across conversations, and handles payments through Stripe.

Built with Claude (Anthropic), Fastify, PostgreSQL + pgvector, BullMQ, Twilio, Browserbase + Stagehand, and Duffel.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Deployment](#deployment)
- [API Endpoints](#api-endpoints)
- [How It Works](#how-it-works)
- [External Services](#external-services)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **WhatsApp-native** — Users interact entirely through WhatsApp with interactive buttons and list messages
- **AI trip planning** — Claude generates multi-day itineraries grounded in real-world research (Google Places, Brave Search, weather data)
- **Flight search & booking** — Duffel API integration for searching and booking flights across 300+ airlines
- **Browser automation** — Books hotels, restaurants, and experiences on real websites (Booking.com, Airbnb, OpenTable, Viator) using the user's own accounts, preserving loyalty points
- **Payment processing** — Stripe Checkout for flight payments with per-booking service fees
- **Semantic memory** — Remembers user preferences across conversations using pgvector embeddings (dietary restrictions, airline preferences, budget, travel style)
- **Intent classification** — Layered system: fast regex for trivial intents, Haiku for complex classification, Redis-cached results
- **Itinerary modification** — Natural language plan edits ("swap day 3 dinner for sushi")
- **PDF itineraries** — Generates formatted PDFs with booking references and QR codes
- **Event discovery** — Ticketmaster integration for finding concerts, festivals, and events during travel dates
- **Price monitoring** — Scheduled price-drop detection with proactive WhatsApp notifications
- **Live booking view** — Real-time browser session embedding so users can watch and intervene during automated bookings

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   WhatsApp   │────▶│   Fastify    │────▶│     BullMQ       │
│   (Twilio)   │◀────│   Server     │     │   Job Queues     │
└──────────────┘     └──────────────┘     └──────────────────┘
                            │                      │
                     ┌──────┴──────┐        ┌──────┴──────┐
                     │  PostgreSQL │        │    Redis     │
                     │  + pgvector │        │  (cache +   │
                     │  (Drizzle)  │        │   queues)   │
                     └─────────────┘        └─────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────────┐
        │  Claude  │ │  Duffel  │ │ Browserbase  │
        │ (AI/LLM) │ │ (Flights)│ │ (Automation) │
        └──────────┘ └──────────┘ └──────────────┘
```

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ / TypeScript |
| HTTP Server | Fastify 5 |
| Database | PostgreSQL 16 + pgvector (via Drizzle ORM) |
| Queue / Cache | Redis + BullMQ + ioredis |
| AI | Anthropic Claude (Sonnet for conversation, Haiku for classification) |
| Embeddings | Voyage AI (`voyage-large-2`, 1536-d vectors) |
| WhatsApp | Twilio Business API + Content API (interactive messages) |
| Browser Automation | Browserbase (cloud browsers) + Stagehand (AI agent framework) |
| Flights | Duffel API |
| Payments | Stripe Checkout Sessions |
| Object Storage | Cloudflare R2 (S3-compatible) |
| Search | Google Maps Platform, Brave Search |
| Events | Ticketmaster Discovery API |

---

## Project Structure

```
src/
├── ai/                          # LLM layer
│   ├── client.ts                # Anthropic SDK singleton
│   ├── tools.ts                 # Tool definitions exposed to Claude
│   └── prompts/                 # System, planning, booking, extraction prompts
│
├── config/
│   ├── env.ts                   # Zod-validated environment variables
│   └── constants.ts             # Limits, model IDs, FSM states, queue config
│
├── db/
│   ├── schema.ts                # Drizzle table definitions
│   ├── client.ts                # Postgres + Drizzle singleton
│   └── migrate.ts               # Startup migration runner
│
├── jobs/
│   ├── queue.ts                 # BullMQ queue definitions + workers
│   ├── scheduler.ts             # Cron jobs (price checks, memory decay)
│   └── workers/                 # Job processors (planning, booking, memory, pricing)
│
├── routes/
│   ├── health.ts                # GET /health, /health/detailed
│   ├── whatsapp.ts              # POST /webhook/whatsapp (Twilio)
│   ├── booking.ts               # Booking session management
│   ├── payments.ts              # POST /webhook/stripe + success/cancel pages
│   └── dev.ts                   # Dev-only chat endpoint (non-production)
│
├── services/
│   ├── conversation/            # Core conversation engine
│   │   ├── engine.ts            # Message processing + Claude tool loop
│   │   ├── state-machine.ts     # Conversation FSM
│   │   ├── tool-executor.ts     # Routes Claude tool calls to implementations
│   │   ├── context.ts           # Conversation history assembly
│   │   ├── intent.ts            # Intent classification (regex + Haiku)
│   │   └── clarifier.ts         # Missing-info detection for planning
│   │
│   ├── booking/                 # Booking orchestration
│   │   ├── orchestrator.ts      # Browser session setup + execution
│   │   ├── session.ts           # Session lifecycle management
│   │   ├── search-cache.ts      # Redis-backed search result cache
│   │   └── providers/           # Site-specific automation
│   │       ├── base.ts          # Abstract provider with screenshot/CAPTCHA support
│   │       ├── provider-selector.ts  # Smart routing (loyalty, API availability)
│   │       ├── marriott.ts      # Marriott browser automation
│   │       ├── booking-com.ts   # Booking.com browser automation
│   │       ├── airbnb.ts        # Airbnb browser automation
│   │       ├── opentable.ts     # OpenTable browser automation
│   │       ├── viator.ts        # Viator browser automation
│   │       └── flights/
│   │           └── duffel.ts    # Duffel flight API provider
│   │
│   ├── planning/                # Trip planning
│   │   ├── planner.ts           # Plan generation orchestration
│   │   ├── modifier.ts          # AI-powered plan modifications
│   │   ├── research.ts          # Destination research (Brave Search)
│   │   ├── pdf.ts               # PDF itinerary generation
│   │   └── pricing.ts           # Price comparison + drop detection
│   │
│   ├── memory/                  # User preference memory
│   │   ├── store.ts             # Preference persistence + confidence decay
│   │   ├── recall.ts            # Semantic memory retrieval
│   │   ├── embeddings.ts        # Voyage AI vector embeddings
│   │   └── extractor.ts         # Extract preferences from conversation
│   │
│   ├── payments/                # Stripe integration
│   │   ├── stripe.ts            # Checkout session creation
│   │   └── webhook.ts           # Payment completion → booking trigger
│   │
│   ├── search/                  # Search providers
│   │   ├── flights.ts           # Duffel HTTP API
│   │   ├── hotels.ts            # Google Places hotels
│   │   ├── restaurants.ts       # Google Places restaurants
│   │   └── experiences.ts       # Google Places experiences
│   │
│   ├── tools/                   # Utility tools for Claude
│   │   ├── maps.ts              # Google Maps Places + Directions
│   │   ├── weather.ts           # OpenWeatherMap + Brave fallback
│   │   ├── web-search.ts        # Brave Search API
│   │   └── events.ts            # Ticketmaster + Brave fallback
│   │
│   ├── whatsapp/                # WhatsApp messaging
│   │   ├── handler.ts           # Incoming message processing
│   │   ├── sender.ts            # Twilio message sending
│   │   ├── templates.ts         # Interactive message templates
│   │   └── formatter.ts         # Message formatting for WhatsApp limits
│   │
│   ├── storage/
│   │   └── r2.ts                # Cloudflare R2 uploads (screenshots, PDFs)
│   │
│   └── rate-limiter.ts          # Rate limiting for Claude + browser sessions
│
├── types/                       # Shared TypeScript types
├── utils/                       # Logger, correlation IDs, Redis, helpers
├── templates/                   # HTML templates (live booking view)
└── index.ts                     # Application entry point

drizzle/                         # SQL migration files
```

---

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** 16+ with the `pgvector` extension
- **Redis** 6+

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/ASR4/destinx.git
cd destinx

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys (see Environment Variables below)

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (loads `.env` automatically) |
| `npm run build` | Compile TypeScript + copy templates and migrations |
| `npm start` | Run compiled output (production) |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:generate` | Generate migration files from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (dev convenience) |
| `npm run db:studio` | Open Drizzle Studio (visual DB explorer) |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys. Here's what each one does:

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sandbox or Business number |

### Search & Booking APIs

| Variable | Description | Required? |
|----------|-------------|-----------|
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform (Places, Directions) | Recommended |
| `DUFFEL_API_KEY` | Duffel flight search & booking | Recommended |
| `BRAVE_SEARCH_API_KEY` | Brave Search (web search, weather fallback, research) | Recommended |
| `VOYAGE_API_KEY` | Voyage AI embeddings for semantic memory | Optional |

### Payments

| Variable | Description | Required? |
|----------|-------------|-----------|
| `STRIPE_SECRET_KEY` | Stripe secret key (test or live) | Optional |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | With Stripe |
| `STRIPE_SERVICE_FEE_CENTS` | Service fee per booking in cents (default: 1500) | With Stripe |
| `FORCE_STRIPE_FLOW` | Set `true` to test Stripe with Duffel test keys | Optional |

### Browser Automation

| Variable | Description | Required? |
|----------|-------------|-----------|
| `BROWSERBASE_API_KEY` | Browserbase API key for cloud browsers | Optional |
| `BROWSERBASE_PROJECT_ID` | Browserbase project ID | With Browserbase |

### Storage & Events

| Variable | Description | Required? |
|----------|-------------|-----------|
| `CLOUDFLARE_R2_ACCESS_KEY` | R2 access key for screenshots/PDFs | Optional |
| `CLOUDFLARE_R2_SECRET_KEY` | R2 secret key | With R2 |
| `CLOUDFLARE_R2_BUCKET` | R2 bucket name | With R2 |
| `CLOUDFLARE_R2_ENDPOINT` | R2 S3-compatible endpoint | With R2 |
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery API for events | Optional |
| `OPENWEATHERMAP_API_KEY` | OpenWeatherMap 3.0 (Brave Search is fallback) | Optional |

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `APP_URL` | Public URL (used for Stripe redirects, live view links) | `http://localhost:3000` |
| `HEALTH_CHECK_API_KEY` | Protects `/health/detailed` endpoint | None |
| `LOG_LEVEL` | Pino log level | `info` |

---

## Database Setup

The application uses PostgreSQL with the `pgvector` extension for semantic memory. Migrations run automatically at startup via Drizzle ORM.

**Tables:**
- `users` — Phone number, name, active/opt-out status
- `user_preferences` — Key/value preferences with confidence scores and decay
- `user_memory_embeddings` — 1536-dimensional vector embeddings for semantic recall
- `trips` — Destinations, dates, JSON itinerary plans, budget
- `conversations` — Conversation state and context
- `messages` — Full message history including tool calls/results
- `bookings` — Booking records with provider, status, Stripe session, payment status
- `automation_scripts` — Browser automation step tracking and success rates

---

## Deployment

### Railway (recommended)

1. Connect your GitHub repo to [Railway](https://railway.app)
2. Add PostgreSQL and Redis services
3. Set environment variables in the Railway dashboard
4. Set `APP_URL` to your Railway public domain
5. Railway auto-deploys on push to `main`

The build runs `tsc` and copies templates/migrations. The start command runs `node dist/index.js`, which automatically executes pending database migrations.

### Twilio WhatsApp Setup

1. Go to [Twilio Console](https://console.twilio.com) → Messaging → Try it out → Send a WhatsApp message
2. In the sandbox settings, set:
   - **When a message comes in**: `https://YOUR-DOMAIN/webhook/whatsapp` (POST)
   - **Status callback URL**: `https://YOUR-DOMAIN/webhook/whatsapp` (POST)
3. Join the sandbox by sending the join code from your phone

### Stripe Webhook Setup

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Webhooks → Add endpoint
2. URL: `https://YOUR-DOMAIN/webhook/stripe`
3. Events: `checkout.session.completed`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Basic health check (always 200) |
| `GET` | `/health/detailed` | Detailed health with dependency status (requires API key) |
| `POST` | `/webhook/whatsapp` | Twilio WhatsApp incoming messages |
| `GET` | `/webhook/whatsapp` | Twilio webhook verification |
| `POST` | `/webhook/stripe` | Stripe payment webhook |
| `GET` | `/payment/success` | Post-payment success page |
| `GET` | `/payment/cancel` | Post-payment cancel page |
| `POST` | `/booking/start` | Start a browser booking session |
| `GET` | `/booking/live/:sessionId` | Live booking view (embedded browser) |
| `POST` | `/booking/live/:sessionId/cancel` | Cancel a booking session |
| `POST` | `/dev/chat` | Dev-only: test conversation without WhatsApp |
| `GET` | `/dev/conversations/:userId` | Dev-only: view conversation history |

---

## How It Works

### Conversation Flow

1. User sends a WhatsApp message
2. Twilio webhook hits `/webhook/whatsapp`
3. Message is queued via BullMQ for async processing
4. Intent classifier determines the user's goal (regex fast-path → Haiku LLM)
5. Conversation engine sends the message to Claude with tools and conversation history
6. Claude may call tools (search flights, check weather, create trip plan, book flight, etc.)
7. Tool results are fed back to Claude in a loop (up to 15 iterations)
8. Final response is sent back via WhatsApp (with interactive buttons when appropriate)

### Booking Flow (Flights)

1. User asks to search flights → Claude calls `search_flights` → Duffel API
2. Results are cached in Redis with a short `searchId` (prevents Claude from hallucinating long IDs)
3. User picks a flight → Claude collects passenger details → calls `book_flight`
4. **With Stripe**: Creates a Checkout Session → user pays → webhook triggers Duffel booking
5. **Without Stripe**: Books directly via Duffel API
6. Confirmation sent via WhatsApp

### Booking Flow (Hotels/Restaurants/Experiences)

1. Claude calls `initiate_booking` with venue details
2. A Browserbase cloud browser session is created
3. Stagehand navigates the booking site (Booking.com, OpenTable, Viator, etc.)
4. User gets a live view link to watch/intervene
5. User logs into their own account and completes payment
6. Screenshots are captured at each step and uploaded to R2

### Memory System

- Preferences are extracted from every conversation by Claude (Haiku)
- Stored with confidence scores that decay over time
- Semantic embeddings enable recall of relevant memories based on context
- Preferences are injected into the system prompt for personalized responses

---

## External Services

| Service | Free Tier | Sign Up |
|---------|-----------|---------|
| [Anthropic](https://console.anthropic.com) | Pay-as-you-go | Required |
| [Twilio](https://console.twilio.com) | Free trial credits | Required |
| [Duffel](https://app.duffel.com) | Free test mode | Recommended |
| [Google Maps Platform](https://console.cloud.google.com) | $200/month free | Recommended |
| [Brave Search](https://brave.com/search/api/) | 2,000 queries/month free | Recommended |
| [Stripe](https://dashboard.stripe.com) | No monthly fee (2.9% + 30¢ per transaction) | Optional |
| [Browserbase](https://browserbase.com) | Free tier available | Optional |
| [Cloudflare R2](https://dash.cloudflare.com) | 10GB free, zero egress | Optional |
| [Voyage AI](https://dash.voyageai.com) | Free tier available | Optional |
| [Ticketmaster](https://developer-acct.ticketmaster.com) | 5,000 requests/day free | Optional |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature (`git checkout -b feature/my-feature`)
3. **Make your changes** and ensure they build (`npm run build`)
4. **Run tests** (`npm test`)
5. **Commit** with a descriptive message
6. **Open a Pull Request**

### Areas Where Help Is Needed

- **Testing** — Integration and unit test coverage (see `src/__tests__/`)
- **Browser providers** — New booking site automations (follow `src/services/booking/providers/base.ts` pattern)
- **Observability** — Prometheus metrics, Sentry integration, structured error tracking
- **Multi-currency** — Currency conversion and display for international users
- **Localization** — Multi-language support for WhatsApp messages

### Development Tips

- Use `npm run dev` for hot-reload development
- Use `/dev/chat` endpoint to test without WhatsApp (non-production only)
- Use `npm run db:studio` to inspect the database visually
- Duffel test keys only work with "Duffel Airways" (fictional airline) — real airline bookings require a live key
- Browser automation requires a Browserbase account — without it, the system returns deep links for manual booking

---

## License

MIT
