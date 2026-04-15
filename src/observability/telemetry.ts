/**
 * OpenTelemetry setup for development tracing.
 *
 * In development (no OTEL_EXPORTER_OTLP_ENDPOINT set) all spans are printed
 * to the console so you can see the pipeline structure without running a
 * collector.  In production, set OTEL_EXPORTER_OTLP_ENDPOINT to ship traces
 * to any OTLP-compatible backend (Jaeger, Tempo, Honeycomb, etc.).
 *
 * Call initTelemetry() once at application startup (e.g. in the Next.js
 * instrumentation.ts file or in the Express/Fastify bootstrap).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';

let _sdk: NodeSDK | null = null;
let _initialised = false;

export interface TelemetryConfig {
  /** Service name that appears in traces. Defaults to OTEL_SERVICE_NAME env var. */
  serviceName?: string;
  /** OTLP endpoint override. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT env var. */
  otlpEndpoint?: string;
}

/**
 * Initialise the OpenTelemetry SDK.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initTelemetry(config: TelemetryConfig = {}): void {
  if (_initialised) return;
  _initialised = true;

  const serviceName = config.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'policy-memo-agent';

  const otlpEndpoint = config.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  const isDev = process.env['NODE_ENV'] !== 'production';

  // Choose exporter: OTLP if endpoint configured, console otherwise
  const exporter =
    otlpEndpoint !== undefined && otlpEndpoint.length > 0
      ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
      : new ConsoleSpanExporter();

  _sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
    spanProcessor: new SimpleSpanProcessor(exporter),
  });

  try {
    _sdk.start();
    if (isDev && (otlpEndpoint === undefined || otlpEndpoint.length === 0)) {
      process.stderr.write(
        JSON.stringify({
          level: 'info',
          context: 'telemetry',
          message: `OpenTelemetry started (service: ${serviceName}, exporter: console)`,
        }) + '\n',
      );
    } else {
      process.stderr.write(
        JSON.stringify({
          level: 'info',
          context: 'telemetry',
          message: `OpenTelemetry started (service: ${serviceName}, exporter: OTLP → ${otlpEndpoint ?? 'default'})`,
        }) + '\n',
      );
    }
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        context: 'telemetry',
        message: `OpenTelemetry init failed (non-fatal): ${String(err)}`,
      }) + '\n',
    );
  }
}

/**
 * Gracefully shut down the OpenTelemetry SDK (flushes pending spans).
 * Call this in process exit handlers.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (_sdk === null) return;
  try {
    await _sdk.shutdown();
  } catch {
    // ignore shutdown errors
  }
}
