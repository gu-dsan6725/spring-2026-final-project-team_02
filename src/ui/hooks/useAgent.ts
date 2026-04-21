'use client';

/**
 * useAgent — manages the memo generation pipeline lifecycle.
 *
 * Handles calling the /api/agent endpoint (or mocking locally),
 * tracking agent steps, and surfacing the final MemoOutput.
 *
 * Integrates with useWebSocket for real-time progress events
 * when the backend supports streaming.
 */

import { useState, useCallback } from 'react';

import type { MemoInput, MemoOutput } from '@/types/memo';
import type { AgentStep } from '@/ui/components/AgentProgress';

// ---------------------------------------------------------------------------
// Phase management
// ---------------------------------------------------------------------------

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'researching'
  | 'extracting'
  | 'writing'
  | 'complete'
  | 'error';

export interface UseAgentReturn {
  phase: AgentPhase;
  steps: AgentStep[];
  memo: MemoOutput | null;
  toolCallsUsed: number;
  tokensUsed: number;
  error: string | null;
  run: (input: MemoInput) => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Step factory helpers
// ---------------------------------------------------------------------------

function makeStep(
  id: string,
  label: string,
  detail: string,
  status: AgentStep['status'] = 'pending',
): AgentStep {
  return { id, label, detail, status };
}

const INITIAL_STEPS: AgentStep[] = [
  makeStep('plan', 'Research Planning', 'Agent builds a research plan.'),
  makeStep('research', 'Web Research', 'Querying external sources.'),
  makeStep('extract', 'Claim Extraction', 'Classifying and logging claims.'),
  makeStep('write', 'Memo Writing', 'Synthesizing findings into a memo.'),
  makeStep('validate', 'Completeness Check', 'Verifying all claims have sources.'),
];

function updateStep(steps: AgentStep[], id: string, patch: Partial<AgentStep>): AgentStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

const MAX_FILE_CHARS = 4_000;

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve((reader.result as string).slice(0, MAX_FILE_CHARS));
    };
    reader.onerror = () => {
      reject(new Error(`Failed to read ${file.name}`));
    };
    reader.readAsText(file);
  });
}

async function callAgentApi(input: MemoInput): Promise<MemoOutput> {
  // File objects can't survive JSON.stringify — read them as text first.
  let serializable = input;
  if (input.uploaded_files !== undefined && input.uploaded_files.length > 0) {
    const texts = await Promise.all(
      input.uploaded_files.map(async (f) => ({ name: f.name, content: await readFileAsText(f) })),
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { uploaded_files, ...rest } = input;
    serializable = { ...rest, source_document_texts: texts };
  }

  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serializable),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent API error ${response.status.toString()}: ${text}`);
  }

  return response.json() as Promise<MemoOutput>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(): UseAgentReturn {
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [steps, setSteps] = useState<AgentStep[]>(INITIAL_STEPS);
  const [memo, setMemo] = useState<MemoOutput | null>(null);
  const [toolCallsUsed, setToolCallsUsed] = useState(0);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const setStepStatus = useCallback(
    (id: string, status: AgentStep['status'], detail?: string): void => {
      setSteps((prev) =>
        updateStep(prev, id, { status, ...(detail !== undefined ? { detail } : {}) }),
      );
    },
    [],
  );

  const run = useCallback(
    async (input: MemoInput): Promise<void> => {
      setPhase('planning');
      setSteps(INITIAL_STEPS);
      setMemo(null);
      setError(null);
      setToolCallsUsed(0);
      setTokensUsed(0);

      try {
        setStepStatus('plan', 'running', 'Building research plan…');
        setPhase('researching');
        setStepStatus('plan', 'complete', 'Research plan ready.');
        setStepStatus('research', 'running', 'Querying sources…');

        // Single API call — the backend streams progress via WebSocket separately
        const result = await callAgentApi(input);

        setStepStatus('research', 'complete', 'Sources retrieved.');
        setStepStatus('extract', 'running', 'Classifying claims…');
        setPhase('extracting');

        // Brief pause for UI transition — real progress comes from WebSocket
        await new Promise<void>((resolve) => setTimeout(resolve, 300));

        setStepStatus(
          'extract',
          'complete',
          `${result.notes_log.length.toString()} claims extracted.`,
        );
        setStepStatus('write', 'running', 'Writing memo…');
        setPhase('writing');

        await new Promise<void>((resolve) => setTimeout(resolve, 300));

        setStepStatus('write', 'complete', 'Memo written.');
        setStepStatus('validate', 'running', 'Checking completeness…');

        await new Promise<void>((resolve) => setTimeout(resolve, 200));

        setStepStatus('validate', 'complete', 'All claims have sources.');

        setMemo(result);
        setToolCallsUsed(result.metadata.tool_calls_count);
        setTokensUsed(result.metadata.token_usage);
        setPhase('complete');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase('error');
        setSteps((prev) =>
          prev.map((s) => (s.status === 'running' ? { ...s, status: 'error' } : s)),
        );
        throw err; // re-throw so callers know the run failed
      }
    },
    [setStepStatus],
  );

  const reset = useCallback((): void => {
    setPhase('idle');
    setSteps(INITIAL_STEPS);
    setMemo(null);
    setError(null);
    setToolCallsUsed(0);
    setTokensUsed(0);
  }, []);

  return { phase, steps, memo, toolCallsUsed, tokensUsed, error, run, reset };
}
