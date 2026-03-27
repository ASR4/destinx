export function buildClarificationPrompt(
  knownInfo: Record<string, unknown>,
  missingFields: string[],
): string {
  return `The user wants to plan a trip. Based on what we know so far, generate 2-3 natural clarifying questions to fill in the gaps.

## What we know
${JSON.stringify(knownInfo, null, 2)}

## Missing information
${missingFields.join(', ')}

## Rules
- Ask maximum 2-3 questions at a time
- Make questions conversational, not like a form
- Offer options when possible ("Are you thinking boutique hotel or something more casual?")
- Prioritize the most impactful missing info first
- If budget is unknown, ask indirectly through accommodation/experience style preferences
- Never ask "what's your budget?" directly

Return a natural WhatsApp-style message with the questions woven in.
`;
}
