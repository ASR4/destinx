# DESTINX AGENT UPGRADE — ENGINEERING BRIEF

## WHO YOU ARE
You are the principal engineer on Destinx, a WhatsApp-first AI travel agent. You have full access to the codebase. Your job is to take this from a functional prototype to a compelling, differentiated agent that people choose OVER vanilla ChatGPT/Claude for travel planning.

## WHAT DESTINX IS
A conversational AI travel agent that talks to users via WhatsApp, plans trips end-to-end, remembers user preferences across conversations, and helps users book through API integrations and deep links. Built on Fastify/TypeScript, PostgreSQL+pgvector, BullMQ/Redis, Anthropic Claude, Twilio WhatsApp, with Duffel for flight booking and Stripe for payments.

Browser automation (Browserbase/Stagehand) is **paused behind a feature flag** (`ENABLE_BROWSER_AUTOMATION=false`). Do not work on browser automation. All booking goes through Duffel API (flights) or pre-filled deep links (hotels, restaurants, experiences).

## THE CORE PROBLEM
Right now, a user could get a similar experience by pasting their travel question into ChatGPT. We need to make the gap between Destinx and a vanilla AI chat **viscerally obvious within 60 seconds** of conversation. That gap comes from three things vanilla AI chats cannot do:

1. **Remember** — Know the user across sessions (preferences, past trips, loyalty programs, companions, dietary needs)
2. **Act** — Search real inventories with live prices, book flights via API, generate working booking links, monitor prices
3. **Reach out** — Proactively notify users (price drops, trip reminders, follow-ups) instead of only responding when asked

---

## YOUR MISSION

Read the entire codebase thoroughly. Understand what's built, what's stubbed, what's TODO. Then implement the following upgrades in priority order. Each section explains WHAT to build, WHY it matters, and the DESIGN CONSTRAINTS.

---

## UPGRADE 1: Context Engineering (Agent Loop Improvements)

**Why**: This is the single highest-leverage improvement. The quality of Claude's responses in multi-turn travel planning conversations depends entirely on how we assemble the context window. These techniques come from Manus AI's production learnings (the most successful autonomous agent in market) and directly apply to our agent loop.

**What to do**:

### 1a. Append-only conversation state
Audit the conversation engine. Make sure we NEVER delete, rewrite, or sanitize conversation history before sending it to Claude. If the agent recommended a bad restaurant and the user said "no, I don't want that", that exchange must stay in context. Claude self-corrects better when it can see its own mistakes. If there's any history cleanup or filtering happening, remove it. The only acceptable manipulation is summarization of OLD messages (see 1c).

### 1b. Re-read the active plan at the END of context
When there's an active trip being planned (a trip in `planning` or `confirmed` status), append a compressed summary of the current trip state as the LAST user-role message or as a final system block before Claude generates. Not just in the system prompt at the top — at the END. This prevents "lost in the middle" drift that kills coherence in 15+ turn planning sessions. The format should be something like:

```
[CURRENT TRIP STATE]
Destination: Tokyo, Japan
Dates: Oct 15-22, 2026
Travelers: 2 adults
Budget: ~$4,000 total
Status: Days 1-3 planned, Days 4-7 pending
Accommodation: Decided — Hotel The Celestine Ginza (Marriott Bonvoy)
Flights: Comparing 2 options, user hasn't decided
Open questions: User wants a "special anniversary dinner" on Day 5 — not yet researched
```

This should be generated from the `trips.plan` JSONB column dynamically on every turn.

### 1c. Three-tier context windowing
Replace any simple "last N messages" truncation with a tiered strategy:
- **Tier 1 (always included, verbatim)**: System prompt, user profile summary, active trip state, last 6 messages (user + assistant pairs)
- **Tier 2 (included if context budget allows)**: Messages 7–20, with tool results condensed to key findings only (strip raw API response data, keep the conclusions)
- **Tier 3 (summarized)**: Messages older than 20 turns get summarized by a background Claude Haiku call into a ~200 token "conversation so far" paragraph. Store this summary in the conversation's `context` JSONB column and update it as the conversation grows.

Implement token counting (rough estimate: 4 chars ≈ 1 token) to stay within budget. Target: keep assembled context under 80K tokens to leave room for Claude's response and avoid quality degradation at the edges of the context window.

### 1d. Stable tool set
Make sure ALL travel tools are registered in every Claude call, regardless of conversation state. Don't conditionally include/exclude tools based on intent or conversation phase. Manus found that dynamically changing the tool set between turns degrades tool selection accuracy. If we have 10-12 tools, they should all be present every turn. Claude is smart enough to not call `search_flights` when the user is asking about restaurants.

### 1e. Concise tool results
Audit every tool handler's return value. Tool results that go back into Claude's context must be CONCISE. If a hotel search returns 50 properties with 30 fields each, that blows the context budget. Every tool should return at most 5-8 results with only the fields Claude needs to reason about: name, price, rating, 1-line description, booking URL. Raw API responses should be transformed into compact summaries before they enter the conversation history.

---

## UPGRADE 2: Proactive Notifications

**Why**: This is the single biggest behavioral difference between an agent and a chatbot. A chatbot waits for you. An agent reaches out when it has something useful to say.

**What to do**:

### 2a. Notification types to implement
Build a notification service that can send outbound WhatsApp messages for these scenarios:

1. **Price drop alert**: "Good news! That Tokyo flight dropped $85 since yesterday. Want to lock it in? [booking link]"
2. **Price increase warning**: "Heads up — the Celestine Ginza went up ¥3,000/night since you saved it. Prices for your dates are trending up."
3. **Trip countdown**: "Your Tokyo trip is in 5 days! I put together a packing list based on the forecast (72°F, slight chance of rain): [link]"
4. **Abandoned plan follow-up**: If a user was planning a trip and went silent for 48+ hours: "Still thinking about Tokyo? I saved your itinerary — want to pick up where we left off?"
5. **Local event discovery**: "I just found out there's a ramen festival in Shinjuku during your visit (Oct 18-20). Want me to work it into Day 4?"

### 2b. WhatsApp template messages
Outbound messages outside the 24-hour conversation window require Twilio-approved templates. Create template definitions for each notification type above. These need to be registered with Twilio before they can be sent. Create a template registry file that maps notification types to Twilio Content SIDs.

### 2c. Scheduling infrastructure
Use BullMQ's delayed job / repeatable job features:
- **Price monitoring**: Repeatable job every 6 hours for each "watched" trip. Compare current price vs. saved price. Trigger alert if delta > 5%.
- **Trip countdown**: Schedule countdown messages at T-7 days, T-3 days, T-1 day before trip start.
- **Abandoned plan**: Schedule a follow-up 48 hours after last message in any conversation with an active trip in `planning` status.
- **Event discovery**: When a trip is confirmed, run a one-time event search for the destination + dates and notify if anything interesting is found.

Create a scheduler service (`src/jobs/scheduler.ts`) that manages these scheduled jobs, including cancellation when trips are modified or cancelled.

### 2d. Notification preferences
Add a `notification_preferences` field to the user profile or a separate table. Users should be able to say "stop sending me price alerts" or "don't message me after 10pm". Respect these preferences in the notification service. Include an opt-out mechanism in every outbound message ("Reply STOP to turn off alerts").

---

## UPGRADE 3: Web Companion

**Why**: WhatsApp has hard constraints — 1024 char body for interactive messages, max 3 buttons, max 10 list items, no rich formatting. A 7-day itinerary with maps, hotel comparisons, and budget breakdowns simply cannot be delivered well in WhatsApp alone. We need a lightweight web layer the agent can link to for rich content.

**What to do**:

### 3a. Itinerary page (`GET /trip/:tripId`)
A mobile-optimized web page that displays a full trip itinerary. This page should render:
- Trip title, dates, destination
- Day-by-day view with timeline of activities, meals, transport
- Map with pinned locations (use a static Google Maps embed or Mapbox)
- Accommodation details with booking link
- Flight details with booking reference or booking link
- Budget breakdown (per day and total)
- Each item should have its booking deep link as a CTA button

Secure with a short-lived token in the URL (not authenticated, but unguessable). The agent sends the link in WhatsApp: "Here's your full Tokyo itinerary with a map: {APP_URL}/trip/{tripId}?token={token}"

The `src/templates/` directory already exists in the build pipeline (`cp -r src/templates dist/`). Use server-rendered HTML with inline CSS. Must load fast on mobile — no JavaScript frameworks, no external CSS libraries. Inline everything.

### 3b. Travel DNA profile page (`GET /profile/:userId`)
A page where users can see everything the agent has learned about them:
- Grouped by category (accommodation prefs, food prefs, transport prefs, loyalty programs, etc.)
- Each preference shows the value and confidence level
- Users can tap to edit/correct any preference (sends a WhatsApp message like "Actually I prefer aisle seats" which the agent processes normally)
- A "Travel Personality" blurb generated by Claude from the full profile (cache this, regenerate when profile changes)
- Past trips list

Agent sends this proactively after 2-3 conversations: "I've been learning your travel style! Here's your Travel DNA — let me know if anything's off: {link}"

### 3c. Comparison page (`GET /compare/:comparisonId`)
When the agent presents 3-5 hotel or flight options, WhatsApp can't show them side-by-side. Generate a comparison page:
- Table/card layout with key attributes (price, rating, location, loyalty program, cancellation policy)
- Each option has a "Choose this" button that sends a WhatsApp message back to the agent
- Highlight which option the agent recommends and why

Store comparison data in Redis with a 24-hour TTL.

### 3d. Route setup
Add these routes to Fastify. Keep it simple — `reply.type('text/html').send(renderedHtml)`. No API/JSON layer needed for v1. These are server-rendered pages.

---

## UPGRADE 4: Trip Plan Validation Pass

**Why**: The #1 reason people don't trust AI travel plans is hallucinated venues and impossible logistics. "Claude recommended a restaurant that closed 2 years ago" or "the plan has me in Shinjuku at 2pm and Kamakura at 2:30pm — that's 90 minutes away." A validation pass catches these and makes our plans trustworthy.

**What to do**:

### 4a. Build a plan validator (`src/services/planning/validator.ts`)
After the planner generates a structured itinerary, run validation checks:

1. **Venue existence check**: For each named venue, verify it exists via Google Places API lookup. Flag any venue that returns no results or is permanently closed.
2. **Logistics check**: For consecutive items in a day, estimate travel time between them (Google Maps Distance Matrix API or a rough heuristic). Flag if the gap between activities is shorter than the travel time.
3. **Hours check**: If we have opening hours from Google Places, verify the activity is scheduled during open hours.
4. **Budget check**: Sum all itemized costs per day and total. Flag if total exceeds the user's stated budget by >15%.
5. **Pace check**: Count activities per day. Flag if it exceeds the user's pace preference (packed=6+, balanced=3-5, relaxed=1-3).

### 4b. Auto-fix or flag
For each validation issue:
- If auto-fixable (budget math, simple time shifts): fix it and note the change
- If not auto-fixable (venue doesn't exist, impossible logistics): flag it and send back to Claude with the specific issue for replanning that segment

### 4c. Confidence indicator
After validation, tag the plan with a confidence score. Surface this to the user: "I've verified all the restaurants and checked travel times — this plan is solid ✓" vs. "Note: I couldn't verify one restaurant (Sushi Dai) — it may have moved or closed. Want me to find an alternative?"

---

## UPGRADE 5: Preference Confidence & Contradiction Handling

**Why**: The memory system stores preferences, but without proper confidence mechanics, stale or wrong preferences poison every future recommendation. A user who mentioned "I love sushi" once in passing shouldn't get sushi recommended for every meal for the rest of their life.

**What to do**:

### 5a. Confidence scoring rules
Implement these specific rules in the preference store:

| Signal | Confidence |
|--------|-----------|
| User explicitly states preference | 0.7 |
| Agent infers from behavior/context | 0.4 |
| User confirms an inferred preference | +0.2 (cap at 0.95) |
| User acts consistently with preference (e.g., picks the boutique hotel again) | +0.1 (cap at 0.95) |
| User contradicts a stored preference | Reset to 0.3, set `needs_clarification: true` |
| Preference not referenced in 6+ months | Decay by 0.1 |

### 5b. Contradiction detection
In the preference extractor, before storing a new preference, check if it contradicts an existing one. Examples:
- Stored: `dietary.diet = "vegetarian"` → New signal: user asks for steak restaurant recommendations
- Stored: `transport.flight_time = "afternoon_only"` → New signal: user selects a 6am flight

When detected, don't silently overwrite. Have the agent acknowledge it naturally: "I had you down as preferring afternoon flights — did that change, or is this trip an exception?"

### 5c. Profile freshness
Add a `last_referenced_at` timestamp to preferences. Update it whenever a preference is used in trip planning. Preferences not referenced in 6 months get their confidence decayed. This prevents ancient preferences from dominating.

### 5d. Preference injection with confidence weighting
When building the user profile summary for the system prompt, weight preferences by confidence:
- High confidence (>0.7): State as fact — "You prefer boutique hotels"
- Medium confidence (0.4-0.7): State as observed — "You've tended toward afternoon flights"
- Low confidence (<0.4): State as tentative — "You might prefer window seats (mentioned once)"

This helps Claude calibrate how strongly to lean on each preference.

---

## UPGRADE 6: Graceful Degradation

**Why**: In production, things break constantly — APIs timeout, rate limits hit, Claude has a bad turn, Twilio drops a message. The user should NEVER experience an unhandled error or a conversation that just... stops.

**What to do**:

### 6a. Create an error handling strategy file (`src/utils/errors.ts`)
Define error categories and their user-facing responses:

| Failure | User Message | Internal Action |
|---------|-------------|-----------------|
| Claude API timeout/5xx | "Give me one more second..." → retry → if still fails: "I'm having trouble thinking through that. Can you try rephrasing?" | Retry 1x after 3s, log, alert if >3 in 5min |
| Claude API rate limit | "I'm juggling a few conversations — give me 10 seconds" | Queue with backoff, prioritize by user |
| Search API failure (Duffel, Google, Brave) | Claude handles gracefully in-context with: "I couldn't check live prices for that right now, but based on what I know about [destination]..." | Log, fall back to cached results if available, mark tool as degraded |
| Twilio send failure | (user sees nothing) | Retry 3x with exponential backoff (1s, 4s, 16s), dead-letter queue on final failure, alert team |
| Database error | "I'm having a moment — try again in a sec?" | Circuit breaker pattern, alert immediately |
| Tool returns empty results | Let Claude handle — it's in the system prompt that it should never make up data | Log for analysis (might indicate API issue) |
| Duffel booking failure | "That flight couldn't be booked right now — it might have sold out. Want me to find alternatives, or here's a link to book directly: [deep link]" | Log, fall back to deep link for the airline |
| Stripe payment failure | "The payment didn't go through. Want to try again, or would you prefer to book directly with the airline?" | Log, offer retry + fallback |
| User sends unsupported media (audio, video) | "I can read text and images — could you type that out for me?" | Log media type for future feature prioritization |

### 6b. Implement retry wrapper
Create a `withRetry(fn, { maxRetries, backoff, onRetry })` utility that wraps all external API calls. Every call to Duffel, Google, Brave, OpenWeatherMap, Claude should go through this wrapper.

### 6c. Circuit breaker for external services
If a service fails 3+ times in 5 minutes, trip the circuit breaker. Stop calling it for 2 minutes (return cached data or skip gracefully). This prevents cascading failures where a down API causes every conversation to timeout.

### 6d. Dead letter queue
BullMQ jobs that fail after all retries should go to a dead letter queue, not disappear. Create a dead letter handler that: (1) logs the failure with full context, (2) sends the user a "sorry" message if they haven't heard back in 30 seconds, (3) alerts the team.

---

## UPGRADE 7: Onboarding Experience

**Why**: The first conversation determines whether a user comes back. If the first interaction feels just like ChatGPT, they won't return. The onboarding must feel like talking to a brilliant, well-traveled friend — not filling out a form.

**What to do**:

### 7a. New user detection and special handling
When a user messages for the first time (no record in `users` table), trigger the onboarding flow instead of the normal agent loop. The onboarding system prompt should be different from the regular one — focused on learning about the traveler while being immediately useful.

### 7b. Onboarding system prompt principles
- **Give value BEFORE extracting info**: If the user says "thinking about Japan in October", respond with a genuinely useful insight about Japan in October (autumn colors, fewer crowds, food festivals) BEFORE asking any questions
- **Max 2 questions per message**: Never send a 5-question survey. Weave preference discovery into natural conversation.
- **Acknowledge what you learn**: "Good to know you prefer boutique hotels — I'll keep that in mind!" This shows the agent is listening and building a profile.
- **Natural extraction targets for first conversation** (in rough order):
  1. What kind of trip they're thinking about (destination, vibe)
  2. Travel style (packed vs. relaxed, adventurous vs. comfort)
  3. Budget signals (ask indirectly: "thinking more boutique hotel or luxury resort?")
  4. Companion situation (solo, partner, family, friends)
  5. Loyalty programs (ask when recommending accommodations: "do you have any hotel loyalty programs? I can make sure you're earning points")
  6. Dietary needs (ask when discussing food: "any dietary preferences I should know about for restaurant recs?")

### 7c. Transition from onboarding to regular flow
After the agent has learned 4+ preferences with confidence >= 0.5, switch to the regular system prompt on the next turn. The transition should be invisible to the user — no "onboarding complete!" message.

---

## UPGRADE 8: Booking Strategy (Post-Browser-Automation)

**Why**: Browser automation is paused. We need a booking experience that still feels like the agent is DOING something, not just giving you a Google search.

**What to do**:

### 8a. Duffel flights — full pipeline
This is our ONE fully API-based booking vertical. Make it flawless:
- Search → present top options with WhatsApp list message
- User selects → create Duffel offer request → confirm offer
- Collect passenger details via conversation (name, DOB, passport number — handle sensitively, acknowledge the data, store temporarily, delete after booking)
- If Stripe is configured, create payment intent for service fee
- Complete Duffel order → send confirmation with booking reference
- Store in `bookings` table with `status: 'booked'`, `booking_reference`
- Send a formatted confirmation message with all details

### 8b. Deep link engine — make it feel smart
For hotels, restaurants, and experiences, the agent can't book directly. But it CAN make the process feel dramatically easier than doing it yourself:

The agent message should be: "I found the perfect hotel — Hotel The Celestine Ginza, ¥22,000/night, Marriott Bonvoy eligible. Here's a link with your dates and room pre-selected. Just log in and confirm to earn your Platinum bonus points: [link]"

Not: "Here's a link to Marriott.com: [link]"

The deep link should pre-fill as many parameters as possible: dates, guests, room type, destination. Test every generated link on mobile (WhatsApp users are on phones).

Build deep link generators for:
- **Hotels**: Booking.com, Marriott, Hilton, Hyatt, Airbnb
- **Flights** (fallback if Duffel fails): Skyscanner, Google Flights, airline direct sites
- **Restaurants**: OpenTable, Resy, Google Maps
- **Experiences**: GetYourGuide, Viator

### 8c. Booking tracking
Even for deep-link bookings, track them in the `bookings` table with `status: 'link_sent'`. If the user later says "I booked that hotel", update to `status: 'user_confirmed'` and capture any reference number they share. This lets the agent reference bookings in future context: "You're already booked at the Celestine for Oct 15-19."

---

## GENERAL ENGINEERING GUIDELINES

### Code quality
- Run `grep -rn "TODO\|FIXME\|HACK\|XXX\|PLACEHOLDER" src/ --include="*.ts"` and resolve every item. Either implement it, delete it with a comment explaining why it's deferred, or create a clearly documented backlog item.
- Every external API call should have: timeout (10s default), retry logic, error handling that returns a user-friendly fallback
- Every tool handler should transform API responses into concise summaries before they enter Claude's context

### Testing
- Write tests for: deep link generators (these break silently and are critical), context assembly logic, preference confidence scoring, plan validation
- Create 3-5 "golden conversation" test fixtures: recorded multi-turn conversations that exercise the full agent loop. Run these as integration tests.

### Observability
- Structured logging with Pino for every agent loop cycle: `{ userId, conversationId, intent, toolsCalled: string[], responseTimeMs, tokensUsed, preferencesLearned: number }`
- Track these metrics (log them, we'll add dashboards later): conversations per user, agent response latency, tool call success rate per provider, preferences learned per conversation, plan generation success rate

### Cost awareness
- Use `claude-sonnet-4-20250514` for the main conversation loop (fast, good enough)
- Use `claude-haiku-4-5-20251001` for background tasks: preference extraction, conversation summarization, travel personality generation
- Cache tool results in Redis: 15 min TTL for prices, 24h TTL for venue data, 7 day TTL for destination info
- Count tokens roughly (4 chars ≈ 1 token) and log per-conversation cost. Target: under $0.15 per full trip planning conversation.

---

## PRIORITY ORDER

If you can only do some of these, do them in this order:

1. **Upgrade 1** (Context Engineering) — Highest leverage, improves every conversation
2. **Upgrade 7** (Onboarding) — First impressions determine retention
3. **Upgrade 6** (Graceful Degradation) — Nothing kills trust faster than errors
4. **Upgrade 8** (Booking Strategy) — The agent needs to DO things, not just talk
5. **Upgrade 5** (Preference Confidence) — Makes the memory system trustworthy
6. **Upgrade 4** (Plan Validation) — Makes trip plans trustworthy
7. **Upgrade 2** (Proactive Notifications) — Transforms chatbot into agent
8. **Upgrade 3** (Web Companion) — Unblocks rich content delivery

---

## SUCCESS CRITERIA

After implementing these upgrades, we should pass these tests:

- [ ] A new user can go from "Hi" to a verified day-by-day itinerary with booking links in under 10 minutes of conversation
- [ ] A returning user gets visibly personalized recommendations that reference their known preferences
- [ ] The agent can book a real flight via Duffel and send a confirmation
- [ ] When a search API fails, the user gets a helpful response instead of an error
- [ ] The agent sends at least one proactive message (price alert or trip reminder) within 48 hours of a plan being created
- [ ] The agent never sends a WhatsApp message longer than 300 words
- [ ] The agent never asks more than 2 questions in a single message
- [ ] The plan validation catches and flags a hallucinated venue or impossible travel time
- [ ] A 90-second demo video of the full flow would make someone say "I want that"