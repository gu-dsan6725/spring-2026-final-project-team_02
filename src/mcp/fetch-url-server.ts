/**
 * URL fetch tool server.
 *
 * Retrieves the text content of a URL. Strips HTML tags for cleaner output.
 * Used primarily so the agent can read known_sources URLs provided by the user.
 */

export async function fetchUrlHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const maxChars = typeof input.max_chars === 'number' ? Math.min(input.max_chars, 12000) : 8000;

  if (url.length === 0) {
    return { error: 'url is required' };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'policy-memo-agent/0.1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return {
      error: `Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`,
      url,
    };
  }

  if (!response.ok) {
    return { error: `HTTP ${String(response.status)} ${response.statusText}`, url };
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/pdf')) {
    // PDF: can't extract text directly — return metadata and instruct agent to summarise
    return {
      url,
      content:
        '[PDF document — direct text extraction unavailable. ' +
        'The URL was fetched successfully. ' +
        'Use web_search with the document title to find cached HTML versions or summaries.]',
      content_type: contentType,
      is_pdf: true,
    };
  }

  const raw = await response.text();

  // Strip scripts, styles, and HTML tags; normalise whitespace
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const content = stripped.slice(0, maxChars);

  return {
    url,
    content,
    content_type: contentType,
    char_count: content.length,
    truncated: stripped.length > maxChars,
  };
}
