/**
 * Gemini Grounding Search tool server (free-tier alternative to Brave Search).
 *
 * Uses the Gemini REST API with Google Search grounding to answer a query and
 * return structured search results including grounding chunks (the actual web
 * sources Gemini retrieved and cited).
 *
 * Free tier: gemini-2.0-flash with google_search tool, no billing required.
 * Requires: GEMINI_API_KEY in environment (Google AI Studio key).
 *
 * Output shape mirrors web-search-server.ts so it can be used as a drop-in
 * replacement in the tool registry.
 */

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Gemini REST API types (minimal — only what we use)
// ---------------------------------------------------------------------------

interface GeminiGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface GeminiGroundingSupport {
  segment?: {
    text?: string;
  };
  groundingChunkIndices?: number[];
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
}

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  groundingMetadata?: GeminiGroundingMetadata;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Calls Gemini with google_search grounding and extracts grounding chunks as
 * structured web search results.
 *
 * Strategy:
 * 1. Send the query to Gemini with the built-in google_search tool enabled.
 * 2. Parse `groundingMetadata.groundingChunks` — these are the actual web
 *    sources Gemini retrieved and cited. Each chunk has a URI and title.
 * 3. For the snippet, find the `groundingSupports` segment that cites each
 *    chunk (the text Gemini generated that is attributed to that source).
 * 4. Fall back to the full generated text when no per-chunk snippet exists.
 */
export async function geminiSearchHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query : '';
  const maxResults = typeof input.max_results === 'number' ? input.max_results : 10;

  if (query.length === 0) {
    return { error: 'query is required' };
  }

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (apiKey.length === 0) {
    return { error: 'GEMINI_API_KEY is not set' };
  }

  // gemini-2.0-flash is free-tier eligible and supports google_search grounding.
  const model = 'gemini-2.0-flash';
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: query }],
      },
    ],
    tools: [
      {
        // Built-in Google Search grounding — no extra setup required.
        google_search: {},
      },
    ],
    generationConfig: {
      // Keep the generative answer short; we care about groundingChunks, not prose.
      maxOutputTokens: 512,
      temperature: 0.1,
    },
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Network error calling Gemini API: ${message}` };
  }

  let data: GeminiResponse;
  try {
    data = (await response.json()) as GeminiResponse;
  } catch {
    return { error: `Failed to parse Gemini API response (status ${String(response.status)})` };
  }

  if (!response.ok || data.error !== undefined) {
    const msg = data.error?.message ?? response.statusText;
    return { error: `Gemini API error ${String(response.status)}: ${msg}` };
  }

  const candidate = data.candidates?.[0];
  if (candidate === undefined) {
    return { error: 'Gemini returned no candidates' };
  }

  const groundingChunks = candidate.groundingMetadata?.groundingChunks ?? [];
  const groundingSupports = candidate.groundingMetadata?.groundingSupports ?? [];
  const generatedText = candidate.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  // Build a map: chunkIndex → best snippet (the grounding support text that
  // cites this chunk most directly).
  const snippetByChunkIndex = new Map<number, string>();
  for (const support of groundingSupports) {
    const text = support.segment?.text ?? '';
    for (const idx of support.groundingChunkIndices ?? []) {
      if (!snippetByChunkIndex.has(idx)) {
        snippetByChunkIndex.set(idx, text);
      }
    }
  }

  const results: WebSearchResult[] = groundingChunks
    .slice(0, maxResults)
    .map((chunk, idx) => ({
      title: chunk.web?.title ?? `Result ${String(idx + 1)}`,
      url: chunk.web?.uri ?? '',
      snippet: snippetByChunkIndex.get(idx) ?? generatedText.slice(0, 300),
    }))
    // Drop chunks with no URL (occasionally Gemini includes internal chunks).
    .filter((r) => r.url.length > 0);

  // If Gemini returned no grounding chunks (can happen for very rare queries),
  // return the generated text as a single synthetic result so callers always
  // get *something* back.
  if (results.length === 0 && generatedText.length > 0) {
    results.push({
      title: query,
      url: '',
      snippet: generatedText.slice(0, 500),
    });
  }

  return {
    results,
    query,
    total: results.length,
    // Pass the full generated answer through so callers can use it as context.
    generated_answer: generatedText,
  };
}
