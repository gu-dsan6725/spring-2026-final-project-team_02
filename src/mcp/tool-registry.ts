/**
 * MCP Tool Registry.
 *
 * Central registry for all tool servers. Provides:
 *   - fetchWithRetry: shared HTTP helper with timeout + exponential backoff
 *   - TOOL_REGISTRY: map of all 8 registered tools
 *   - getToolDefinitions(): Groq-compatible tool array for chat.completions.create
 *   - callTool(): routes a tool call to its handler with retry logic
 *   - runHealthChecks(): pings each tool's health endpoint before the agent starts
 *   - getAvailabilityPrompt(): produces the "Available tools: ..." line for the system prompt
 *   - executeTool(): callTool + Braintrust logging in one call
 */

import { webSearchHandler } from './web-search-server';
import { arxivHandler } from './arxiv-server';
import { worldbankHandler } from './worldbank-server';
import { govreportHandler } from './govreport-server';
import { govinfoHandler } from './govinfo-server';
import { fredHandler } from './fred-server';
import { semanticScholarHandler } from './semantic-scholar-server';
import { fileReaderHandler } from './file-reader-server';
import { logMcpToolCall } from '../observability/span-helpers';
import { logWarn } from '../observability/braintrust';

// ---------------------------------------------------------------------------
// Shared fetch utility
// ---------------------------------------------------------------------------

/**
 * Wraps fetch with a timeout (via AbortController) and exponential backoff retry.
 * On final failure, throws the last error rather than swallowing it.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  maxRetries: number,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// ToolDefinition interface
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  parameters: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  timeout_ms: number;
  max_retries: number;
  /** URL to GET for liveness check. A 2xx response means healthy. */
  health_check_url: string;
}

// ---------------------------------------------------------------------------
// Health check types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

export interface ToolHealthReport {
  name: string;
  status: HealthStatus;
  /** Human-readable reason, present when status !== 'healthy'. */
  reason?: string;
  /** Round-trip latency in ms (only present when status === 'healthy'). */
  latency_ms?: number;
}

/** Aggregated result returned by runHealthChecks(). */
export interface HealthCheckSummary {
  reports: ToolHealthReport[];
  /** True when at least one tool is healthy. */
  any_available: boolean;
  /** Names of healthy tools. */
  available: string[];
  /** Names of unhealthy/degraded tools. */
  unavailable: string[];
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const TOOL_REGISTRY: Partial<Record<string, ToolDefinition>> = {
  web_search: {
    name: 'web_search',
    description:
      'Search the web for recent news, policy documents, and government announcements. ' +
      'Use for current events, recent legislation, or sources not covered by academic databases.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string.' },
        max_results: {
          type: 'number',
          description: 'Number of results to return (1–20). Default 10.',
        },
      },
      required: ['query'],
    },
    handler: webSearchHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    // Anthropic API reachability: use the public models endpoint (no auth needed for 401 vs network error)
    health_check_url: 'https://api.anthropic.com/v1/models',
  },

  arxiv_search: {
    name: 'arxiv_search',
    description:
      'Search arXiv for academic preprints. Best for quantitative economics, ' +
      'development economics, public finance, and policy analysis papers.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (keywords or author name).' },
        max_results: { type: 'number', description: 'Results to return (1–10). Default 5.' },
      },
      required: ['query'],
    },
    handler: arxivHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url: 'https://export.arxiv.org/api/query?search_query=test&max_results=1',
  },

  worldbank_data: {
    name: 'worldbank_data',
    description:
      'Fetch World Bank development indicator time-series data by country and year range. ' +
      'Common codes: NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (population), ' +
      'SH.STA.MMRT (maternal mortality), SE.PRM.ENRR (primary enrollment), ' +
      'SI.POV.DDAY (poverty rate), SH.DYN.MORT (child mortality).',
    parameters: {
      type: 'object',
      properties: {
        indicator: {
          type: 'string',
          description: 'World Bank series code, e.g. "SH.STA.MMRT".',
        },
        country: {
          type: 'string',
          description: 'ISO 2 or 3-letter country code, e.g. "US", "TCD", "all".',
        },
        date_range: {
          type: 'string',
          description: 'Year range e.g. "2015:2023". Defaults to 2015:2023.',
        },
      },
      required: ['indicator', 'country'],
    },
    handler: worldbankHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url:
      'https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1',
  },

  govreport_search: {
    name: 'govreport_search',
    description:
      'Search ~19,000 US government reports (GAO, CRS, CDC, OMB) from the GovReport dataset. ' +
      'Best for official government analyses, existing policy positions, and agency findings.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword search query.' },
        max_results: { type: 'number', description: 'Results to return (1–10). Default 5.' },
      },
      required: ['query'],
    },
    handler: govreportHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url: 'https://huggingface.co/datasets/launch/gov_report',
  },

  govinfo_search: {
    name: 'govinfo_search',
    description:
      'Search US Government Publishing Office documents. Collections: ' +
      '"CRS" (Congressional Research Service policy briefs), ' +
      '"GAO" (Government Accountability Office audits), ' +
      '"BILLS" (legislation text), "FR" (Federal Register). Default: CRS.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        collection: {
          type: 'string',
          enum: ['CRS', 'GAO', 'BILLS', 'FR', 'BUDGET'],
          description: 'Document collection to search. Default: CRS.',
        },
        max_results: { type: 'number', description: 'Results to return (1–10). Default 5.' },
      },
      required: ['query'],
    },
    handler: govinfoHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url: 'https://api.govinfo.gov/collections?api_key=DEMO_KEY',
  },

  fred_data: {
    name: 'fred_data',
    description:
      'Fetch Federal Reserve (FRED) economic time-series data. ' +
      'Key series: UNRATE (unemployment), CPIAUCSL (CPI inflation), GDP (nominal GDP), ' +
      'FEDFUNDS (federal funds rate), DEXUSEU (USD/EUR), GFDEBTN (federal debt), ' +
      'MEHOINUSA672N (median household income).',
    parameters: {
      type: 'object',
      properties: {
        series_id: {
          type: 'string',
          description: 'FRED series ID, e.g. "UNRATE".',
        },
        start_date: {
          type: 'string',
          description: 'Start date YYYY-MM-DD. Default: 2015-01-01.',
        },
        end_date: {
          type: 'string',
          description: 'End date YYYY-MM-DD. Default: today.',
        },
      },
      required: ['series_id'],
    },
    handler: fredHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url:
      'https://api.stlouisfed.org/fred/series?series_id=UNRATE&api_key=&file_type=json',
  },

  semantic_scholar_search: {
    name: 'semantic_scholar_search',
    description:
      'Search Semantic Scholar for peer-reviewed papers in economics, public health, ' +
      'political science, and social policy. Complements arXiv for social science research ' +
      'not typically posted as preprints.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        max_results: { type: 'number', description: 'Results to return (1–20). Default 10.' },
        fields_of_study: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional filter e.g. ["Economics", "Political Science", "Medicine"]. ' +
            'Leave empty to search all fields.',
        },
      },
      required: ['query'],
    },
    handler: semanticScholarHandler,
    timeout_ms: 30_000,
    max_retries: 3,
    health_check_url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1',
  },

  read_uploaded_file: {
    name: 'read_uploaded_file',
    description:
      'Read text content from a user-uploaded file. Supports PDF, DOCX, TXT, and MD formats.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the uploaded file on disk.',
        },
      },
      required: ['file_path'],
    },
    handler: fileReaderHandler,
    timeout_ms: 10_000,
    max_retries: 1,
    // Local tool — health is always "healthy" (no network dependency).
    // We use a data: URI so fetch never goes to the network; we override this
    // in runHealthChecks() instead.
    health_check_url: 'local',
  },
};

// ---------------------------------------------------------------------------
// Health check system
// ---------------------------------------------------------------------------

/** Timeout for each individual health check ping (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Checks liveness for a single tool by GETting its health_check_url.
 * A 2xx or 4xx response means the endpoint is reachable (even auth errors
 * confirm reachability). Only network-level failures mark a tool unhealthy.
 *
 * The `read_uploaded_file` tool is local and always considered healthy.
 */
async function checkToolHealth(tool: ToolDefinition): Promise<ToolHealthReport> {
  // Local tool — no network check needed.
  if (tool.health_check_url === 'local') {
    return { name: tool.name, status: 'healthy', latency_ms: 0 };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(tool.health_check_url, {
      method: 'GET',
      signal: controller.signal,
      // Don't follow redirects — a redirect means we reached the server.
      redirect: 'manual',
    });
    clearTimeout(timer);

    const latency_ms = Date.now() - start;

    // 2xx, 3xx, and 4xx all mean the endpoint is reachable.
    // 5xx means the service itself is down.
    if (response.status >= 500) {
      return {
        name: tool.name,
        status: 'unhealthy',
        reason: `API returned ${String(response.status)}`,
      };
    }

    return { name: tool.name, status: 'healthy', latency_ms };
  } catch (error) {
    clearTimeout(timer);
    const isTimeout =
      error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'));
    return {
      name: tool.name,
      status: 'unhealthy',
      reason: isTimeout
        ? 'health check timed out'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

/**
 * Runs health checks on all registered tools in parallel.
 * Returns a HealthCheckSummary with per-tool reports and aggregate availability.
 *
 * Call this once before starting the agent loop and pass the result to
 * getAvailabilityPrompt() to inject tool availability into the system prompt.
 */
export async function runHealthChecks(): Promise<HealthCheckSummary> {
  const tools = Object.values(TOOL_REGISTRY).filter((t): t is ToolDefinition => t !== undefined);

  const reports = await Promise.all(tools.map((t) => checkToolHealth(t)));

  const available = reports.filter((r) => r.status === 'healthy').map((r) => r.name);
  const unavailable = reports.filter((r) => r.status !== 'healthy').map((r) => r.name);

  if (unavailable.length > 0) {
    logWarn('tool_health_check', {
      unavailable,
      reports: reports
        .filter((r) => r.status !== 'healthy')
        .map((r) => ({ name: r.name, reason: r.reason })),
    });
  }

  return {
    reports,
    any_available: available.length > 0,
    available,
    unavailable,
  };
}

/**
 * Builds the "Available tools: ..." line for the agent's system prompt.
 *
 * Example output:
 *   Available tools: web_search (healthy), arxiv_search (healthy),
 *   worldbank_data (unavailable — API timeout), read_uploaded_file (healthy)
 *
 * Also appends a degraded-mode warning when no external tools are reachable
 * so the agent knows to rely only on user-uploaded sources and its own knowledge.
 */
export function getAvailabilityPrompt(summary: HealthCheckSummary): string {
  const tools = Object.values(TOOL_REGISTRY).filter((t): t is ToolDefinition => t !== undefined);

  const parts = tools.map((tool) => {
    const report = summary.reports.find((r) => r.name === tool.name);
    if (report === undefined || report.status === 'healthy') {
      return `${tool.name} (healthy)`;
    }
    const reason = report.reason ?? 'unavailable';
    return `${tool.name} (unavailable — ${reason})`;
  });

  const header = `Available tools: ${parts.join(', ')}`;

  // Check whether ALL external tools are down (read_uploaded_file is local and always healthy).
  const externalTools = tools.filter((t) => t.health_check_url !== 'local');
  const allExternalDown = externalTools.every((t) => summary.unavailable.includes(t.name));

  if (allExternalDown && externalTools.length > 0) {
    return (
      header +
      '\n\nWARNING: All external research tools are currently unreachable. ' +
      'You must rely exclusively on user-uploaded sources (read_uploaded_file) ' +
      'and your own knowledge to write this memo. ' +
      'Mark any claims produced without an external source as degraded_mode: true ' +
      'in the notes log so reviewers are aware of the reduced evidentiary basis.'
    );
  }

  return header;
}

// ---------------------------------------------------------------------------
// Graceful degradation helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ordered list of fallback tools for a given unavailable tool.
 *
 * Degradation policy (per CLAUDE.md):
 *   - arxiv_search down  → prefer web_search for academic sources
 *   - worldbank_data down → prefer web_search for economic data
 *   - All external down  → read_uploaded_file only
 */
export function getFallbackTools(unavailableTool: string, summary: HealthCheckSummary): string[] {
  const fallbackMap: Record<string, string[]> = {
    arxiv_search: ['semantic_scholar_search', 'web_search'],
    worldbank_data: ['fred_data', 'web_search'],
    fred_data: ['worldbank_data', 'web_search'],
    govreport_search: ['govinfo_search', 'web_search'],
    govinfo_search: ['govreport_search', 'web_search'],
    semantic_scholar_search: ['arxiv_search', 'web_search'],
    web_search: ['govreport_search', 'arxiv_search'],
    read_uploaded_file: [],
  };

  const candidates = fallbackMap[unavailableTool] ?? ['web_search'];
  return candidates.filter((name) => summary.available.includes(name));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the tool list in Groq/OpenAI function-calling format. */
export function getToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  const tools = Object.values(TOOL_REGISTRY).filter((t): t is ToolDefinition => t !== undefined);
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Route a tool call to the appropriate handler.
 * Retries up to the tool's max_retries on network errors with exponential backoff.
 * Never throws — returns { error: string, source_unavailable: true } on final failure.
 */
export async function callTool(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = TOOL_REGISTRY[name];
  if (tool === undefined) {
    return { error: `Unknown tool: ${name}` };
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= tool.max_retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, tool.timeout_ms);

    try {
      const resultPromise = tool.handler(input);
      // Race the handler against the AbortController-linked timeout promise.
      const timeoutPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`Tool ${name} timed out after ${String(tool.timeout_ms)}ms`));
        });
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt < tool.max_retries) {
        // Exponential backoff: 1s, 2s, 4s (as specified in CLAUDE.md)
        await new Promise((resolve) => setTimeout(resolve, 1_000 * Math.pow(2, attempt)));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    error: `Tool ${name} failed after ${String(tool.max_retries + 1)} attempts: ${message}`,
    source_unavailable: true,
  };
}

/**
 * Execute a tool call and log it to Braintrust.
 *
 * This is the preferred entry point for the agent loop — it combines callTool()
 * with observability so callers don't have to manage timing and logging themselves.
 *
 * Returns the same shape as callTool() (never throws).
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  const result = await callTool(name, input);
  const latencyMs = Date.now() - start;
  const success = !('error' in result);

  logMcpToolCall(name, input, JSON.stringify(result).slice(0, 2_000), latencyMs, success);

  return result;
}
