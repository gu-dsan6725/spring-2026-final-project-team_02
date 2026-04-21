/**
 * GovInfo API tool server.
 *
 * Wraps the US Government Publishing Office API for GAO reports,
 * Congressional Reports, Bills, Federal Register, and Budget documents.
 * Requires: GOVINFO_API_KEY in environment.
 *
 * Collection code mapping:
 *   GAO    → GAOREPORTS  (Government Accountability Office reports)
 *   CRS    → CRPT        (Congressional Reports — includes CRS products)
 *   BILLS  → BILLS
 *   FR     → FR          (Federal Register)
 *   BUDGET → BUDGET
 */

interface GovInfoSearchResult {
  packageId?: string;
  title?: string;
  dateIssued?: string;
  governmentAuthor?: string[];
  collectionCode?: string;
  resultLink?: string;
  download?: {
    xmlLink?: string;
    zipLink?: string;
    modsLink?: string;
  };
}

interface GovInfoSearchResponse {
  count?: number;
  results?: GovInfoSearchResult[];
}

interface GovInfoSummary {
  title?: string;
  dateIssued?: string;
  governmentAuthor?: string[];
  shortTitle?: string;
  publisher?: string;
}

interface GovInfoResult {
  packageId: string;
  title: string;
  date: string;
  authors: string[];
  excerpt: string;
  source_url: string;
}

// Map user-facing collection names to actual GovInfo collection codes
const COLLECTION_CODE_MAP: Record<string, string> = {
  GAO: 'GAOREPORTS',
  CRS: 'CRPT',
  BILLS: 'BILLS',
  FR: 'FR',
  BUDGET: 'BUDGET',
  CHRG: 'CHRG',   // Congressional Hearings
  CMR: 'CMR',     // Congressionally Mandated Reports
};

const VALID_USER_COLLECTIONS = new Set(Object.keys(COLLECTION_CODE_MAP));

export async function govinfoHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const rawCollection =
    typeof input.collection === 'string' ? input.collection.toUpperCase() : 'GAO';
  const userCollection = VALID_USER_COLLECTIONS.has(rawCollection) ? rawCollection : 'GAO';
  const collectionCode = COLLECTION_CODE_MAP[userCollection] ?? 'GAOREPORTS';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 5;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const apiKey = process.env.GOVINFO_API_KEY ?? '';
  if (apiKey.length === 0) {
    return { error: 'GOVINFO_API_KEY is not set' };
  }

  const pageSize = Math.min(maxResults, 10);

  // Use filters object (not query-string injection) for collection filtering
  const searchBody = {
    query,
    pageSize,
    offsetMark: '*',
    sorts: [{ field: 'dateIssued', sortOrder: 'DESC' }],
    filters: { collectionCode: [collectionCode] },
  };

  const searchUrl = `https://api.govinfo.gov/search?api_key=${apiKey}`;

  const searchResponse = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchBody),
  });

  if (!searchResponse.ok) {
    return {
      error: `GovInfo search error: ${String(searchResponse.status)} ${searchResponse.statusText}`,
    };
  }

  const searchData = (await searchResponse.json()) as GovInfoSearchResponse;
  const searchResults = searchData.results ?? [];

  if (searchResults.length === 0) {
    return { results: [], query, collection: userCollection, total: 0 };
  }

  // Fetch summaries + attempt text content (up to 3 to avoid rate limits)
  const results: GovInfoResult[] = [];

  for (const sr of searchResults.slice(0, 3)) {
    const packageId = sr.packageId ?? '';
    if (packageId.length === 0) continue;

    let title = sr.title ?? packageId;
    let authors: string[] = sr.governmentAuthor ?? [];
    let excerpt = '';

    // Try fetching the HTML rendition directly — most readable for text extraction
    const htmlUrl = `https://www.govinfo.gov/content/pkg/${packageId}/html/${packageId}.htm`;
    try {
      const htmlRes = await fetch(`${htmlUrl}?api_key=${apiKey}`, {
        headers: { Accept: 'text/html' },
      });
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        // Strip tags and grab first 3000 chars of content
        excerpt = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .trim()
          .slice(0, 3000);
      }
    } catch {
      // HTML fetch failed — try summary for metadata at least
    }

    // If no HTML text, fall back to summary metadata
    if (excerpt.length === 0) {
      try {
        const summaryUrl = `https://api.govinfo.gov/packages/${encodeURIComponent(packageId)}/summary?api_key=${apiKey}`;
        const summaryRes = await fetch(summaryUrl, { headers: { Accept: 'application/json' } });
        if (summaryRes.ok) {
          const summary = (await summaryRes.json()) as GovInfoSummary;
          title = summary.title ?? title;
          authors = summary.governmentAuthor ?? authors;
        }
      } catch {
        // skip
      }
    }

    results.push({
      packageId,
      title,
      date: sr.dateIssued ?? '',
      authors,
      excerpt,
      source_url: `https://www.govinfo.gov/content/pkg/${packageId}/html/${packageId}.htm`,
    });
  }

  return { results, query, collection: userCollection, total: results.length };
}
