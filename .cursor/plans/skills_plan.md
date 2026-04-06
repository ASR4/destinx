# DESTINX — TESTING & VALIDATION PLAYBOOK

## Repo Housekeeping (Do Now)

1. Save `docs/SKILLS-ARCHITECTURE.md` in the repo — the full skills plan for future reference
2. Create `docs/AGENT-UPGRADES.md` — the upgrade brief that was just implemented, for posterity
3. Make sure `README.md` reflects the current state of the project, not the aspirational OG-FULL-PLAN

---

## Phase A: Self-Testing (Days 1–3)

Before giving this to anyone else, run through these scenarios yourself on WhatsApp. Record what works and what doesn't.

### Conversation 1: Cold start — new user, specific trip
```
You: "Hey"
→ Does the agent introduce itself naturally?
→ Does it ask ≤2 questions at a time?

You: "I want to plan a trip to Tokyo in October for me and my wife"
→ Does it give a useful insight about Tokyo in October before asking questions?
→ Does it naturally extract: dates, budget signals, travel style?

You: "We like food, boutique hotels, not too packed of a schedule"
→ Does it acknowledge and save these preferences?
→ Does it start planning or ask smart follow-up questions?

You: "Budget around $5k total for 7 days"
→ Does it generate a plan?
→ How long does the plan take to generate? (Target: <25 seconds)
→ Is the plan delivered day-by-day with buttons?
→ Are the restaurants and hotels real places?
→ Do the deep links actually work on mobile?
```

### Conversation 2: Returning user — test memory
```
Start a NEW conversation from the same WhatsApp number.

You: "I'm thinking about Barcelona"
→ Does the agent recognize you?
→ Does it reference your known preferences (boutique hotels, food-focused, relaxed pace)?
→ Does it mention your wife as a travel companion?
→ Does it NOT re-ask questions it already knows the answer to?
```

### Conversation 3: Booking flow
```
You: "Find me flights from SFO to Tokyo in October"
→ Does Duffel return real results?
→ Are they presented clearly in WhatsApp?
→ Can you select one and proceed toward booking?
→ If Duffel fails, does it degrade to a Skyscanner deep link?
```

### Conversation 4: Error resilience
```
Test what happens when things go wrong:
- Send a very long message (500+ words)
- Send just an emoji with no text
- Send a location pin
- Send a voice note
- Ask about something unrelated to travel ("what's the weather in my city?")
- Contradict a saved preference ("actually I hate boutique hotels")
- Ask the agent to do something it can't ("book me a table at Noma")
→ Does every scenario get a graceful response?
→ Does any scenario cause a crash or timeout?
```

### Conversation 5: Edge cases
```
- Plan a trip for tomorrow (very short notice)
- Plan a trip for 6 months from now (far future — prices may not be available)
- Plan a domestic trip (no flights needed)
- Ask to modify day 3 of an existing plan
- Say "actually, change the whole trip to Bali instead"
→ Does the agent handle all of these reasonably?
```

### What to log during self-testing
For every conversation, note:
- Response latency (per message)
- Any errors or awkward moments
- Whether preferences were correctly remembered
- Whether recommendations were specific (named venues) vs. generic
- Whether deep links worked on mobile
- Token usage (check logs)
- Anything that made you think "a real user would bail here"

---

## Phase B: Beta Testing with Real Users (Days 4–14)

### Recruiting beta testers
Find 5-10 people who match this profile:
- Plans 2+ trips per year
- Comfortable with WhatsApp
- Has at least one loyalty program
- Currently has a trip they're thinking about (real intent, not hypothetical)
- Mix of: solo travelers, couples, families, business travelers

Where to find them:
- r/travel, r/churning, r/awardtravel (loyalty/points enthusiasts are ideal early adopters)
- FlyerTalk forums
- Twitter/X travel communities
- Friends of friends who are "the travel planner" in their group

### What to tell them
"I'm building an AI travel agent on WhatsApp. It plans trips, remembers your preferences, searches real prices, and can book flights. It's in beta — I'd love for you to plan a real trip you're considering. Just message this number: [number]. I'll follow up in a few days to hear what worked and what didn't."

Don't over-explain features. Don't tell them about memory or skills or context engineering. Let them discover it organically. The product should explain itself.

### What to track per tester

| Metric | How to Measure |
|--------|---------------|
| First response quality | Did they continue the conversation after the agent's first reply? |
| Conversation depth | How many messages before they dropped off? |
| Plan completion | Did the agent generate a full itinerary? |
| Booking intent | Did they tap any booking links? |
| Return rate | Did they come back for a second conversation? |
| Preference accuracy | On return visit, were recommendations personalized correctly? |
| Unprompted feedback | Did they say anything positive or negative without being asked? |
| Failure points | Where exactly did they get stuck or frustrated? |

### The follow-up conversation (Day 7)
Message each tester:
1. "How was the experience compared to how you normally plan trips?"
2. "Was there a moment where you thought 'this is better than doing it myself'?"
3. "Was there a moment where you thought 'this is worse than doing it myself'?"
4. "Would you use this for your next real trip? If not, what's missing?"
5. "What would make you pay for this?"

Question 2 tells you your value proposition.
Question 3 tells you what to fix next.
Question 5 tells you your business model.

---

## Phase C: Deciding What's Next (Day 14+)

After 2 weeks of beta testing, you'll have data. Here's how to interpret it:

### Signal → Action mapping

**If users love the planning but don't tap booking links:**
The value is in the plan, not the booking. Double down on plan quality — richer itineraries, better venue verification, the web companion with maps. Booking can stay as deep links.

**If users keep asking "can it connect to X?":**
That's the skills signal. Prioritize the specific integration they're asking about. Pull out the skills architecture doc and build that one integration.

**If users drop off after 2-3 messages:**
The onboarding isn't compelling enough, or the agent is too slow, or the responses feel too generic. Review the conversation logs and find the exact drop-off point. Fix that specific moment.

**If users come back for a second trip and say "it remembered me!":**
The memory system is working. This is your viral moment. Make it shareable — "My AI travel agent knows I like boutique hotels and window seats. What does yours know about you?"

**If users say "I'd use this if it could actually book hotels":**
That's the signal to either re-enable browser automation for the highest-demand provider or push hard on getting direct API partnerships with hotel chains.

**If users say "this is cool but I'd just use ChatGPT":**
The differentiation isn't landing. The gap isn't visceral enough. Audit: is the memory visible? Are the search results actually live (not hallucinated)? Are the booking links actually pre-filled? If any of these are broken, fix them. If they're all working and users still say this, the product needs a rethink.

---

## Phase D: Skills (When Ready)

When beta testing produces clear signals that users want extensibility, pull out `docs/SKILLS-ARCHITECTURE.md` and build in this order:

1. **Loyalty programs** (no OAuth, no API, just structured preference storage done right — probably already 80% there)
2. **Google Calendar** (first real OAuth integration, highest frequency ask)
3. **MCP client** (only when a developer or B2B partner explicitly asks to integrate)

Do NOT build the skill marketplace, the skill catalog UI, or the Notion/email integrations until you have at least 1,000 active users asking for them.

---

## The One Metric That Matters Right Now

**Second-session return rate.**

If a user comes back and plans a second trip, you've won. They've seen the memory work, they trust the agent, and they've decided it's better than doing it themselves. Track this number obsessively. Everything you build should be in service of making this number go up.

A user who plans one trip and never comes back gave you a compliment. A user who plans two trips gave you a business.