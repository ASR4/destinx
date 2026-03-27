---
name: Scaffold Travel Agent
overview: Scaffold the complete AI Travel Agent project at /Users/arekhi/Documents/Git/destinx -- all files, types, configurations, database schema, and service stubs -- then implement functionality phase by phase starting with Phase 1 (WhatsApp + Conversation Loop).
todos:
  - id: project-init
    content: Create package.json, tsconfig.json, drizzle.config.ts, .env.example, .gitignore, README.md and install all dependencies
    status: completed
  - id: types
    content: Create all type definitions in src/types/ (whatsapp, trip, booking, memory, conversation)
    status: completed
  - id: config
    content: Create src/config/env.ts (Zod validation) and src/config/constants.ts
    status: completed
  - id: database
    content: Create src/db/schema.ts (full Drizzle schema with pgvector), src/db/client.ts, and generate initial migration
    status: completed
  - id: utils
    content: Create all utility modules in src/utils/ (logger, phone, currency, date, deeplink)
    status: completed
  - id: ai-layer
    content: Create src/ai/client.ts, src/ai/tools.ts, and all prompt files in src/ai/prompts/
    status: completed
  - id: services-whatsapp
    content: Scaffold src/services/whatsapp/ (handler, sender, templates, media)
    status: completed
  - id: services-conversation
    content: Scaffold src/services/conversation/ (engine, intent, clarifier, context)
    status: completed
  - id: services-planning
    content: Scaffold src/services/planning/ (planner, research, itinerary, pricing, pdf)
    status: completed
  - id: services-memory
    content: Scaffold src/services/memory/ (extractor, store, embeddings, recall, profile)
    status: completed
  - id: services-booking
    content: Scaffold src/services/booking/ (orchestrator, session, live-view, all providers)
    status: completed
  - id: services-search
    content: Scaffold src/services/search/ (flights, hotels, restaurants, experiences, transport)
    status: completed
  - id: services-tools
    content: Scaffold src/services/tools/ (web-search, maps, weather, events)
    status: completed
  - id: routes
    content: Create src/routes/ (whatsapp, booking, health)
    status: completed
  - id: jobs
    content: Create src/jobs/ (queue setup, all worker stubs, scheduler)
    status: completed
  - id: entry-point
    content: Create src/index.ts (Fastify server with all plugins and routes)
    status: completed
isProject: false
---

# Scaffold AI Travel Agent -- Full Project

## Approach

Scaffold the entire project structure first (all files with real types, configs, and DB schema, plus stub implementations for services), then fill in real implementations phase by phase. This gives a compilable, navigable codebase from day one.

---

## Step 1: Project Init and Dependencies

Create `package.json`, `tsconfig.json`, `drizzle.config.ts`, `.env.example`, `.gitignore`, and `README.md` in the workspace root.

**Key config decisions:**

- ESM (`"type": "module"` in package.json, `"module": "ESNext"` in tsconfig)
- Path aliases: `@/` maps to `src/`
- Strict TypeScript
- `tsx` for development, `tsc` for build

**Dependencies** (all latest via `npm install`):

- Core: `fastify`, `@fastify/cors`, `@fastify/formbody`
- AI: `@anthropic-ai/sdk`
- WhatsApp: `twilio`
- DB: `drizzle-orm`, `postgres`, `@electric-sql/pglite` (local dev)
- Queue: `bullmq`, `ioredis`
- Validation: `zod`
- Logging: `pino`, `pino-pretty`
- Browser: `@browserbasehq/sdk`, `@browserbasehq/stagehand`
- Dev: `typescript`, `@types/node`, `tsx`, `drizzle-kit`

---

## Step 2: Type Definitions (`src/types/`)

Create all shared types first -- these define the data contracts for the entire app.

- [`src/types/whatsapp.ts`] -- Twilio webhook payload types, outgoing message types
- [`src/types/trip.ts`] -- `Trip`, `DayPlan`, `DayItem`, `Itinerary`, `Budget`, `Traveler`
- [`src/types/booking.ts`] -- `BookingDetails`, `BookingResult`, `BookingStatus`, `DeepLinks`, provider-specific detail types
- [`src/types/memory.ts`] -- `UserProfile`, `Preference`, `PreferenceCategory`, `SemanticMemory`
- [`src/types/conversation.ts`] -- `Message`, `Intent`, `ConversationState`, `ConversationStatus`

---

## Step 3: Configuration (`src/config/`)

- [`src/config/env.ts`] -- Zod schema validating all env vars from the spec (DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, TWILIO_*, BROWSERBASE_*, GOOGLE_MAPS_API_KEY, AMADEUS_*, BRAVE_SEARCH_API_KEY, etc.). Export typed `env` object.
- [`src/config/constants.ts`] -- App constants (max WhatsApp message length, default concurrency, timeout values, supported providers list)

---

## Step 4: Database Schema (`src/db/`)

- [`src/db/schema.ts`] -- Full Drizzle schema matching the SQL spec: `users`, `userPreferences`, `userMemoryEmbeddings`, `conversations`, `messages`, `trips`, `bookings`, `automationScripts`. Use `pgvector` via custom type for the embedding column.
- [`src/db/client.ts`] -- Drizzle client setup using `postgres` driver, reads `DATABASE_URL` from env.
- [`drizzle.config.ts`] -- Drizzle Kit config for migrations.
- Generate initial migration via `drizzle-kit generate`.

---

## Step 5: Utility Modules (`src/utils/`)

Stub implementations with correct signatures and types:

- [`src/utils/logger.ts`] -- Pino logger setup (real implementation, small)
- [`src/utils/phone.ts`] -- `normalizePhone()`, `parseWhatsAppNumber()` 
- [`src/utils/currency.ts`] -- `formatCurrency()`, `convertCurrency()` stubs
- [`src/utils/date.ts`] -- `parseFlexibleDate()`, `formatDateRange()` stubs
- [`src/utils/deeplink.ts`] -- Deep link generators for Booking.com, Skyscanner, Google Flights, OpenTable, Viator (real implementations -- these are just URL builders)

---

## Step 6: AI Layer (`src/ai/`)

- [`src/ai/client.ts`] -- Anthropic SDK client singleton
- [`src/ai/tools.ts`] -- All Claude tool definitions from the spec (search_hotels, search_flights, search_restaurants, search_experiences, search_transport, web_search, check_weather, create_trip_plan, initiate_booking, save_preference)
- [`src/ai/prompts/system.ts`] -- Dynamic system prompt builder (`buildSystemPrompt()`)
- [`src/ai/prompts/planning.ts`] -- Trip planning prompt
- [`src/ai/prompts/extraction.ts`] -- Memory extraction prompt
- [`src/ai/prompts/clarification.ts`] -- Clarifying questions prompt
- [`src/ai/prompts/booking.ts`] -- Booking confirmation prompt

---

## Step 7: Service Stubs (`src/services/`)

Every service file from the spec, with exported functions that have correct TypeScript signatures, JSDoc comments explaining the intended behavior, and `throw new Error('Not implemented')` or minimal stub logic.

### WhatsApp (`src/services/whatsapp/`)

- `handler.ts` -- `handleIncomingMessage()`
- `sender.ts` -- `sendText()`, `sendInteractiveButtons()`, `sendListMessage()`, `sendMedia()`, `sendTypingIndicator()`
- `templates.ts` -- WhatsApp message template builders
- `media.ts` -- PDF/image attachment handling

### Conversation (`src/services/conversation/`)

- `engine.ts` -- `processMessage()` (the brain)
- `intent.ts` -- `classifyIntent()`
- `clarifier.ts` -- `generateClarifyingQuestions()`
- `context.ts` -- `buildContextWindow()`, `getConversationHistory()`

### Planning (`src/services/planning/`)

- `planner.ts` -- `generateTripPlan()`
- `research.ts` -- `researchDestination()`
- `itinerary.ts` -- `structureItinerary()`, `formatDayPlan()`
- `pricing.ts` -- `fetchLivePrices()`
- `pdf.ts` -- `generateItineraryPdf()`

### Memory (`src/services/memory/`)

- `extractor.ts` -- `extractPreferences()`
- `store.ts` -- `upsertPreference()`, `getPreferences()`
- `embeddings.ts` -- `embedText()`, `storeMemoryEmbedding()`
- `recall.ts` -- `recallUserProfile()`, `recallRelevantMemories()`
- `profile.ts` -- `buildUserProfile()`

### Booking (`src/services/booking/`)

- `orchestrator.ts` -- `startBookingSession()`, `executeBookingSession()`
- `session.ts` -- `createBrowserSession()`, `destroySession()`
- `live-view.ts` -- `getLiveViewUrl()`
- `providers/base.ts` -- Abstract `BaseBookingProvider` class
- `providers/marriott.ts` -- `MarriottBookingProvider` extends base
- `providers/booking-com.ts` -- stub
- `providers/airbnb.ts` -- stub
- `providers/skyscanner.ts` -- stub
- `providers/opentable.ts` -- stub
- `providers/viator.ts` -- stub

### Search (`src/services/search/`)

- `flights.ts` -- `searchFlights()` (Amadeus)
- `hotels.ts` -- `searchHotels()` (Google Places)
- `restaurants.ts` -- `searchRestaurants()` (Google Places + Yelp)
- `experiences.ts` -- `searchExperiences()` (Viator/GYG)
- `transport.ts` -- `searchTransport()` (Rome2Rio)

### Tools (`src/services/tools/`)

- `web-search.ts` -- `webSearch()` (Brave Search)
- `maps.ts` -- `getDirections()`, `getDistance()`
- `weather.ts` -- `getWeather()`
- `events.ts` -- `searchEvents()`

---

## Step 8: Routes (`src/routes/`)

- [`src/routes/whatsapp.ts`] -- `POST /webhook/whatsapp` (Twilio webhook handler)
- [`src/routes/booking.ts`] -- `POST /booking/start`, `GET /booking/live/:sessionId`
- [`src/routes/health.ts`] -- `GET /health`

---

## Step 9: Job Queues (`src/jobs/`)

- [`src/jobs/queue.ts`] -- BullMQ queue definitions (conversation, planning, booking, memory, price-check)
- [`src/jobs/workers/plan-generator.ts`] -- stub
- [`src/jobs/workers/browser-booking.ts`] -- stub
- [`src/jobs/workers/memory-extract.ts`] -- stub
- [`src/jobs/workers/price-check.ts`] -- stub
- [`src/jobs/workers/post-trip.ts`] -- stub
- [`src/jobs/scheduler.ts`] -- Cron job stubs

---

## Step 10: Entry Point (`src/index.ts`)

Fastify server setup: register plugins (`@fastify/cors`, `@fastify/formbody`), register all route files, initialize DB client, start listening. Include graceful shutdown for queue workers.

---

## File Count Summary

~55 TypeScript files across the directory structure. All will compile, all exports will have correct types, and the project will be navigable and ready for phase-by-phase implementation.

After scaffolding, Phase 1 implementation (WhatsApp + Conversation Loop) will be the first real code pass, filling in the stubs for: webhook handler, user management, conversation engine, Claude integration, system prompt, and WhatsApp sender.