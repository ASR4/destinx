import { logger } from '../../utils/logger.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
  age?: string;
}

export interface WebSearchOptions {
  count?: number;
  freshness?: 'pd' | 'pw' | 'pm' | 'py' | string;
  country?: string;
  resultFilter?: string;
  location?: {
    lat?: number;
    long?: number;
    city?: string;
    state?: string;
    country?: string;
  };
}

const FRESHNESS_ALIASES: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

/**
 * Search the web using the Brave Search API.
 * Auth via x-subscription-token header.
 * See: https://api-dashboard.search.brave.com/api-reference/web/search/get
 */
export async function webSearch(
  query: string,
  options?: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    logger.error('BRAVE_SEARCH_API_KEY not set');
    return [];
  }

  const params = new URLSearchParams({
    q: query.slice(0, 400),
    count: String(Math.min(options?.count ?? 5, 20)),
    extra_snippets: 'true',
    text_decorations: 'false',
    spellcheck: 'true',
    result_filter: 'web',  // only fetch web results — we don't use news/discussions
  });

  if (options?.freshness) {
    const mapped = FRESHNESS_ALIASES[options.freshness] ?? options.freshness;
    params.set('freshness', mapped);
  }

  if (options?.country) {
    params.set('country', options.country.toUpperCase());
  }

  if (options?.resultFilter) {
    params.set('result_filter', options.resultFilter);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Subscription-Token': apiKey,
  };

  if (options?.location) {
    if (options.location.lat != null) headers['x-loc-lat'] = String(options.location.lat);
    if (options.location.long != null) headers['x-loc-long'] = String(options.location.long);
    if (options.location.city) headers['x-loc-city'] = options.location.city;
    if (options.location.state) headers['x-loc-state'] = options.location.state;
    if (options.location.country) headers['x-loc-country'] = options.location.country;
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      { headers },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      logger.error({ status: response.status, code: body?.error?.code }, 'Brave Search API error');
      return [];
    }

    const data = (await response.json()) as BraveSearchResponse;

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? '',
      extraSnippets: r.extra_snippets,
      age: r.age,
    }));
  } catch (err) {
    logger.error({ err }, 'Web search failed');
    return [];
  }
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description: string | null;
      extra_snippets?: string[];
      age?: string;
    }>;
  };
  query?: {
    original: string;
    altered?: string;
    spellcheck_off?: boolean;
  };
}
