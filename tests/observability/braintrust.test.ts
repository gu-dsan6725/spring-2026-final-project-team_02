import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError, logToolCall, logWarn, startSpan } from '../../src/observability/braintrust';

describe('braintrust observability helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs span lifecycle with and without attributes', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const span = startSpan('test_span');
    span.log({ phase: 'mid' });
    span.end({ ok: true });

    startSpan('test_span_with_attrs', { topic: 'coverage' }).end();

    const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"context":"[span:start] test_span"');
    expect(output).toContain('"context":"[span:log] test_span"');
    expect(output).toContain('"context":"[span:end] test_span"');
    expect(output).toContain('"context":"[span:start] test_span_with_attrs"');
    expect(output).toContain('"topic":"coverage"');
  });

  it('logs tool calls, warnings, and Error instances', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    logToolCall('arxiv_search', { query: 'UBI Africa' }, 'x'.repeat(250), 42);
    logWarn('budget:warn', { tool_calls_used: 8 });
    logError('research_agent:fatal', new Error('boom'), { topic: 'UBI' });

    const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"context":"[tool_call]"');
    expect(output).toContain('"tool":"arxiv_search"');
    expect(output).toContain('"output_preview"');
    expect(output).toContain('"context":"budget:warn"');
    expect(output).toContain('"context":"research_agent:fatal"');
    expect(output).toContain('"message":"boom"');
    expect(output).toContain('"stack"');
  });

  it('stringifies non-Error values passed to logError', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    logError('tool:test', 'plain failure');

    const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('"context":"tool:test"');
    expect(output).toContain('"message":"plain failure"');
  });
});
