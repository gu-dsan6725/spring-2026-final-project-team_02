'use client';

/**
 * useWebSocket — real-time pipeline event streaming hook.
 *
 * Connects to the WebSocket endpoint that emits progress events from
 * the research agent and HERALD evaluation pipeline.
 *
 * Supported event types:
 *   agent_step        — agent loop phase change (researching, writing, …)
 *   tool_call         — MCP tool invoked
 *   memo_ready        — memo generation complete, carries MemoOutput
 *   herald_update     — single claim evaluation finished, carries HeraldResult
 *   revision_update   — revision attempt result
 *   pipeline_complete — entire pipeline done
 *   error             — server-side error, carries message string
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import type { HeraldResult } from '@/types/herald';
import type { MemoOutput } from '@/types/memo';

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface AgentStepEvent {
  type: 'agent_step';
  step_id: string;
  label: string;
  detail: string;
  status: 'running' | 'complete' | 'error';
  tool_calls_used: number;
  tokens_used: number;
}

export interface ToolCallEvent {
  type: 'tool_call';
  tool_name: string;
  query: string;
  latency_ms: number;
  success: boolean;
}

export interface MemoReadyEvent {
  type: 'memo_ready';
  memo: MemoOutput;
}

export interface HeraldUpdateEvent {
  type: 'herald_update';
  result: HeraldResult;
  progress: { completed: number; total: number };
}

export interface RevisionUpdateEvent {
  type: 'revision_update';
  claim_id: string;
  attempt: number;
  status: 'revised' | 'failed' | 'unsupportable';
  new_claim_text: string | null;
}

export interface PipelineCompleteEvent {
  type: 'pipeline_complete';
  requires_human_intervention: string[];
  duration_ms: number;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type PipelineEvent =
  | AgentStepEvent
  | ToolCallEvent
  | MemoReadyEvent
  | HeraldUpdateEvent
  | RevisionUpdateEvent
  | PipelineCompleteEvent
  | ErrorEvent;

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseWebSocketOptions {
  /** URL of the WebSocket server. If null, the hook stays disconnected. */
  url: string | null;
  /** Maximum number of reconnect attempts before giving up. Default: 5 */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default: 1000 */
  retryDelayMs?: number;
}

export interface UseWebSocketReturn {
  status: ConnectionStatus;
  events: PipelineEvent[];
  /** Clear the event buffer (call when starting a new pipeline run). */
  clearEvents: () => void;
  /** Manually reconnect (e.g. after a user-initiated retry). */
  reconnect: () => void;
  /** Cumulative error message, if any. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * Parse a raw WebSocket message into a PipelineEvent.
 * Returns null if the message cannot be parsed.
 */
function parsePipelineEvent(raw: string): PipelineEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['type'] !== 'string') return null;
    return parsed as PipelineEvent;
  } catch {
    return null;
  }
}

export function useWebSocket({
  url,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so callbacks close over the latest url without re-registering
  const urlRef = useRef<string | null>(url);
  urlRef.current = url;

  const clearEvents = useCallback((): void => {
    setEvents([]);
    setError(null);
  }, []);

  const disconnect = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (wsRef.current !== null) {
      wsRef.current.onclose = null; // prevent retry on intentional disconnect
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const connect = useCallback((): void => {
    const currentUrl = urlRef.current;
    if (currentUrl === null) {
      disconnect();
      return;
    }

    setStatus('connecting');

    const ws = new WebSocket(currentUrl);
    wsRef.current = ws;

    ws.onopen = (): void => {
      setStatus('connected');
      setError(null);
      retryCountRef.current = 0;
    };

    ws.onmessage = (ev: MessageEvent<string>): void => {
      const event = parsePipelineEvent(ev.data);
      if (event === null) return;
      setEvents((prev) => [...prev, event]);
    };

    ws.onerror = (): void => {
      // onclose will fire next and handle retry
      setError('WebSocket connection error.');
    };

    ws.onclose = (): void => {
      wsRef.current = null;

      if (retryCountRef.current >= maxRetries) {
        setStatus('error');
        setError(`Connection lost after ${maxRetries.toString()} retries.`);
        return;
      }

      setStatus('connecting');
      const delay = retryDelayMs * Math.pow(2, retryCountRef.current);
      retryCountRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [disconnect, maxRetries, retryDelayMs]);

  // Connect when url becomes non-null; disconnect when it becomes null.
  useEffect(() => {
    if (url !== null) {
      retryCountRef.current = 0;
      connect();
    } else {
      disconnect();
    }

    return (): void => {
      disconnect();
    };
  }, [url]); // connect/disconnect are stable — intentionally omitted from deps

  const reconnect = useCallback((): void => {
    disconnect();
    retryCountRef.current = 0;
    if (urlRef.current !== null) {
      connect();
    }
  }, [connect, disconnect]);

  return { status, events, clearEvents, reconnect, error };
}

// ---------------------------------------------------------------------------
// Convenience selectors (consume the events array)
// ---------------------------------------------------------------------------

/** Filter events by type. */
export function filterEvents<T extends PipelineEvent>(
  events: PipelineEvent[],
  type: T['type'],
): T[] {
  return events.filter((e): e is T => e.type === type);
}

/** Extract the latest MemoOutput from events, or null if not yet received. */
export function latestMemo(events: PipelineEvent[]): MemoOutput | null {
  const memoEvents = filterEvents<MemoReadyEvent>(events, 'memo_ready');
  return memoEvents.at(-1)?.memo ?? null;
}

/** Extract all HeraldResults received so far. */
export function heraldResults(events: PipelineEvent[]): HeraldResult[] {
  return filterEvents<HeraldUpdateEvent>(events, 'herald_update').map((e) => e.result);
}

/** Get HERALD evaluation progress { completed, total } or null if not started. */
export function heraldProgress(
  events: PipelineEvent[],
): { completed: number; total: number } | null {
  const updates = filterEvents<HeraldUpdateEvent>(events, 'herald_update');
  return updates.at(-1)?.progress ?? null;
}
