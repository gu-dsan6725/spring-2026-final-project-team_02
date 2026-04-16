/**
 * GovInfo API tool server.
 *
 * Wraps the US Government Publishing Office API for Congressional Research
 * Service reports, GAO analyses, and other government publications.
 * Requires: GOVINFO_API_KEY in environment.
 */

interface GovInfoSearchResult {
  packageId?: string;
  title?: string;
  dateIssued?: string;
  governmentAuthor?: string[];
}

interface GovInfoSearchResponse {
  results?: GovInfoSearchResult[];
}

interface GovInfoSummary {
  title?: string;
  dateIssued?: string;
  governmentAuthor?: string[];
  download?: { txtLink?: string };
}

interface GovInfoResult {
  packageId: string;
  title: string;
  date: string;
  authors: string[];
  excerpt: string;
  source_url: string;
}

const VALID_COLLECTIONS = new Set(['CRS', 'GAO', 'BILLS', 'FR', 'BUDGET']);

export async function govinfoHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const rawCollection =
    typeof input.collection === 'string' ? input.collection.toUpperCase() : 'CRS';
  const collection = VALID_COLLECTIONS.has(rawCollection) ? rawCollection : 'CRS';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 5;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const apiKey = process.env.GOVINFO_API_KEY ?? '';
  if (apiKey.length === 0) {
    return { error: 'GOVINFO_API_KEY is not set' };
  }

  // Step 1: Search (GovInfo requires POST for /search)
  const searchUrl = `https://api.govinfo.gov/search?api_key=${apiKey}`;

  const searchResponse = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query,
      pageSize: Math.min(maxResults, 10),
      offsetMark: '*',
      filters: { collectionCode: [collection] },
    }),
  });

  if (!searchResponse.ok) {
    return { error: `GovInfo search error: ${String(searchResponse.status)}` };
  }

  const searchData = (await searchResponse.json()) as GovInfoSearchResponse;
  const searchResults = searchData.results ?? [];

  if (searchResults.length === 0) {
    return { results: [], query, collection, total: 0 };
  }

  // Step 2: Fetch summaries (up to 3 to avoid rate limiting)
  const results: GovInfoResult[] = [];

  for (const sr of searchResults.slice(0, 3)) {
    const packageId = sr.packageId ?? '';
    if (packageId.length === 0) continue;

    const summaryUrl = `https://api.govinfo.gov/packages/${encodeURIComponent(packageId)}/summary?api_key=${apiKey}`;
    let excerpt = '';

    try {
      const summaryResponse = await fetch(summaryUrl, { headers: { Accept: 'application/json' } });

      if (summaryResponse.ok) {
        const summary = (await summaryResponse.json()) as GovInfoSummary;

        // Step 3: Fetch text content if available (first 3000 chars)
        const txtLink = summary.download?.txtLink ?? '';
        if (txtLink.length > 0) {
          try {
            const txtResponse = await fetch(`${txtLink}?api_key=${apiKey}`);
            if (txtResponse.ok) {
              const text = await txtResponse.text();
              excerpt = text.slice(0, 3000);
            }
          } catch {
            // Text fetch failed — continue without excerpt
          }
        }

        results.push({
          packageId,
          title: summary.title ?? sr.title ?? packageId,
          date: summary.dateIssued ?? sr.dateIssued ?? '',
          authors: summary.governmentAuthor ?? sr.governmentAuthor ?? [],
          excerpt,
          source_url: `https://www.govinfo.gov/content/pkg/${packageId}/html/${packageId}.htm`,
        });
      }
    } catch {
      // Summary fetch failed — skip this result
    }
  }

  return { results, query, collection, total: results.length };
}
