'use client';

/**
 * useHerald — manages the HERALD evaluation + feedback loop lifecycle.
 *
 * Calls /api/herald/evaluate for claim evaluation, tracks per-claim progress,
 * and surfaces revision states and human-review queue entries.
 */

import { useState, useCallback } from 'react';

import type { NotesLogEntry } from '@/types/claims';
import type { HeraldResult } from '@/types/herald';
import type { HumanReviewEntry } from '@/herald/tier4-human';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type HeraldPhase = 'idle' | 'evaluating' | 'revising' | 'complete' | 'error';

export interface HeraldProgress {
  completed: number;
  total: number;
}

export interface UseHeraldReturn {
  phase: HeraldPhase;
  results: HeraldResult[];
  progress: HeraldProgress;
  humanQueue: HumanReviewEntry[];
  error: string | null;
  evaluate: (claimIds: string[], notesLog: NotesLogEntry[], memoMarkdown: string) => Promise<void>;
  submitVerdict: (
    claimId: string,
    verdict: HumanReviewEntry['verdict'],
    notes: string,
    suggestedRevision?: string,
  ) => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface EvaluateRequest {
  claim_ids: string[];
  notes_log: NotesLogEntry[];
  memo_markdown: string;
}

interface EvaluateResponse {
  results: HeraldResult[];
  requires_human_intervention: string[];
  human_queue: HumanReviewEntry[];
}

async function callEvaluateApi(req: EvaluateRequest): Promise<EvaluateResponse> {
  const response = await fetch('/api/herald/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HERALD API error ${response.status.toString()}: ${text}`);
  }

  return response.json() as Promise<EvaluateResponse>;
}

interface VerdictRequest {
  claim_id: string;
  verdict: HumanReviewEntry['verdict'];
  notes: string;
  suggested_revision?: string;
  memo_id: string;
}

async function callVerdictApi(req: VerdictRequest): Promise<{ updated_queue: HumanReviewEntry[] }> {
  const response = await fetch('/api/herald/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Verdict API error ${response.status.toString()}: ${text}`);
  }

  return response.json() as Promise<{ updated_queue: HumanReviewEntry[] }>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHerald(): UseHeraldReturn {
  const [phase, setPhase] = useState<HeraldPhase>('idle');
  const [results, setResults] = useState<HeraldResult[]>([]);
  const [progress, setProgress] = useState<HeraldProgress>({ completed: 0, total: 0 });
  const [humanQueue, setHumanQueue] = useState<HumanReviewEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const evaluate = useCallback(
    async (claimIds: string[], notesLog: NotesLogEntry[], memoMarkdown: string): Promise<void> => {
      setPhase('evaluating');
      setResults([]);
      setProgress({ completed: 0, total: claimIds.length });
      setHumanQueue([]);
      setError(null);

      try {
        const response = await callEvaluateApi({
          claim_ids: claimIds,
          notes_log: notesLog,
          memo_markdown: memoMarkdown,
        });

        setResults(response.results);
        setHumanQueue(response.human_queue);
        setProgress({ completed: claimIds.length, total: claimIds.length });
        setPhase('complete');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase('error');
      }
    },
    [],
  );

  const submitVerdict = useCallback(
    async (
      claimId: string,
      verdict: HumanReviewEntry['verdict'],
      notes: string,
      suggestedRevision?: string,
    ): Promise<void> => {
      try {
        const response = await callVerdictApi({
          claim_id: claimId,
          verdict,
          notes,
          suggested_revision: suggestedRevision,
          memo_id: 'current',
        });
        setHumanQueue(response.updated_queue);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    },
    [],
  );

  const reset = useCallback((): void => {
    setPhase('idle');
    setResults([]);
    setProgress({ completed: 0, total: 0 });
    setHumanQueue([]);
    setError(null);
  }, []);

  return { phase, results, progress, humanQueue, error, evaluate, submitVerdict, reset };
}
