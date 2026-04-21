export type AgentProgressPhase = 'planning' | 'researching' | 'writing' | 'complete' | 'error';

export interface AgentProgressSnapshot {
  run_id: string;
  phase: AgentProgressPhase;
  tool_calls_used: number;
  tokens_used: number;
  updated_at: string;
  error?: string;
}

const RUN_TTL_MS = 30 * 60 * 1000;

const progressStore = new Map<string, { snapshot: AgentProgressSnapshot; expiresAt: number }>();

function pruneExpiredRuns(): void {
  const now = Date.now();
  for (const [runId, entry] of progressStore.entries()) {
    if (entry.expiresAt <= now) {
      progressStore.delete(runId);
    }
  }
}

function writeSnapshot(
  runId: string,
  snapshot: Omit<AgentProgressSnapshot, 'run_id' | 'updated_at'>,
): void {
  pruneExpiredRuns();
  progressStore.set(runId, {
    snapshot: {
      run_id: runId,
      updated_at: new Date().toISOString(),
      ...snapshot,
    },
    expiresAt: Date.now() + RUN_TTL_MS,
  });
}

export function initRunProgress(runId: string): void {
  writeSnapshot(runId, {
    phase: 'planning',
    tool_calls_used: 0,
    tokens_used: 0,
  });
}

export function updateRunProgress(
  runId: string,
  patch: Partial<Omit<AgentProgressSnapshot, 'run_id' | 'updated_at'>>,
): void {
  const existing = progressStore.get(runId)?.snapshot;
  writeSnapshot(runId, {
    phase: patch.phase ?? existing?.phase ?? 'planning',
    tool_calls_used: patch.tool_calls_used ?? existing?.tool_calls_used ?? 0,
    tokens_used: patch.tokens_used ?? existing?.tokens_used ?? 0,
    ...(patch.error !== undefined
      ? { error: patch.error }
      : existing?.error !== undefined
        ? { error: existing.error }
        : {}),
  });
}

export function getRunProgress(runId: string): AgentProgressSnapshot | null {
  pruneExpiredRuns();
  return progressStore.get(runId)?.snapshot ?? null;
}
