/**
 * arXiv API tool server.
 *
 * Wraps the arXiv Atom feed API. Parses XML without external dependencies
 * using regex extraction — the Atom feed structure is predictable enough.
 */

interface ArxivResult {
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  pdf_url: string;
}

function extractTagContent(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = re.exec(xml);
  return match?.[1]?.trim() ?? '';
}

function extractAllTagContent(xml: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const content = match[1].trim();
    if (content.length > 0) results.push(content);
  }
  return results;
}

function parseArxivEntry(entryXml: string): ArxivResult {
  const title = extractTagContent(entryXml, 'title').replace(/\s+/g, ' ');
  const abstract = extractTagContent(entryXml, 'summary').replace(/\s+/g, ' ');
  const published = extractTagContent(entryXml, 'published').slice(0, 10); // YYYY-MM-DD
  const idUrl = extractTagContent(entryXml, 'id');
  const pdfUrl = idUrl.replace('/abs/', '/pdf/');

  // Authors are in <author><name>...</name></author> blocks
  const authorBlocks = extractAllTagContent(entryXml, 'author');
  const authors = authorBlocks
    .map((block) => extractTagContent(block, 'name'))
    .filter((n) => n.length > 0);

  return { title, authors, abstract, published, pdf_url: pdfUrl };
}

export async function arxivHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 5;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const url = new URL('http://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `all:${query}`);
  url.searchParams.set('max_results', String(Math.min(maxResults, 10)));
  url.searchParams.set('sortBy', 'relevance');

  const response = await fetch(url.toString());

  if (!response.ok) {
    return { error: `arXiv API error: ${String(response.status)}` };
  }

  const xml = await response.text();

  // Extract <entry> blocks
  const entryBlocks = extractAllTagContent(xml, 'entry');
  const results: ArxivResult[] = entryBlocks.map(parseArxivEntry).filter((r) => r.title.length > 0);

  return { results, query, total: results.length };
}
