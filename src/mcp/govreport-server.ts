/**
 * GovReport tool server.
 *
 * Searches the launch/gov_report dataset on HuggingFace Datasets Server.
 * Contains ~19,000 US government reports (GAO, CRS, CDC, OMB).
 * No authentication required for public datasets.
 */

interface GovReportRow {
  title?: string;
  input?: string; // full report text
  output?: string; // human-written summary
}

interface HFSearchResponse {
  rows?: Array<{ row?: GovReportRow }>;
  num_rows_total?: number;
}

interface GovReportResult {
  title: string;
  summary: string;
  full_text_excerpt: string;
  source_url: string;
}

const DATASET_SOURCE_URL = 'https://huggingface.co/datasets/launch/gov_report';

export async function govreportHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 5;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const url = new URL('https://datasets-server.huggingface.co/search');
  url.searchParams.set('dataset', 'launch/gov_report');
  url.searchParams.set('config', 'default');
  url.searchParams.set('split', 'train');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(Math.min(maxResults, 10)));

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  // Gracefully handle non-200 (e.g. dataset index not ready)
  if (!response.ok) {
    return {
      results: [],
      query,
      total: 0,
      note: `HuggingFace search returned ${String(response.status)}`,
    };
  }

  let data: HFSearchResponse;
  try {
    data = (await response.json()) as HFSearchResponse;
  } catch {
    return { results: [], query, total: 0, note: 'Failed to parse HuggingFace response' };
  }

  const rows = data.rows ?? [];

  const results: GovReportResult[] = rows
    .map((r) => r.row)
    .filter((row): row is GovReportRow => row !== undefined)
    .map((row) => {
      const inputText = row.input ?? '';
      const title =
        typeof row.title === 'string' && row.title.length > 0
          ? row.title
          : inputText.slice(0, 80).replace(/\n/g, ' ').trim();

      return {
        title,
        summary: row.output ?? '',
        full_text_excerpt: inputText.slice(0, 2000),
        source_url: DATASET_SOURCE_URL,
      };
    });

  return { results, query, total: results.length };
}
