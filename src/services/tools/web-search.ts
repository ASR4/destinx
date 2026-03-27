import { logger } from '../../utils/logger.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web using the Brave Search API.
 * Used by the planning engine and as a Claude tool.
 */
export async function webSearch(
  query: string,
  options?: { count?: number; freshness?: 'day' | 'week' | 'month' },
): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    logger.error('BRAVE_SEARCH_API_KEY not set');
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options?.count ?? 5),
  });
  if (options?.freshness) {
    params.set('freshness', options.freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Brave Search API error');
      return [];
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  } catch (err) {
    logger.error({ err }, 'Web search failed');
    return [];
  }
}
