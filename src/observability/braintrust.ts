/**
 * Braintrust observability helpers.
 *
 * Uses the Braintrust SDK when BRAINTRUST_API_KEY is set; otherwise falls back
 * to stderr-only logging so the app runs without credentials in development.
 *
 * The rest of the codebase never calls console.log directly — use these helpers
 * or the span-helpers wrappers built on top of them.
 */

import * as braintrust from 'braintrust';
import type { Span as BraintrustSpan } from 'braintrust';

export interface SpanAttributes {
  [key: string]: unknown;
}

export interface Span {
  id: string;
  name: string;
  startTime: number;
  log(attributes: SpanAttributes): void;
  end(attributes?: SpanAttributes): void;
}

// ---------------------------------------------------------------------------
// Braintrust logger singleton — initialised lazily on first use.
// ---------------------------------------------------------------------------

let _logger: ReturnType<typeof braintrust.initLogger> | null = null;
let _loggerInitialised = false;

function getLogger(): ReturnType<typeof braintrust.initLogger> | null {
  if (_loggerInitialised) return _logger;
  _loggerInitialised = true;

  const apiKey = process.env['BRAINTRUST_API_KEY'];
  const project = process.env['BRAINTRUST_PROJECT_NAME'] ?? 'policy-memo-agent';

  if (apiKey === undefined || apiKey.length === 0) {
    logStderr('warn', 'BRAINTRUST_API_KEY not set — falling back to stderr-only logging');
    _logger = null;
    return null;
  }

  try {
    _logger = braintrust.initLogger({
      apiKey,
      projectName: project,
      asyncFlush: true,
    });
    logStderr('info', `Braintrust logger initialised (project: ${project})`);
  } catch (err) {
    logStderr('warn', `Braintrust init failed — falling back to stderr: ${String(err)}`);
    _logger = null;
  }

  return _logger;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start a named span. Returns a Span handle to attach attributes and close. */
export function startSpan(name: string, attributes?: SpanAttributes): Span {
  const id = `span-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();
  const logger = getLogger();

  logStderr('debug', `[span:start] ${name}`, { span_id: id, ...attributes });

  // Braintrust span handle (may be null if SDK unavailable)
  let btSpan: BraintrustSpan | null = null;
  if (logger !== null) {
    try {
      btSpan = logger.startSpan({ name, event: { input: attributes } });
    } catch {
      btSpan = null;
    }
  }

  return {
    id,
    name,
    startTime,
    log(attrs: SpanAttributes) {
      logStderr('debug', `[span:log] ${name}`, { span_id: id, ...attrs });
      if (btSpan !== null) {
        try {
          btSpan.log(attrs);
        } catch {
          // swallow — observability must never break the app
        }
      }
    },
    end(attrs?: SpanAttributes) {
      const duration_ms = Date.now() - startTime;
      logStderr('debug', `[span:end] ${name}`, { span_id: id, duration_ms, ...attrs });
      if (btSpan !== null) {
        try {
          btSpan.log({ output: attrs, metrics: { duration_ms } });
          btSpan.end();
        } catch {
          // swallow
        }
      }
    },
  };
}

/** Log a tool call with its inputs, output, and latency. */
export function logToolCall(
  toolName: string,
  input: SpanAttributes,
  output: string,
  latencyMs: number,
): void {
  logStderr('debug', '[tool_call]', {
    tool: toolName,
    input,
    output_preview: output.slice(0, 200),
    latency_ms: latencyMs,
  });

  const logger = getLogger();
  if (logger !== null) {
    try {
      void logger.log({
        input: { tool: toolName, ...input },
        output: output.slice(0, 2000),
        metadata: { latency_ms: latencyMs },
      });
    } catch {
      // swallow
    }
  }
}

/** Log an error with context. Never swallows; always re-raises via the caller. */
export function logError(context: string, error: unknown, attributes?: SpanAttributes): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logStderr('error', context, { message, stack, ...attributes });

  const logger = getLogger();
  if (logger !== null) {
    try {
      void logger.log({
        metadata: { level: 'error', context, message, stack, ...attributes },
      });
    } catch {
      // swallow
    }
  }
}

/** Log a warning. */
export function logWarn(context: string, attributes?: SpanAttributes): void {
  logStderr('warn', context, attributes);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Write a structured JSON line to stderr. Never touches stdout. */
function logStderr(level: string, context: string, attributes?: SpanAttributes): void {
  process.stderr.write(JSON.stringify({ level, context, ...attributes }) + '\n');
}
