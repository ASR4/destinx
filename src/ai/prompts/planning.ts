import type { UserProfile } from '../../types/memory.js';
import type { PlanInput } from '../../types/trip.js';
import type { DestinationResearch } from '../../services/planning/research.js';

export function buildPlanningPrompt(
  input: PlanInput,
  userProfile: UserProfile | null,
  research?: DestinationResearch,
): string {
  return `You are generating a detailed day-by-day travel itinerary.

## Trip Details
- Destination: ${input.destination}
- Dates: ${input.startDate} to ${input.endDate}
- Travelers: ${input.travelers ? JSON.stringify(input.travelers) : 'Not specified'}
- Budget: ${input.budgetTotal ? `${input.budgetTotal} ${input.currency || 'USD'}` : 'Not specified'}
- Pace: ${input.pace || 'balanced'}
- Interests: ${input.interests?.join(', ') || 'General sightseeing'}
- Must-do: ${input.mustDos?.join(', ') || 'None specified'}
- Avoid: ${input.avoid?.join(', ') || 'Nothing specified'}

${userProfile ? `## Traveler Preferences\n${JSON.stringify(userProfile.preferences, null, 2)}` : ''}

${research ? `## Destination Research
- Overview: ${research.overview}
- Best time to visit: ${research.bestTimeToVisit}
- Currency: ${research.currency}
- Language: ${research.language}
${research.visaRequirements ? `- Visa: ${research.visaRequirements}` : ''}
- Average costs: Budget meal ~$${research.avgCosts.meal_budget}, Mid-range meal ~$${research.avgCosts.meal_midrange}, Budget hotel ~$${research.avgCosts.hotel_budget}/night, Mid-range hotel ~$${research.avgCosts.hotel_midrange}/night
${research.upcomingEvents.length > 0 ? `- Upcoming events/festivals:\n${research.upcomingEvents.map((e) => `  • ${e}`).join('\n')}` : ''}
${research.travelAdvisories.length > 0 ? `- Travel advisories:\n${research.travelAdvisories.map((a) => `  • ${a}`).join('\n')}` : ''}
Use these facts to ground your recommendations in reality.` : ''}

## Output Format
Create a structured itinerary with the following JSON shape for each day:
{
  "date": "YYYY-MM-DD",
  "day_number": 1,
  "theme": "Short theme for the day",
  "items": [
    {
      "time": "HH:MM",
      "type": "experience|restaurant|transport|free_time",
      "name": "Venue/activity name",
      "description": "Brief description",
      "duration_min": 120,
      "price": { "amount": 25, "currency": "USD" },
      "notes": "Optional tips"
    }
  ],
  "accommodation": {
    "name": "Hotel name",
    "check_in": true,
    "loyalty_program": "Program name if applicable"
  },
  "day_total": { "amount": 150, "currency": "USD" }
}

## Rules
- Use REAL venues, restaurants, and activities. Verify with search tools.
- Include practical logistics (transport between locations, estimated travel times)
- Balance activity with downtime based on the pace preference
- Factor in opening hours and best times to visit
- Account for meal times naturally
- Suggest specific dishes at restaurants when possible
- Note any advance booking requirements
`;
}
