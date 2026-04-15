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
  const fieldsOfStudy = Array.isArray(input.fields_of_study)
    ? (input.fields_of_study as string[]).join(',')
    : '';

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

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return { error: `Semantic Scholar API error: ${String(response.status)}` };
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
