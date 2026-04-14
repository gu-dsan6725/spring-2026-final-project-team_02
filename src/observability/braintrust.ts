/**
 * Braintrust observability helpers.
 *
 * Wraps span creation and logging so the rest of the codebase never calls
 * console.log directly. In this stub implementation all spans are logged to
 * stderr at debug level; a future checkpoint wires in the real Braintrust SDK.
 */

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

/** Start a named span. Returns a Span handle to attach attributes and close. */
export function startSpan(name: string, attributes?: SpanAttributes): Span {
  const id = `span-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  if (attributes !== undefined) {
    logDebug(`[span:start] ${name}`, { span_id: id, ...attributes });
  } else {
    logDebug(`[span:start] ${name}`, { span_id: id });
  }

  return {
    id,
    name,
    startTime,
    log(attrs: SpanAttributes) {
      logDebug(`[span:log] ${name}`, { span_id: id, ...attrs });
    },
    end(attrs?: SpanAttributes) {
      const duration_ms = Date.now() - startTime;
      logDebug(`[span:end] ${name}`, { span_id: id, duration_ms, ...attrs });
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
  logDebug('[tool_call]', {
    tool: toolName,
    input,
    output_preview: output.slice(0, 200),
    latency_ms: latencyMs,
  });
}

/** Log an error with context. Never swallows; always re-raises via the caller. */
export function logError(context: string, error: unknown, attributes?: SpanAttributes): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  process.stderr.write(
    JSON.stringify({ level: 'error', context, message, stack, ...attributes }) + '\n',
  );
}

/** Log a warning. */
export function logWarn(context: string, attributes?: SpanAttributes): void {
  process.stderr.write(JSON.stringify({ level: 'warn', context, ...attributes }) + '\n');
}

/** Internal debug logger — writes to stderr, never to stdout. */
function logDebug(context: string, attributes?: SpanAttributes): void {
  process.stderr.write(JSON.stringify({ level: 'debug', context, ...attributes }) + '\n');
}
