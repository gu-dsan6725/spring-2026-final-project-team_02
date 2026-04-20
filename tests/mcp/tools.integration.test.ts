/**
 * Integration tests for all 8 MCP tool handlers.
 *
 * These tests hit real external APIs — they are NOT mocked.
 * They verify that each tool can actually retrieve data from its endpoint
 * and that the response shape matches what the agent expects.
 *
 * Prerequisites by tool:
 *   - arxiv_search         : no key required
 *   - worldbank_data       : no key required
 *   - govreport_search     : no key required
 *   - semantic_scholar_search : no key required
 *   - read_uploaded_file   : no key required (uses a temp file created by the test)
 *   - web_search           : BRAVE_SEARCH_API_KEY
 *   - govinfo_search       : GOVINFO_API_KEY
 *   - fred_data            : FRED_API_KEY
 *
 * Run all integration tests:
 *   npm run test:integration
 *
 * Run only the no-key tests (safe in CI without secrets):
 *   npx vitest run tests/mcp/tools.integration.test.ts -t "no-key"
 *
 * Run only tests that need keys (set env vars first):
 *   npx vitest run tests/mcp/tools.integration.test.ts -t "requires-key"
 *
 * Timeout: 30 s per test (external APIs can be slow).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callTool } from '../../src/mcp/tool-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Skip a test when the given env var is not set. */
function requiresKey(varName: string): boolean {
  const val = process.env[varName] ?? '';
  if (val.length === 0) {
    console.warn(`  [SKIPPED] ${varName} is not set — skipping this test.`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// arXiv Search  (no key required)
// ---------------------------------------------------------------------------

// Run sequentially to avoid 429 rate-limiting from rapid-fire requests.
describe('[no-key] arxiv_search', { sequential: true }, () => {
  it('returns results array with expected fields', async () => {
    const result = await callTool('arxiv_search', {
      query: 'universal basic income Africa',
      max_results: 3,
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('query', 'universal basic income Africa');
    expect(result).toHaveProperty('total');

    const results = result['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);

    const first = results[0] as Record<string, unknown>;
    expect(typeof first['title']).toBe('string');
    expect((first['title'] as string).length).toBeGreaterThan(0);
    expect(Array.isArray(first['authors'])).toBe(true);
    expect(typeof first['abstract']).toBe('string');
    expect(typeof first['published']).toBe('string');
    // published should be YYYY-MM-DD
    expect(/^\d{4}-\d{2}-\d{2}$/.test(first['published'] as string)).toBe(true);
    expect(typeof first['pdf_url']).toBe('string');
    expect(first['pdf_url'] as string).toContain('arxiv.org');
  });

  // Input validation — does not hit the network
  it('returns error when query is empty', async () => {
    const result = await callTool('arxiv_search', { query: '' });
    expect(result).toHaveProperty('error');
  });

  // max_results capping is enforced in the URL params — verified via a live call
  it('caps results at 10', async () => {
    const result = await callTool('arxiv_search', {
      query: 'climate change mitigation',
      max_results: 50,
    });

    expect(result).not.toHaveProperty('error');
    const results = result['results'] as unknown[];
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// World Bank Data  (no key required)
// ---------------------------------------------------------------------------

describe('[no-key] worldbank_data', () => {
  it('returns time-series observations for a known indicator', async () => {
    // NY.GDP.MKTP.CD = GDP (current US$), US
    const result = await callTool('worldbank_data', {
      indicator: 'NY.GDP.MKTP.CD',
      country: 'US',
      date_range: '2018:2022',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('indicator');
    expect(result).toHaveProperty('country');
    expect(result).toHaveProperty('observations');
    expect(result).toHaveProperty('source_url');

    const obs = result['observations'] as Array<{ year: string; value: number | null }>;
    expect(Array.isArray(obs)).toBe(true);
    expect(obs.length).toBeGreaterThan(0);

    const first = obs[0];
    expect(typeof first.year).toBe('string');
    expect(/^\d{4}$/.test(first.year)).toBe(true);
    // Observations are filtered to non-null values, so value should be a number
    expect(typeof first.value).toBe('number');

    // source_url should reference the indicator code
    expect(result['source_url'] as string).toContain('NY.GDP.MKTP.CD');
  });

  it('returns observations sorted chronologically', async () => {
    const result = await callTool('worldbank_data', {
      indicator: 'SP.POP.TOTL',
      country: 'DE',
      date_range: '2015:2020',
    });

    expect(result).not.toHaveProperty('error');
    const obs = result['observations'] as Array<{ year: string }>;
    for (let i = 1; i < obs.length; i++) {
      expect(obs[i].year >= (obs[i - 1]?.year ?? '')).toBe(true);
    }
  });

  it('handles a valid 3-letter country code (TCD = Chad)', async () => {
    const result = await callTool('worldbank_data', {
      indicator: 'SH.STA.MMRT',
      country: 'TCD',
    });

    // Chad has maternal mortality data — should succeed
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('observations');
  });

  it('returns error when required fields are missing', async () => {
    const result = await callTool('worldbank_data', { indicator: '', country: '' });
    expect(result).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GovReport Search  (no key required, HuggingFace Datasets)
// ---------------------------------------------------------------------------

describe('[no-key] govreport_search', () => {
  it('returns results or a graceful empty response', async () => {
    const result = await callTool('govreport_search', {
      query: 'healthcare cost reduction',
      max_results: 3,
    });

    // GovReport may return results or an empty set with a note (if index not ready)
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('query', 'healthcare cost reduction');
    expect(result).toHaveProperty('total');

    const results = result['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);

    if (results.length > 0) {
      const first = results[0] as Record<string, unknown>;
      expect(typeof first['title']).toBe('string');
      expect(typeof first['summary']).toBe('string');
      expect(typeof first['full_text_excerpt']).toBe('string');
      expect(typeof first['source_url']).toBe('string');
      // Excerpt should be capped at 2000 chars
      expect((first['full_text_excerpt'] as string).length).toBeLessThanOrEqual(2000);
    }
  });

  it('caps results at 10', async () => {
    const result = await callTool('govreport_search', {
      query: 'federal budget deficit',
      max_results: 50,
    });

    expect(result).not.toHaveProperty('error');
    const results = result['results'] as unknown[];
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns error when query is empty', async () => {
    const result = await callTool('govreport_search', { query: '' });
    expect(result).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// Semantic Scholar Search  (no key required)
// ---------------------------------------------------------------------------

// Semantic Scholar unauthenticated tier: 1 req/s, shared IP pool.
// Live tests skip gracefully when rate-limited (429) rather than failing —
// a 429 here means the endpoint is reachable but throttled, not broken.
// Run sequentially with delays between live calls.
describe('[no-key] semantic_scholar_search', { sequential: true }, () => {
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** True when the result is a 429 rate-limit from Semantic Scholar. */
  function isRateLimited(result: Record<string, unknown>): boolean {
    return typeof result['error'] === 'string' && result['error'].includes('429');
  }

  it('returns academic papers with expected fields', async () => {
    const result = await callTool('semantic_scholar_search', {
      query: 'conditional cash transfers education outcomes',
      max_results: 5,
    });

    if (isRateLimited(result)) {
      console.warn('  [SKIPPED] Semantic Scholar rate-limited (429) — run again after 60s.');
      return;
    }

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('total');

    const results = result['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const first = results[0] as Record<string, unknown>;
    expect(typeof first['title']).toBe('string');
    expect((first['title'] as string).length).toBeGreaterThan(0);
    expect(Array.isArray(first['authors'])).toBe(true);
    expect(typeof first['citation_count']).toBe('number');
    expect(typeof first['source_url']).toBe('string');
    expect(first['source_url'] as string).toContain('semanticscholar.org');
    expect(first['year'] === null || typeof first['year'] === 'number').toBe(true);

    await pause(1500);
  });

  it('filters by fields_of_study when provided', async () => {
    const result = await callTool('semantic_scholar_search', {
      query: 'public health policy interventions',
      max_results: 3,
      fields_of_study: ['Medicine'],
    });

    if (isRateLimited(result)) {
      console.warn('  [SKIPPED] Semantic Scholar rate-limited (429).');
      return;
    }

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');

    await pause(1500);
  });

  // Input validation — does not hit the network
  it('returns error when query is empty', async () => {
    const result = await callTool('semantic_scholar_search', { query: '' });
    expect(result).toHaveProperty('error');
  });

  // max_results capping is enforced in the URL params
  it('caps results at 20', async () => {
    const result = await callTool('semantic_scholar_search', {
      query: 'fiscal policy economic growth',
      max_results: 100,
    });

    if (isRateLimited(result)) {
      console.warn('  [SKIPPED] Semantic Scholar rate-limited (429).');
      return;
    }

    expect(result).not.toHaveProperty('error');
    const results = result['results'] as unknown[];
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// File Reader  (no key required — uses a temp file)
// ---------------------------------------------------------------------------

describe('[no-key] read_uploaded_file', () => {
  let tmpDir: string;
  let txtFile: string;
  let mdFile: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    txtFile = path.join(tmpDir, 'sample.txt');
    mdFile = path.join(tmpDir, 'sample.md');
    await fs.writeFile(txtFile, 'Hello from the policy memo agent test suite.\nLine two.');
    await fs.writeFile(mdFile, '# Policy Memo\n\nThis is a test markdown file.');
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a .txt file and returns content + char_count', async () => {
    const result = await callTool('read_uploaded_file', { file_path: txtFile });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('file_path', txtFile);
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('char_count');

    const content = result['content'] as string;
    expect(content).toContain('Hello from the policy memo agent test suite.');
    expect(result['char_count']).toBe(content.length);
  });

  it('reads a .md file', async () => {
    const result = await callTool('read_uploaded_file', { file_path: mdFile });

    expect(result).not.toHaveProperty('error');
    const content = result['content'] as string;
    expect(content).toContain('Policy Memo');
    expect(content).toContain('test markdown file');
  });

  it('returns error for a non-existent file', async () => {
    const result = await callTool('read_uploaded_file', {
      file_path: '/tmp/does-not-exist-abc123.txt',
    });
    expect(result).toHaveProperty('error');
    expect((result['error'] as string).toLowerCase()).toContain('not found');
  });

  it('returns error for an unsupported file extension', async () => {
    const xlsxFile = path.join(tmpDir, 'spreadsheet.xlsx');
    await fs.writeFile(xlsxFile, 'fake xlsx content');
    const result = await callTool('read_uploaded_file', { file_path: xlsxFile });
    expect(result).toHaveProperty('error');
    expect((result['error'] as string).toLowerCase()).toContain('unsupported');
  });

  it('returns error when file_path is empty', async () => {
    const result = await callTool('read_uploaded_file', { file_path: '' });
    expect(result).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// Web Search  (requires BRAVE_SEARCH_API_KEY)
// ---------------------------------------------------------------------------

describe('[requires-key] web_search', () => {
  it('returns web results with title/url/snippet', async () => {
    if (!requiresKey('BRAVE_SEARCH_API_KEY')) return;

    const result = await callTool('web_search', {
      query: 'universal basic income policy 2024',
      max_results: 5,
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('total');

    const results = result['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);

    const first = results[0] as Record<string, unknown>;
    expect(typeof first['title']).toBe('string');
    expect(typeof first['url']).toBe('string');
    expect(typeof first['snippet']).toBe('string');
    // URL should look like a URL
    expect(first['url'] as string).toMatch(/^https?:\/\//);
  });

  it('caps results at 20', async () => {
    if (!requiresKey('BRAVE_SEARCH_API_KEY')) return;

    const result = await callTool('web_search', {
      query: 'climate policy',
      max_results: 100,
    });

    expect(result).not.toHaveProperty('error');
    const results = result['results'] as unknown[];
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('returns error when query is empty', async () => {
    // This should fail before hitting the network
    const result = await callTool('web_search', { query: '' });
    expect(result).toHaveProperty('error');
  });

  it('returns error when both BRAVE_SEARCH_API_KEY and GEMINI_API_KEY are missing', async () => {
    const savedBrave = process.env['BRAVE_SEARCH_API_KEY'];
    const savedGemini = process.env['GEMINI_API_KEY'];
    delete process.env['BRAVE_SEARCH_API_KEY'];
    delete process.env['GEMINI_API_KEY'];

    const result = await callTool('web_search', { query: 'test' });
    expect(result).toHaveProperty('error');
    // Brave is absent → falls through to Gemini fallback → Gemini key check fires
    expect((result['error'] as string).toLowerCase()).toContain('gemini_api_key');

    if (savedBrave !== undefined) process.env['BRAVE_SEARCH_API_KEY'] = savedBrave;
    if (savedGemini !== undefined) process.env['GEMINI_API_KEY'] = savedGemini;
  });
});

// ---------------------------------------------------------------------------
// GovInfo Search  (requires GOVINFO_API_KEY)
// ---------------------------------------------------------------------------

describe('[requires-key] govinfo_search', () => {
  it('returns CRS reports with packageId/title/date/excerpt', async () => {
    if (!requiresKey('GOVINFO_API_KEY')) return;

    const result = await callTool('govinfo_search', {
      query: 'Medicare prescription drug costs',
      collection: 'CRS',
      max_results: 3,
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('collection', 'CRS');

    const results = result['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);

    if (results.length > 0) {
      const first = results[0] as Record<string, unknown>;
      expect(typeof first['packageId']).toBe('string');
      expect(typeof first['title']).toBe('string');
      expect(typeof first['date']).toBe('string');
      expect(Array.isArray(first['authors'])).toBe(true);
      expect(typeof first['source_url']).toBe('string');
      expect(first['source_url'] as string).toContain('govinfo.gov');
      // Excerpt may be empty string if no txt link, but should exist
      expect(typeof first['excerpt']).toBe('string');
      if ((first['excerpt'] as string).length > 0) {
        expect((first['excerpt'] as string).length).toBeLessThanOrEqual(3000);
      }
    }
  });

  it('defaults to CRS collection when collection not specified', async () => {
    if (!requiresKey('GOVINFO_API_KEY')) return;

    const result = await callTool('govinfo_search', {
      query: 'federal housing policy',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('collection', 'CRS');
  });

  it('falls back to CRS for an invalid collection value', async () => {
    if (!requiresKey('GOVINFO_API_KEY')) return;

    const result = await callTool('govinfo_search', {
      query: 'infrastructure spending',
      collection: 'INVALID',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('collection', 'CRS');
  });

  it('returns error when query is empty', async () => {
    const result = await callTool('govinfo_search', { query: '' });
    expect(result).toHaveProperty('error');
  });

  it('returns error when GOVINFO_API_KEY is missing', async () => {
    const saved = process.env['GOVINFO_API_KEY'];
    delete process.env['GOVINFO_API_KEY'];

    const result = await callTool('govinfo_search', { query: 'test' });
    expect(result).toHaveProperty('error');
    expect((result['error'] as string).toLowerCase()).toContain('govinfo_api_key');

    if (saved !== undefined) process.env['GOVINFO_API_KEY'] = saved;
  });
});

// ---------------------------------------------------------------------------
// FRED Economic Data  (requires FRED_API_KEY)
// ---------------------------------------------------------------------------

describe('[requires-key] fred_data', () => {
  it('returns unemployment rate (UNRATE) time-series', async () => {
    if (!requiresKey('FRED_API_KEY')) return;

    const result = await callTool('fred_data', {
      series_id: 'UNRATE',
      start_date: '2020-01-01',
      end_date: '2022-12-31',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('series_id', 'UNRATE');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('units');
    expect(result).toHaveProperty('frequency');
    expect(result).toHaveProperty('observations');
    expect(result).toHaveProperty('source_url');

    const obs = result['observations'] as Array<{ date: string; value: number | null }>;
    expect(Array.isArray(obs)).toBe(true);
    expect(obs.length).toBeGreaterThan(0);

    const first = obs[0];
    expect(typeof first.date).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(first.date)).toBe(true);
    // UNRATE has no missing values — value should be a number
    expect(typeof first.value).toBe('number');

    // source_url should reference UNRATE
    expect(result['source_url'] as string).toContain('UNRATE');
  });

  it('series_id is uppercased automatically', async () => {
    if (!requiresKey('FRED_API_KEY')) return;

    const result = await callTool('fred_data', {
      series_id: 'unrate', // lowercase input
      start_date: '2023-01-01',
      end_date: '2023-06-30',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('series_id', 'UNRATE');
  });

  it('handles FRED missing-value sentinel (.) as null', async () => {
    if (!requiresKey('FRED_API_KEY')) return;

    // GDP has some missing periods — verifies null handling even if not present here
    const result = await callTool('fred_data', {
      series_id: 'GDP',
      start_date: '2020-01-01',
      end_date: '2021-12-31',
    });

    expect(result).not.toHaveProperty('error');
    const obs = result['observations'] as Array<{ date: string; value: number | null }>;
    // All values should be number or null (never the raw string ".")
    for (const o of obs) {
      expect(o.value === null || typeof o.value === 'number').toBe(true);
    }
  });

  it('returns error when series_id is empty', async () => {
    const result = await callTool('fred_data', { series_id: '' });
    expect(result).toHaveProperty('error');
  });

  it('returns error when FRED_API_KEY is missing', async () => {
    const saved = process.env['FRED_API_KEY'];
    delete process.env['FRED_API_KEY'];

    const result = await callTool('fred_data', { series_id: 'UNRATE' });
    expect(result).toHaveProperty('error');
    expect((result['error'] as string).toLowerCase()).toContain('fred_api_key');

    if (saved !== undefined) process.env['FRED_API_KEY'] = saved;
  });
});

// ---------------------------------------------------------------------------
// callTool: unknown tool name
// ---------------------------------------------------------------------------

describe('callTool — routing', () => {
  it('returns { error } for an unknown tool name', async () => {
    const result = await callTool('nonexistent_tool_xyz', { query: 'test' });
    expect(result).toHaveProperty('error');
    expect(result['error'] as string).toContain('Unknown tool');
  });
});
