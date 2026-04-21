/**
 * Government report search — queries GAO, CBO, and CRS directly via web search
 * filtered to authoritative government domains.
 *
 * Replaces the defunct HuggingFace gov_report dataset endpoint.
 */

import { geminiSearchHandler } from './gemini-search-server';

const GOV_REPORT_SITES = 'site:gao.gov OR site:cbo.gov OR site:crs.gov OR site:huduser.gov OR site:nlihc.org';

export async function govreportHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 5;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  // Delegate to web search with a government-site filter
  const result = await geminiSearchHandler({
    query: `${query} ${GOV_REPORT_SITES}`,
    max_results: maxResults,
  });

  return { ...result, source: 'gov_report_search' };
}
