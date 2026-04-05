# Destinx — Active TODO List

Items tracked during development and testing. Check off as completed.

---

## Production Readiness

- [ ] **Browserbase Enterprise — enable `advancedStealth`**
  Re-enable `advancedStealth: true` in `src/services/booking/session.ts` when on Browserbase Enterprise plan. Currently disabled because it requires Enterprise.

- [ ] **Browserbase Enterprise — embeddable Live View (Option C)**
  Enterprise plan includes an embeddable live view URL for end users to watch the booking in real time (no auth needed). Replace the current screenshot-based progress updates with the live view embed once on Enterprise.

- [ ] **WhatsApp Business number**
  Replace Twilio sandbox number (`+14155238886`) with a real WhatsApp Business number. This enables:
  - Proper `*bold*` formatting (remove `cleanForWhatsApp` strip in `sender.ts`)
  - No "join sandbox" requirement for new users
  - Higher rate limits
  - Template message approval for interactive buttons

- [ ] **Duffel production API key**
  Apply for Duffel live/production access (KYC process takes days/weeks). Keep testing with `duffel_test_*` key in parallel. Once live, disable `FORCE_STRIPE_FLOW` and use real payment processing.

## API Keys Needed

- [x] **OpenAI API key** — Added. Used by Stagehand (gpt-4o-mini) for browser automation. Make sure `OPENAI_API_KEY` is also set in Railway env vars.

## Booking Providers

- [ ] **Implement Twilio Content API for interactive buttons/lists**
  `sendInteractiveButtons` and `sendListMessage` in `sender.ts` are still falling back to plain text. Need to register and use Twilio Content API templates.

- [ ] **Implement Resy API provider**
  `src/services/booking/providers/resy.ts` is a stub. Needs real API integration for restaurant reservations.

- [ ] **Implement price drop monitoring**
  `checkPriceDrop` in `src/services/planning/pricing.ts` is a stub. Implement per-type price fetching and comparison.

- [ ] **Implement media handling**
  `downloadMedia` and `uploadMediaForSharing` in `src/services/whatsapp/media.ts` are stubs.

## Testing & Stability

- [ ] **Integration test harness**
  Build `conversation-flow.test.ts`, `flight-booking.test.ts` with `ioredis-mock`.

- [ ] **Unit tests**
  Cover `tool-executor`, `search-cache`, `memory-store`, `formatter`.

- [ ] **Twilio signature validation**
  Validate incoming webhook signatures to prevent spoofed messages.

## Scale & Ops

- [ ] **Sentry error tracking**
  Add Sentry for unhandled errors and performance monitoring.

- [ ] **Prometheus metrics**
  Track Claude API latency, tool call counts, booking success/failure rates.

- [ ] **Session archival & summarization**
  Archive old conversations, summarize long histories to save tokens.

- [ ] **Multi-currency support**
  Currently defaults to USD. Support user's local currency.

- [ ] **PII encryption at rest**
  Encrypt sensitive fields (phone, email, passport) in the database.
