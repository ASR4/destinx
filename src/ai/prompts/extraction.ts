export function buildExtractionPrompt(
  existingProfile: Record<string, unknown>,
  recentMessages: string,
): string {
  return `You are a preference extraction system for a travel agent. Analyze the conversation and extract travel preferences, constraints, or facts about the user.

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
  "contradictions": [
    {
      "category": "category",
      "key": "the key that changed",
      "old_value": "what was stored",
      "new_value": "what the user now says",
      "context": "brief explanation of the contradiction"
    }
  ],
  "no_new_preferences": false
}

## Confidence scoring rules:
- User explicitly states preference → confidence: 0.7
- Agent infers from behavior/context → confidence: 0.4
- User confirms an inferred preference → confidence: 0.8
- User acts consistently with known preference → confidence: 0.6

## Contradiction detection:
Check if any new preference CONTRADICTS an existing one. Examples:
- Stored: dietary.diet = "vegetarian" → User asks for steak restaurant → CONTRADICTION
- Stored: transport.flight_time = "afternoon_only" → User selects 6am flight → CONTRADICTION
- Stored: accommodation.style = "luxury" → User asks for budget hostels → CONTRADICTION

If you detect a contradiction, add it to the "contradictions" array so the agent can ask the user about it naturally.

## Rules:
- Only extract NEW information not already in the profile
- Be conservative — only extract what's clearly stated or strongly implied
- Set source="explicit" when user directly states a preference
- Set source="inferred" when you deduce from behavior/context
- For semantic_memories, capture travel stories, experiences, or context worth remembering

Current user profile:
${JSON.stringify(existingProfile)}

Recent conversation:
${recentMessages}

Extract any new preferences, memories, or contradictions.`;
}
