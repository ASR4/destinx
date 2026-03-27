export function buildExtractionPrompt(
  existingProfile: Record<string, unknown>,
  recentMessages: string,
): string {
  return `You are a preference extraction system. Analyze the conversation and extract any travel preferences, constraints, or facts about the user.

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
Be conservative — only extract what's clearly stated or strongly implied.

Current user profile:
${JSON.stringify(existingProfile)}

Recent conversation:
${recentMessages}

Extract any new preferences or memories.`;
}
