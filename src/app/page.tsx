'use client';

/**
 * Main application page — Policy Memo Writing Agent with HERALD Evaluation.
 *
 * Phases:
 *   1. Input    — user fills InputForm
 *   2. Research — agent runs (progress in AgentProgress)
 *   3. Review   — user reads memo + selects claims for HERALD
 *   4. Herald   — evaluation + feedback loop + human review queue
 */

import { useState, useCallback, useMemo } from 'react';

import InputForm from '@/ui/components/InputForm';
import AgentProgress from '@/ui/components/AgentProgress';
import MemoViewer from '@/ui/components/MemoViewer';
import NotesLog from '@/ui/components/NotesLog';
import ClaimSelector from '@/ui/components/ClaimSelector';
import HeraldResults from '@/ui/components/HeraldResults';
import HumanReviewQueue from '@/ui/components/HumanReviewQueue';
import ErrorBoundary from '@/ui/components/ErrorBoundary';
import { ToastContainer, useToast } from '@/ui/components/Toast';
import { useAgent } from '@/ui/hooks/useAgent';
import { useHerald } from '@/ui/hooks/useHerald';
import type { MemoInput } from '@/types/memo';
import {
  exportAsMarkdown,
  exportAsDocx,
  exportNotesLog,
  exportHeraldReport,
  exportAsZip,
} from '@/ui/utils/exportMemo';

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

type AppPhase = 'input' | 'generating' | 'review' | 'evaluating' | 'results';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header(): React.ReactElement {
  return (
    <header
      className="w-full border-b px-6 py-4 flex items-center justify-between"
      style={{
        backgroundColor: 'var(--color-navy, #0b2545)',
        borderColor: 'var(--color-navy-dark, #071b38)',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="text-xl font-bold tracking-wide"
          style={{ color: 'var(--color-gold, #d4af37)', fontFamily: 'var(--font-serif, serif)' }}
        >
          HERALD
        </span>
        <span className="text-sm opacity-60" style={{ color: 'white' }}>
          Policy Memo Agent
        </span>
      </div>
      <nav className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <a
          href="https://github.com/gu-dsan6725"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-100 transition-opacity"
        >
          GitHub
        </a>
        <span>•</span>
        <span>DSAN 6725</span>
      </nav>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Export toolbar
// ---------------------------------------------------------------------------

interface ExportToolbarProps {
  onExportMd: () => void;
  onExportDocx: () => void;
  onExportNotes: () => void;
  onExportHerald: () => void;
  onExportZip: () => void;
  hasHerald: boolean;
}

function ExportToolbar({
  onExportMd,
  onExportDocx,
  onExportNotes,
  onExportHerald,
  onExportZip,
  hasHerald,
}: ExportToolbarProps): React.ReactElement {
  const btnStyle: React.CSSProperties = {
    padding: '0.4rem 0.85rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--color-paper-dark, #ddd)',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-sans, sans-serif)',
    color: 'var(--color-navy, #0b2545)',
    transition: 'background-color 0.15s',
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-xs font-medium opacity-60 mr-1"
        style={{ fontFamily: 'var(--font-sans, sans-serif)' }}
      >
        Export:
      </span>
      <button style={btnStyle} onClick={onExportMd} type="button">
        .md
      </button>
      <button style={btnStyle} onClick={onExportDocx} type="button">
        .docx
      </button>
      <button style={btnStyle} onClick={onExportNotes} type="button">
        notes.json
      </button>
      {hasHerald && (
        <button style={btnStyle} onClick={onExportHerald} type="button">
          HERALD.json
        </button>
      )}
      <button
        style={{
          ...btnStyle,
          backgroundColor: 'var(--color-navy, #0b2545)',
          color: 'white',
          borderColor: 'transparent',
        }}
        onClick={onExportZip}
        type="button"
      >
        Bundle .zip
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase step indicator
// ---------------------------------------------------------------------------

const PHASE_STEPS: { id: AppPhase; label: string }[] = [
  { id: 'input', label: '1. Input' },
  { id: 'generating', label: '2. Generate' },
  { id: 'review', label: '3. Review' },
  { id: 'evaluating', label: '4. Evaluate' },
  { id: 'results', label: '5. Results' },
];

function PhaseIndicator({ current }: { current: AppPhase }): React.ReactElement {
  const order: AppPhase[] = ['input', 'generating', 'review', 'evaluating', 'results'];
  const currentIdx = order.indexOf(current);

  return (
    <div className="flex items-center gap-0">
      {PHASE_STEPS.map((step, i) => {
        const idx = order.indexOf(step.id);
        const done = idx < currentIdx;
        const active = idx === currentIdx;

        return (
          <div key={step.id} className="flex items-center">
            <span
              className="px-3 py-1 text-xs rounded-full font-medium transition-all"
              style={{
                backgroundColor: active
                  ? 'var(--color-gold, #d4af37)'
                  : done
                    ? 'var(--color-navy, #0b2545)'
                    : 'var(--color-paper-dark, #e5e0d5)',
                color: active ? 'var(--color-navy, #0b2545)' : done ? 'white' : '#6b7280',
                fontFamily: 'var(--font-sans, sans-serif)',
              }}
            >
              {done ? '✓ ' : ''}
              {step.label}
            </span>
            {i < PHASE_STEPS.length - 1 && <span className="mx-1 text-gray-300 text-xs">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage(): React.ReactElement {
  const [appPhase, setAppPhase] = useState<AppPhase>('input');
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'memo' | 'notes' | 'herald' | 'evaluate' | 'queue'>(
    'memo',
  );

  const agent = useAgent();
  const herald = useHerald();
  const { toasts, addToast, removeToast } = useToast();

  // ── Memo sections (extracted from raw markdown for MemoViewer) ──────────
  const memoSections = agent.memo !== null ? parseMemoSections(agent.memo.memo_markdown) : [];

  // ── Agent submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (input: MemoInput): Promise<void> => {
      setAppPhase('generating');
      try {
        await agent.run(input);
        setAppPhase('review');
        addToast({ variant: 'success', message: 'Memo generated. Select claims to evaluate.' });
      } catch {
        // agent.run already set agent.error — stay in 'generating' so the error is visible
      }
    },
    [agent, addToast],
  );

  // ── HERALD evaluation ────────────────────────────────────────────────────
  const handleRunEvaluation = useCallback(
    async (selectedIds: string[]): Promise<void> => {
      if (agent.memo === null) return;
      setAppPhase('evaluating');
      await herald.evaluate(selectedIds, agent.memo.notes_log, agent.memo.memo_markdown);
      setAppPhase('results');
      setActiveTab('herald');

      // Apply any auto-revisions back into the memo viewer and notes log
      if (herald.updatedMemoMarkdown !== null && herald.updatedNotesLog !== null) {
        agent.updateMemo(herald.updatedMemoMarkdown, herald.updatedNotesLog);
      }

      const revisedCount = herald.revisionStates.filter((s) => s.status === 'revised').length;
      const flaggedCount = herald.revisionStates.filter(
        (s) => s.status === 'failed_max_attempts',
      ).length;

      if (revisedCount > 0 || flaggedCount > 0) {
        addToast({
          variant: revisedCount > 0 ? 'success' : 'info',
          message: [
            'HERALD evaluation complete.',
            revisedCount > 0 ? `${revisedCount.toString()} claim(s) auto-revised.` : '',
            flaggedCount > 0 ? `${flaggedCount.toString()} claim(s) flagged for human review.` : '',
          ]
            .filter(Boolean)
            .join(' '),
        });
      } else {
        addToast({ variant: 'info', message: 'HERALD evaluation complete.' });
      }
    },
    [agent, herald, addToast],
  );

  // ── Set of already-evaluated claim IDs ───────────────────────────────────
  const evaluatedClaimIds = useMemo(
    () => new Set(herald.results.map((r) => r.claim_id)),
    [herald.results],
  );

  // ── Human verdict submission ─────────────────────────────────────────────
  const handleVerdictSubmit = useCallback(
    async (
      claimId: string,
      submission: {
        verdict: 'valid' | 'invalid' | 'uncertain' | 'needs_revision';
        notes: string;
        suggested_revision?: string;
      },
    ): Promise<void> => {
      await herald.submitVerdict(
        claimId,
        submission.verdict,
        submission.notes,
        submission.suggested_revision,
      );
      addToast({ variant: 'success', message: `Verdict recorded for ${claimId}.` });
    },
    [herald, addToast],
  );

  // ── Export handlers ──────────────────────────────────────────────────────
  const handleExportMd = useCallback((): void => {
    if (agent.memo === null) return;
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    exportAsMarkdown(agent.memo, `policy-memo-${ts}.md`);
    addToast({ variant: 'success', message: 'Markdown exported.' });
  }, [agent.memo, addToast]);

  const handleExportDocx = useCallback(async (): Promise<void> => {
    if (agent.memo === null) return;
    try {
      await exportAsDocx(agent.memo);
      addToast({ variant: 'success', message: 'Word document exported.' });
    } catch {
      addToast({ variant: 'error', message: 'Failed to export .docx.' });
    }
  }, [agent.memo, addToast]);

  const handleExportNotes = useCallback((): void => {
    if (agent.memo === null) return;
    exportNotesLog(agent.memo.notes_log);
    addToast({ variant: 'success', message: 'Notes log exported.' });
  }, [agent.memo, addToast]);

  const handleExportHerald = useCallback((): void => {
    if (herald.results.length === 0) return;
    exportHeraldReport(herald.results);
    addToast({ variant: 'success', message: 'HERALD report exported.' });
  }, [herald.results, addToast]);

  const handleExportZip = useCallback(async (): Promise<void> => {
    if (agent.memo === null) return;
    try {
      await exportAsZip({
        memo: agent.memo,
        heraldResults: herald.results.length > 0 ? herald.results : undefined,
      });
      addToast({ variant: 'success', message: 'Bundle downloaded.' });
    } catch {
      addToast({ variant: 'error', message: 'Failed to create zip bundle.' });
    }
  }, [agent.memo, herald.results, addToast]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback((): void => {
    agent.reset();
    herald.reset();
    setAppPhase('input');
    setSelectedClaimId(null);
    setActiveTab('memo');
  }, [agent, herald]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-paper, #faf8f5)' }}
    >
      <Header />

      {/* Phase indicator */}
      <div
        className="w-full border-b px-6 py-2 flex items-center justify-between"
        style={{
          backgroundColor: 'var(--color-paper, #faf8f5)',
          borderColor: 'var(--color-paper-dark, #e5e0d5)',
        }}
      >
        <PhaseIndicator current={appPhase} />
        {appPhase !== 'input' && (
          <button
            onClick={handleReset}
            className="text-xs opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-navy, #0b2545)',
              fontFamily: 'var(--font-sans, sans-serif)',
            }}
            type="button"
          >
            ← Start over
          </button>
        )}
      </div>

      {/* Main content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        {/* Phase 1: Input */}
        {appPhase === 'input' && (
          <ErrorBoundary label="Input Form">
            <InputForm
              onSubmit={(input) => {
                void handleSubmit(input);
              }}
              isDisabled={false}
            />
          </ErrorBoundary>
        )}

        {/* Phase 2: Generating */}
        {appPhase === 'generating' && (
          <ErrorBoundary label="Agent Progress">
            <div className="max-w-2xl mx-auto">
              <h2
                className="text-xl font-semibold mb-4"
                style={{
                  color: 'var(--color-navy, #0b2545)',
                  fontFamily: 'var(--font-serif, serif)',
                }}
              >
                Generating Policy Memo…
              </h2>
              <AgentProgress
                steps={agent.steps}
                toolCallsUsed={agent.toolCallsUsed}
                toolCallsBudget={25}
                tokensUsed={agent.tokensUsed}
                tokensBudget={50000}
              />
              {agent.error !== null && (
                <div
                  role="alert"
                  className="mt-4 p-4 rounded-lg text-sm"
                  style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}
                >
                  {agent.error}
                </div>
              )}
            </div>
          </ErrorBoundary>
        )}

        {/* Phases 3–5: Review / Evaluate / Results */}
        {(appPhase === 'review' || appPhase === 'evaluating' || appPhase === 'results') &&
          agent.memo !== null && (
            <div className="flex flex-col gap-4">
              {/* Tab bar + export toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className="flex gap-1 rounded-lg p-1"
                  style={{ backgroundColor: 'var(--color-paper-dark, #e5e0d5)' }}
                >
                  {(
                    [
                      { id: 'memo', label: 'Memo' },
                      { id: 'notes', label: 'Notes Log' },
                      ...(appPhase === 'results'
                        ? [
                            { id: 'herald', label: 'HERALD Results' },
                            {
                              id: 'evaluate',
                              label:
                                evaluatedClaimIds.size > 0
                                  ? `Evaluate More (${(agent.memo.notes_log.length - evaluatedClaimIds.size).toString()} left)`
                                  : 'Evaluate',
                            },
                            ...(herald.humanQueue.length > 0
                              ? [
                                  {
                                    id: 'queue',
                                    label: `Human Review (${herald.humanQueue.filter((e) => e.status === 'pending').length.toString()})`,
                                  },
                                ]
                              : []),
                          ]
                        : []),
                    ] as { id: string; label: string }[]
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => {
                        setActiveTab(id as typeof activeTab);
                      }}
                      type="button"
                      className="px-4 py-1.5 text-sm rounded-md transition-all cursor-pointer"
                      style={{
                        backgroundColor: activeTab === id ? 'white' : 'transparent',
                        color: activeTab === id ? 'var(--color-navy, #0b2545)' : 'rgba(0,0,0,0.5)',
                        fontFamily: 'var(--font-sans, sans-serif)',
                        fontWeight: activeTab === id ? 600 : 400,
                        border: 'none',
                        boxShadow: activeTab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <ExportToolbar
                  onExportMd={handleExportMd}
                  onExportDocx={() => {
                    void handleExportDocx();
                  }}
                  onExportNotes={handleExportNotes}
                  onExportHerald={handleExportHerald}
                  onExportZip={() => {
                    void handleExportZip();
                  }}
                  hasHerald={herald.results.length > 0}
                />
              </div>

              {/* Tab content */}
              {activeTab === 'memo' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2">
                    <ErrorBoundary label="Memo Viewer" resetKey={activeTab}>
                      <MemoViewer
                        title="Policy Memo"
                        sections={memoSections}
                        notesLog={agent.memo.notes_log}
                        selectedClaimId={selectedClaimId}
                        onClaimClick={setSelectedClaimId}
                      />
                    </ErrorBoundary>
                  </div>
                  <div>
                    {appPhase === 'review' || appPhase === 'results' ? (
                      <ErrorBoundary label="Claim Selector">
                        <ClaimSelector
                          entries={agent.memo.notes_log}
                          onRunEvaluation={(ids) => {
                            void handleRunEvaluation(ids);
                          }}
                          alreadyEvaluated={evaluatedClaimIds}
                        />
                      </ErrorBoundary>
                    ) : (
                      <ErrorBoundary label="Notes Log">
                        <NotesLog
                          entries={agent.memo.notes_log}
                          selectedClaimId={selectedClaimId}
                          onClaimSelect={setSelectedClaimId}
                        />
                      </ErrorBoundary>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'notes' && (
                <ErrorBoundary label="Notes Log">
                  <NotesLog
                    entries={agent.memo.notes_log}
                    selectedClaimId={selectedClaimId}
                    onClaimSelect={setSelectedClaimId}
                  />
                </ErrorBoundary>
              )}

              {activeTab === 'herald' && appPhase === 'results' && (
                <ErrorBoundary label="HERALD Results">
                  {herald.results.length > 0 ? (
                    <HeraldResults
                      results={herald.results}
                      notesLog={agent.memo.notes_log}
                      revisionStates={herald.revisionStates}
                    />
                  ) : (
                    <div
                      className="text-center py-12 text-sm opacity-50"
                      style={{ fontFamily: 'var(--font-sans, sans-serif)' }}
                    >
                      No HERALD results yet. Select claims and run evaluation.
                    </div>
                  )}
                </ErrorBoundary>
              )}

              {activeTab === 'evaluate' && appPhase === 'results' && (
                <ErrorBoundary label="Evaluate More">
                  <div className="max-w-2xl mx-auto">
                    <ClaimSelector
                      entries={agent.memo.notes_log}
                      onRunEvaluation={(ids) => {
                        void handleRunEvaluation(ids);
                      }}
                      alreadyEvaluated={evaluatedClaimIds}
                    />
                  </div>
                </ErrorBoundary>
              )}

              {activeTab === 'queue' && appPhase === 'results' && (
                <ErrorBoundary label="Human Review Queue">
                  <HumanReviewQueue
                    entries={herald.humanQueue}
                    onSubmitVerdict={handleVerdictSubmit}
                  />
                </ErrorBoundary>
              )}
            </div>
          )}

        {/* Evaluation loading overlay */}
        {appPhase === 'evaluating' && (
          <div
            className="fixed inset-0 flex items-center justify-center z-40"
            style={{ backgroundColor: 'rgba(11,37,69,0.4)' }}
          >
            <div
              className="rounded-xl p-8 flex flex-col items-center gap-4 shadow-xl"
              style={{ backgroundColor: 'white', minWidth: '18rem' }}
            >
              <span
                className="inline-block w-8 h-8 rounded-full border-4 border-t-transparent animate-spin"
                style={{
                  borderColor: 'var(--color-gold, #d4af37)',
                  borderTopColor: 'transparent',
                }}
                aria-label="Evaluating"
              />
              <p
                className="text-sm font-medium"
                style={{
                  color: 'var(--color-navy, #0b2545)',
                  fontFamily: 'var(--font-sans, sans-serif)',
                }}
              >
                Running HERALD evaluation…
              </p>
              <p className="text-xs opacity-50">
                {herald.progress.completed.toString()} / {herald.progress.total.toString()} claims
              </p>
            </div>
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown → MemoSection parser (minimal, matches what the agent produces)
// ---------------------------------------------------------------------------

import type { MemoSection } from '@/types/memo';

function parseMemoSections(markdown: string): MemoSection[] {
  const lines = markdown.split('\n');
  const sections: MemoSection[] = [];
  let current: MemoSection | null = null;
  const contentBuffer: string[] = [];

  function flushSection(): void {
    if (current !== null) {
      current.content = contentBuffer.join('\n').trim();
      sections.push(current);
    }
    contentBuffer.length = 0;
  }

  for (const line of lines) {
    const h2 = /^## (.+)$/.exec(line);
    const h1 = /^# (.+)$/.exec(line);
    if (h1 !== null && sections.length === 0 && current === null) {
      flushSection();
      current = { title: h1[1], content: '', claim_ids: [] };
    } else if (h2 !== null) {
      flushSection();
      current = { title: h2[1], content: '', claim_ids: [] };
    } else {
      const claimMatches = [...line.matchAll(/\[C-(\d{3,})\]/g)];
      if (current !== null && claimMatches.length > 0) {
        for (const m of claimMatches) {
          const id = `C-${m[1]}`;
          if (!current.claim_ids.includes(id)) {
            current.claim_ids.push(id);
          }
        }
      }
      contentBuffer.push(line);
    }
  }
  flushSection();

  return sections;
}
