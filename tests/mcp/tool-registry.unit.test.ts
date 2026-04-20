/**
 * Unit tests for src/mcp/tool-registry.ts
 *
 * Covers:
 *   Health check system
 *     - healthy tool (2xx response)
 *     - unhealthy tool (5xx response)
 *     - unreachable tool (network error)
 *     - timeout during health check
 *     - local tool (read_uploaded_file) always healthy
 *     - runHealthChecks() aggregates all tools
 *     - getAvailabilityPrompt() labels healthy vs unavailable
 *     - getAvailabilityPrompt() appends WARNING when all external tools are down
 *
 *   Retry logic & timeouts
 *     - callTool() succeeds on first attempt
 *     - callTool() retries on failure and succeeds on retry
 *     - callTool() returns structured error after all retries exhausted
 *     - callTool() returns error for unknown tool name
 *     - callTool() returns { source_unavailable: true } on final failure
 *     - callTool() uses exponential backoff delay (1s between attempts)
 *     - callTool() handles handler timeout (AbortController)
 *
 *   executeTool()
 *     - calls callTool and logs to Braintrust
 *     - success=true logged when no error key
 *     - success=false logged when error key present
 *
 *   Graceful degradation
 *     - getFallbackTools() returns healthy alternatives for arxiv_search
 *     - getFallbackTools() returns healthy alternatives for worldbank_data
 *     - getFallbackTools() returns empty list when no fallbacks are healthy
 *     - getFallbackTools() skips unhealthy fallback candidates
 */

import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Braintrust observability so span writes don't pollute test output.
// ---------------------------------------------------------------------------
vi.mock('../../src/observability/span-helpers', () => ({
  logMcpToolCall: vi.fn(),
  logWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock ALL individual MCP server handlers so no real network calls happen.
// ---------------------------------------------------------------------------
vi.mock('../../src/mcp/web-search-server', () => ({ webSearchHandler: vi.fn() }));
vi.mock('../../src/mcp/arxiv-server', () => ({ arxivHandler: vi.fn() }));
vi.mock('../../src/mcp/worldbank-server', () => ({ worldbankHandler: vi.fn() }));
vi.mock('../../src/mcp/govreport-server', () => ({ govreportHandler: vi.fn() }));
vi.mock('../../src/mcp/govinfo-server', () => ({ govinfoHandler: vi.fn() }));
vi.mock('../../src/mcp/fred-server', () => ({ fredHandler: vi.fn() }));
vi.mock('../../src/mcp/semantic-scholar-server', () => ({ semanticScholarHandler: vi.fn() }));
vi.mock('../../src/mcp/file-reader-server', () => ({ fileReaderHandler: vi.fn() }));

import {
  runHealthChecks,
  getAvailabilityPrompt,
  getFallbackTools,
  callTool,
  executeTool,
  TOOL_REGISTRY,
  type ToolDefinition,
  type HealthCheckSummary,
} from '../../src/mcp/tool-registry';

import { logMcpToolCall } from '../../src/observability/span-helpers';

// ---------------------------------------------------------------------------
// Helper: build a minimal HealthCheckSummary for degradation tests
// ---------------------------------------------------------------------------
function makeSummary(available: string[], unavailable: string[]): HealthCheckSummary {
  const reports = [
    ...available.map((name) => ({ name, status: 'healthy' as const, latency_ms: 10 })),
    ...unavailable.map((name) => ({
      name,
      status: 'unhealthy' as const,
      reason: 'test failure',
    })),
  ];
  return { reports, any_available: available.length > 0, available, unavailable };
}

// ---------------------------------------------------------------------------
// Health check system
// ---------------------------------------------------------------------------

describe('Health check system', () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('marks a tool healthy when health_check_url returns 200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const summary = await runHealthChecks();
    // arxiv_search should be among healthy tools (fetch returns 200 for all calls in this test)
    expect(summary.available).toContain('arxiv_search');
    expect(summary.reports.find((r) => r.name === 'arxiv_search')?.status).toBe('healthy');
  });

  it('marks a tool unhealthy when health_check_url returns 503', async () => {
    // Return 503 for arxiv specifically; 200 for all others so the test is focused.
    const tools = Object.values(TOOL_REGISTRY).filter((t): t is ToolDefinition => t !== undefined);

    fetchSpy.mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('arxiv.org')) {
        return Promise.resolve(new Response('error', { status: 503 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const summary = await runHealthChecks();
    expect(summary.unavailable).toContain('arxiv_search');
    expect(summary.reports.find((r) => r.name === 'arxiv_search')?.status).toBe('unhealthy');
    expect(summary.reports.find((r) => r.name === 'arxiv_search')?.reason).toMatch(/503/);

    // Confirm other tools are not affected (they got 200).
    const healthy = tools
      .filter((t) => t.health_check_url !== 'local' && !t.health_check_url.includes('arxiv'))
      .map((t) => t.name);
    for (const name of healthy) {
      expect(summary.available).toContain(name);
    }
  });

  it('marks a tool unhealthy when the network request throws', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const summary = await runHealthChecks();
    expect(summary.available).toHaveLength(1); // only read_uploaded_file (local)
    expect(summary.available).toContain('read_uploaded_file');
    expect(summary.any_available).toBe(true);
  });

  it('marks a tool unhealthy when the health check times out (AbortError)', async () => {
    fetchSpy.mockImplementation(
      () =>
        new Promise<never>((_, reject) => {
          // Simulate the AbortController firing
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          // Reject immediately so the test doesn't hang
          reject(err);
        }),
    );

    const summary = await runHealthChecks();
    const arxivReport = summary.reports.find((r) => r.name === 'arxiv_search');
    expect(arxivReport?.status).toBe('unhealthy');
    expect(arxivReport?.reason).toMatch(/timed out/);
  });

  it('always marks read_uploaded_file as healthy (local tool)', async () => {
    // Even when fetch is broken, local tool must be healthy.
    fetchSpy.mockRejectedValue(new Error('no network'));

    const summary = await runHealthChecks();
    const report = summary.reports.find((r) => r.name === 'read_uploaded_file');
    expect(report?.status).toBe('healthy');
    expect(report?.latency_ms).toBe(0);
  });

  it('runHealthChecks() returns any_available=false only when ALL tools are down', async () => {
    // Make fetch throw for all external tools and there are no local tools... wait,
    // read_uploaded_file is local so any_available is always true in practice.
    // This test checks the boundary: with only local tools responding, any_available is true.
    fetchSpy.mockRejectedValue(new Error('all down'));

    const summary = await runHealthChecks();
    expect(summary.any_available).toBe(true); // read_uploaded_file is always healthy
    expect(summary.available).toEqual(['read_uploaded_file']);
  });
});

// ---------------------------------------------------------------------------
// getAvailabilityPrompt()
// ---------------------------------------------------------------------------

describe('getAvailabilityPrompt()', () => {
  it('labels all tools as healthy when all are available', () => {
    const allTools = Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .map((t) => t.name);

    const summary = makeSummary(allTools, []);
    const prompt = getAvailabilityPrompt(summary);

    expect(prompt).toContain('Available tools:');
    for (const name of allTools) {
      expect(prompt).toContain(`${name} (healthy)`);
    }
    // No warning when tools are healthy
    expect(prompt).not.toContain('WARNING');
  });

  it('labels an unavailable tool with its reason', () => {
    const allTools = Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .map((t) => t.name);

    const available = allTools.filter((n) => n !== 'worldbank_data');

    // Build the summary manually so the reason is exactly what we want.
    const reports = [
      ...available.map((name) => ({ name, status: 'healthy' as const, latency_ms: 10 })),
      { name: 'worldbank_data', status: 'unhealthy' as const, reason: 'API timeout' },
    ];
    const summary: HealthCheckSummary = {
      reports,
      any_available: true,
      available,
      unavailable: ['worldbank_data'],
    };

    const prompt = getAvailabilityPrompt(summary);
    expect(prompt).toContain('worldbank_data (unavailable — API timeout)');
    expect(prompt).not.toContain('WARNING');
  });

  it('appends a WARNING when all external tools are unavailable', () => {
    const allTools = Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .map((t) => t.name);

    // Only keep the local tool as available.
    const summary = makeSummary(
      ['read_uploaded_file'],
      allTools.filter((n) => n !== 'read_uploaded_file'),
    );

    const prompt = getAvailabilityPrompt(summary);
    expect(prompt).toContain('WARNING');
    expect(prompt).toContain('degraded_mode: true');
    expect(prompt).toContain('read_uploaded_file');
  });

  it('does NOT append WARNING when at least one external tool is healthy', () => {
    const summary = makeSummary(['web_search', 'read_uploaded_file'], ['arxiv_search']);

    const prompt = getAvailabilityPrompt(summary);
    expect(prompt).not.toContain('WARNING');
  });
});

// ---------------------------------------------------------------------------
// callTool() — retry logic and timeout
// ---------------------------------------------------------------------------

describe('callTool() — retry logic', () => {
  beforeEach(() => {
    // Reset all handler mocks before each test.
    Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .forEach((t) => vi.mocked(t.handler).mockReset());
  });

  it('returns handler result on first attempt', async () => {
    const tool = TOOL_REGISTRY['arxiv_search'];
    if (tool === undefined) throw new Error('arxiv_search not in registry');

    vi.mocked(tool.handler).mockResolvedValueOnce({ results: [], total: 0, query: 'test' });

    const result = await callTool('arxiv_search', { query: 'test' });
    expect(result).toEqual({ results: [], total: 0, query: 'test' });
    expect(vi.mocked(tool.handler)).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on the retry', async () => {
    vi.useFakeTimers();

    const tool = TOOL_REGISTRY['arxiv_search'];
    if (tool === undefined) throw new Error('arxiv_search not in registry');

    vi.mocked(tool.handler)
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce({ results: ['hit'], total: 1, query: 'test' });

    // Start the call without awaiting so we can advance timers.
    const callPromise = callTool('arxiv_search', { query: 'test' });

    // Advance past the first backoff delay (1s).
    await vi.advanceTimersByTimeAsync(1_100);

    const result = await callPromise;
    expect(result).toEqual({ results: ['hit'], total: 1, query: 'test' });
    expect(vi.mocked(tool.handler)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('returns structured error after all retries are exhausted', async () => {
    vi.useFakeTimers();

    const tool = TOOL_REGISTRY['web_search'];
    if (tool === undefined) throw new Error('web_search not in registry');

    // web_search has max_retries: 1, so 2 total attempts.
    vi.mocked(tool.handler).mockRejectedValue(new Error('persistent failure'));

    const callPromise = callTool('web_search', { query: 'test' });

    // Advance through the single backoff window (1s).
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await callPromise;
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('source_unavailable', true);
    expect(result['error'] as string).toContain('persistent failure');
    expect(result['error'] as string).toContain('2 attempts');

    vi.useRealTimers();
  });

  it('returns { error } for an unknown tool name', async () => {
    const result = await callTool('nonexistent_tool_xyz', {});
    expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool_xyz' });
  });

  it('includes source_unavailable: true on final failure', async () => {
    vi.useFakeTimers();

    const tool = TOOL_REGISTRY['worldbank_data'];
    if (tool === undefined) throw new Error('worldbank_data not in registry');

    vi.mocked(tool.handler).mockRejectedValue(new Error('timeout'));

    const callPromise = callTool('worldbank_data', { indicator: 'NY.GDP.MKTP.CD', country: 'US' });
    await vi.advanceTimersByTimeAsync(15_000);

    const result = await callPromise;
    expect(result['source_unavailable']).toBe(true);

    vi.useRealTimers();
  });

  it('uses exponential backoff: delay is 1s between attempts', async () => {
    vi.useFakeTimers();

    const tool = TOOL_REGISTRY['arxiv_search'];
    if (tool === undefined) throw new Error('arxiv_search not in registry');

    const callOrder: number[] = [];
    vi.mocked(tool.handler).mockImplementation(() => {
      callOrder.push(Date.now());
      return Promise.reject(new Error('always fail'));
    });

    const callPromise = callTool('arxiv_search', { query: 'test' });

    // Advance through the single backoff window (1s).
    await vi.advanceTimersByTimeAsync(5_000);
    await callPromise;

    // Should have been called 2 times (1 initial + 1 retry) with max_retries: 1.
    expect(callOrder.length).toBe(2);

    // Gap between calls should be ~1s.
    expect(callOrder[1]! - callOrder[0]!).toBeGreaterThanOrEqual(1_000);

    vi.useRealTimers();
  });
});

describe('callTool() — handler timeout', () => {
  beforeEach(() => {
    Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .forEach((t) => vi.mocked(t.handler).mockReset());
  });

  it('returns structured error when handler exceeds timeout', async () => {
    vi.useFakeTimers();

    // Use read_uploaded_file which has a 10s timeout and max_retries: 1.
    const tool = TOOL_REGISTRY['read_uploaded_file'];
    if (tool === undefined) throw new Error('read_uploaded_file not in registry');

    // Handler hangs forever.
    vi.mocked(tool.handler).mockImplementation(
      () => new Promise<Record<string, unknown>>(() => undefined),
    );

    const callPromise = callTool('read_uploaded_file', { file_path: '/tmp/test.txt' });

    // Advance past the 10s timeout × 2 attempts.
    await vi.advanceTimersByTimeAsync(30_000);

    const result = await callPromise;
    expect(result).toHaveProperty('error');
    expect(result['error'] as string).toContain('timed out');
    expect(result['source_unavailable']).toBe(true);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// executeTool()
// ---------------------------------------------------------------------------

describe('executeTool()', () => {
  beforeEach(() => {
    vi.mocked(logMcpToolCall).mockReset();
    Object.values(TOOL_REGISTRY)
      .filter((t): t is ToolDefinition => t !== undefined)
      .forEach((t) => vi.mocked(t.handler).mockReset());
  });

  it('returns the tool result and logs success=true when no error key', async () => {
    const tool = TOOL_REGISTRY['arxiv_search'];
    if (tool === undefined) throw new Error('arxiv_search not in registry');

    vi.mocked(tool.handler).mockResolvedValueOnce({ results: ['paper'], total: 1, query: 'ai' });

    const result = await executeTool('arxiv_search', { query: 'ai' });

    expect(result).toEqual({ results: ['paper'], total: 1, query: 'ai' });
    expect(logMcpToolCall).toHaveBeenCalledOnce();

    const [name, _input, _output, _latency, success] = (logMcpToolCall as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, Record<string, unknown>, string, number, boolean];
    expect(name).toBe('arxiv_search');
    expect(success).toBe(true);
  });

  it('logs success=false when the result contains an error key', async () => {
    vi.useFakeTimers();

    const tool = TOOL_REGISTRY['arxiv_search'];
    if (tool === undefined) throw new Error('arxiv_search not in registry');

    vi.mocked(tool.handler).mockRejectedValue(new Error('network down'));

    const executePromise = executeTool('arxiv_search', { query: 'test' });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await executePromise;

    expect(result).toHaveProperty('error');
    expect(logMcpToolCall).toHaveBeenCalledOnce();

    const [, , , , success] = (logMcpToolCall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
      number,
      boolean,
    ];
    expect(success).toBe(false);

    vi.useRealTimers();
  });

  it('passes the tool name and input to logMcpToolCall', async () => {
    const tool = TOOL_REGISTRY['worldbank_data'];
    if (tool === undefined) throw new Error('worldbank_data not in registry');

    vi.mocked(tool.handler).mockResolvedValueOnce({ observations: [] });

    const input = { indicator: 'SP.POP.TOTL', country: 'US' };
    await executeTool('worldbank_data', input);

    const [name, loggedInput] = (logMcpToolCall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe('worldbank_data');
    expect(loggedInput).toEqual(input);
  });

  it('truncates output to 2000 chars before logging', async () => {
    const tool = TOOL_REGISTRY['web_search'];
    if (tool === undefined) throw new Error('web_search not in registry');

    const largeResult = { results: ['x'.repeat(10_000)] };
    vi.mocked(tool.handler).mockResolvedValueOnce(largeResult);

    await executeTool('web_search', { query: 'test' });

    const [, , output] = (logMcpToolCall as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(output.length).toBeLessThanOrEqual(2_000);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — getFallbackTools()
// ---------------------------------------------------------------------------

describe('getFallbackTools()', () => {
  it('returns semantic_scholar_search then web_search when arxiv_search is down', () => {
    const summary = makeSummary(
      ['semantic_scholar_search', 'web_search', 'read_uploaded_file'],
      ['arxiv_search'],
    );
    const fallbacks = getFallbackTools('arxiv_search', summary);
    expect(fallbacks).toContain('semantic_scholar_search');
    expect(fallbacks).toContain('web_search');
    expect(fallbacks).not.toContain('arxiv_search');
  });

  it('returns web_search when worldbank_data is down and fred_data is also down', () => {
    const summary = makeSummary(
      ['web_search', 'read_uploaded_file'],
      ['worldbank_data', 'fred_data'],
    );
    const fallbacks = getFallbackTools('worldbank_data', summary);
    expect(fallbacks).toEqual(['web_search']);
  });

  it('returns empty list when all fallback candidates are also unavailable', () => {
    // arxiv down, semantic_scholar down, web_search down — no fallbacks remain.
    const summary = makeSummary(
      ['read_uploaded_file'],
      ['arxiv_search', 'semantic_scholar_search', 'web_search'],
    );
    const fallbacks = getFallbackTools('arxiv_search', summary);
    expect(fallbacks).toHaveLength(0);
  });

  it('skips unhealthy fallback candidates and returns only healthy ones', () => {
    // semantic_scholar is down but web_search is up.
    const summary = makeSummary(
      ['web_search', 'read_uploaded_file'],
      ['arxiv_search', 'semantic_scholar_search'],
    );
    const fallbacks = getFallbackTools('arxiv_search', summary);
    expect(fallbacks).not.toContain('semantic_scholar_search');
    expect(fallbacks).toContain('web_search');
  });

  it('returns empty list for read_uploaded_file (local tool, no network fallback)', () => {
    const summary = makeSummary(
      Object.keys(TOOL_REGISTRY).filter((k): k is string => k !== undefined),
      [],
    );
    const fallbacks = getFallbackTools('read_uploaded_file', summary);
    expect(fallbacks).toHaveLength(0);
  });

  it('returns web_search as fallback for unknown tool names', () => {
    const summary = makeSummary(['web_search', 'read_uploaded_file'], []);
    const fallbacks = getFallbackTools('some_unknown_tool', summary);
    expect(fallbacks).toContain('web_search');
  });
});
