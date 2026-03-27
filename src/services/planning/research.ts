import { logger } from '../../utils/logger.js';
import { webSearch } from '../tools/web-search.js';

export interface DestinationResearch {
  overview: string;
  bestTimeToVisit: string;
  currency: string;
  language: string;
  visaRequirements?: string;
  upcomingEvents: string[];
  travelAdvisories: string[];
  avgCosts: {
    meal_budget: number;
    meal_midrange: number;
    meal_fine_dining: number;
    hotel_budget: number;
    hotel_midrange: number;
    hotel_luxury: number;
    local_transport_day: number;
  };
}

/**
 * Research a destination using multiple Brave Search queries.
 * Runs searches in parallel and aggregates results into structured data
 * that the planning engine can use for trip generation.
 */
export async function researchDestination(
  destination: string,
  travelDates?: { start: string; end: string },
): Promise<DestinationResearch> {
  logger.info({ destination, travelDates }, 'Researching destination via Brave Search');

  const dateContext = travelDates
    ? ` ${travelDates.start} to ${travelDates.end}`
    : '';

  const [
    overviewResults,
    costResults,
    eventResults,
    advisoryResults,
    practicalResults,
  ] = await Promise.all([
    webSearch(`${destination} travel guide overview best time to visit`, { count: 3 }),
    webSearch(`${destination} travel costs budget average meal hotel prices 2026`, { count: 3 }),
    webSearch(`${destination} events festivals${dateContext}`, {
      count: 3,
      freshness: 'pm',
    }),
    webSearch(`${destination} travel advisory safety tips${dateContext}`, {
      count: 3,
      freshness: 'pm',
    }),
    webSearch(`${destination} currency language visa requirements for travelers`, { count: 3 }),
  ]);

  const overviewSnippets = flattenSnippets(overviewResults);
  const costSnippets = flattenSnippets(costResults);
  const practicalSnippets = flattenSnippets(practicalResults);

  return {
    overview: overviewSnippets[0] ?? `${destination} — travel information`,
    bestTimeToVisit: extractPattern(overviewSnippets, /best time.*?(?:is|are)\s+([^.]+)/i) ?? 'Year-round',
    currency: extractPattern(practicalSnippets, /(?:currency|currencies).*?(?:is|are)\s+([^.,]+)/i) ?? 'Local currency',
    language: extractPattern(practicalSnippets, /(?:language|languages).*?(?:is|are|spoken)\s+([^.,]+)/i) ?? 'Local language',
    visaRequirements: extractPattern(practicalSnippets, /visa.*?([^.]+)/i),
    upcomingEvents: eventResults
      .map((r) => r.snippet)
      .filter(Boolean)
      .slice(0, 5),
    travelAdvisories: advisoryResults
      .map((r) => r.snippet)
      .filter(Boolean)
      .slice(0, 3),
    avgCosts: parseCosts(costSnippets),
  };
}

function flattenSnippets(
  results: Array<{ snippet: string; extraSnippets?: string[] }>,
): string[] {
  return results.flatMap((r) => [r.snippet, ...(r.extraSnippets ?? [])]).filter(Boolean);
}

function extractPattern(texts: string[], pattern: RegExp): string | undefined {
  for (const text of texts) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function parseCosts(snippets: string[]): DestinationResearch['avgCosts'] {
  const allText = snippets.join(' ').toLowerCase();
  const defaults = {
    meal_budget: 10,
    meal_midrange: 25,
    meal_fine_dining: 75,
    hotel_budget: 50,
    hotel_midrange: 120,
    hotel_luxury: 300,
    local_transport_day: 15,
  };

  const priceMatches = allText.match(/\$\s*(\d+(?:\.\d{2})?)/g) ?? [];
  const prices = priceMatches
    .map((m) => parseFloat(m.replace('$', '').trim()))
    .filter((p) => p > 0 && p < 10000)
    .sort((a, b) => a - b);

  if (prices.length >= 3) {
    defaults.meal_budget = Math.round(prices[0]!);
    defaults.meal_midrange = Math.round(prices[Math.floor(prices.length / 3)]!);
    defaults.hotel_midrange = Math.round(prices[Math.floor(prices.length * 2 / 3)]!);
  }

  return defaults;
}
