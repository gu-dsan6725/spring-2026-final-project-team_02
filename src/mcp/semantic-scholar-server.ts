/**
 * Semantic Scholar Academic Graph API tool server.
 *
 * Searches for academic papers in economics, public health, and political science.
 * No authentication required for basic use.
 */

interface S2Paper {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  authors?: Array<{ name?: string }>;
  citationCount?: number;
  openAccessPdf?: { url?: string } | null;
}

interface S2SearchResponse {
  data?: S2Paper[];
  total?: number;
}

interface SemanticScholarResult {
  title: string;
  abstract: string;
  year: number | null;
  authors: string[];
  citation_count: number;
  pdf_url: string | null;
  source_url: string;
}

export async function semanticScholarHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 10;
  let fieldsOfStudy = '';
  if (Array.isArray(input.fields_of_study)) {
    fieldsOfStudy = (input.fields_of_study as string[]).join(',');
  } else if (typeof input.fields_of_study === 'string' && input.fields_of_study.length > 0) {
    // LLMs sometimes JSON-encode array parameters as a string — parse and recover
    try {
      const parsed: unknown = JSON.parse(input.fields_of_study);
      if (Array.isArray(parsed)) {
        fieldsOfStudy = (parsed as string[]).join(',');
      }
    } catch {
      // unparseable string — ignore the filter
    }
  }

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(Math.min(maxResults, 20)));
  url.searchParams.set(
    'fields',
    'title,abstract,year,authors,externalIds,openAccessPdf,citationCount',
  );
  if (fieldsOfStudy.length > 0) {
    url.searchParams.set('fieldsOfStudy', fieldsOfStudy);
  }

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (response.status !== 429) break;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }

  if (response === undefined || !response.ok) {
    const status = response?.status ?? 0;
    if (status === 429) {
      return { error: 'Semantic Scholar rate limit exceeded. Use arxiv_search or web_search instead.' };
    }
    return { error: `Semantic Scholar API error: ${String(status)}` };
  }

  const data = (await response.json()) as S2SearchResponse;
  const papers = data.data ?? [];

  const results: SemanticScholarResult[] = papers.map((p) => ({
    title: p.title ?? '',
    abstract: p.abstract ?? '',
    year: p.year ?? null,
    authors: (p.authors ?? []).map((a) => a.name ?? '').filter((n) => n.length > 0),
    citation_count: p.citationCount ?? 0,
    pdf_url: p.openAccessPdf?.url ?? null,
    source_url:
      p.paperId !== undefined && p.paperId.length > 0
        ? `https://www.semanticscholar.org/paper/${p.paperId}`
        : 'https://www.semanticscholar.org',
  }));

  return { results, query, total: results.length };
}
