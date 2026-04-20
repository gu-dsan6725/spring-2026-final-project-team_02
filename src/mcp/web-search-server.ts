/**
 * Web search tool server.
 *
 * Primary: Brave Search API (BRAVE_SEARCH_API_KEY).
 * Fallback: Gemini grounding search (GEMINI_API_KEY) when Brave key is absent.
 */

import { geminiSearchHandler } from './gemini-search-server';

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

export async function webSearchHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 10;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? '';
  if (apiKey.length === 0) {
    return geminiSearchHandler(input);
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(maxResults, 20)));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    return { error: `Brave Search API error: ${String(response.status)} ${response.statusText}` };
  }

  const data = (await response.json()) as BraveSearchResponse;
  const rawResults = data.web?.results ?? [];

  const results: WebSearchResult[] = rawResults.map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));

  return { results, query, total: results.length };
}
