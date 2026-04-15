/**
 * MCP Tool Registry.
 *
 * Central registry for all tool servers. Provides:
 *   - fetchWithRetry: shared HTTP helper with timeout + exponential backoff
 *   - TOOL_REGISTRY: map of all 8 registered tools
 *   - getToolDefinitions(): Groq-compatible tool array for chat.completions.create
 *   - callTool(): routes a tool call to its handler with retry logic
 */

import { webSearchHandler } from './web-search-server';
import { arxivHandler } from './arxiv-server';
import { worldbankHandler } from './worldbank-server';
import { govreportHandler } from './govreport-server';
import { govinfoHandler } from './govinfo-server';
import { fredHandler } from './fred-server';
import { semanticScholarHandler } from './semantic-scholar-server';
import { fileReaderHandler } from './file-reader-server';

// ---------------------------------------------------------------------------
// Shared fetch utility
// ---------------------------------------------------------------------------

/**
 * Wraps fetch with a timeout (via AbortController) and exponential backoff retry.
 * On final failure, returns { error: string } rather than throwing.
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
  },
};

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
 * Retries up to the tool's max_retries on network errors.
 * Never throws — returns { error: string } on final failure.
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
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool ${name} timed out after ${String(tool.timeout_ms)}ms`));
        }, tool.timeout_ms);
      });

      const result = await Promise.race([tool.handler(input), timeoutPromise]);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < tool.max_retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    error: `Tool ${name} failed after ${String(tool.max_retries + 1)} attempts: ${message}`,
    source_unavailable: true,
  };
}
