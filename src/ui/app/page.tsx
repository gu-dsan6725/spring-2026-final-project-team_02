'use client';

import { useState, useCallback } from 'react';

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

type AppPhase = 'input' | 'generating' | 'review' | 'evaluating' | 'results';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const btn: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  onNewMemo,
  showNewMemo,
}: {
  onNewMemo: () => void;
  showNewMemo: boolean;
}): React.ReactElement {
  return (
    <header
      className="py-5 px-8 flex items-center justify-between flex-shrink-0"
      style={{ backgroundColor: 'var(--color-navy)' }}
    >
      <div>
        <h1
          className="text-xl font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-gold)' }}
        >
          Policy Memo Agent
        </h1>
        <p
          className="text-xs mt-0.5 tracking-wide"
          style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-sans)' }}
        >
          HERALD Claim Evaluation
        </p>
      </div>
      {showNewMemo && (
        <button
          type="button"
          onClick={onNewMemo}
          className="text-xs tracking-wide hover:opacity-80 transition-opacity"
          style={{ ...btn, color: 'rgba(255,255,255,0.55)' }}
        >
          ← New Memo
        </button>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Post-generation nav (gold-underline tabs)
// ---------------------------------------------------------------------------

function NavTabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <nav
      className="flex flex-shrink-0"
      style={{
        backgroundColor: 'var(--color-navy-light)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => { onSelect(tab.id); }}
          className="px-6 py-3 text-sm font-medium tracking-wide transition-colors"
          style={{
            ...btn,
            color: active === tab.id ? 'var(--color-gold)' : 'rgba(255,255,255,0.5)',
            borderBottom: `2px solid ${active === tab.id ? 'var(--color-gold)' : 'transparent'}`,
          }}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Export row
// ---------------------------------------------------------------------------

function ExportRow({
  onExportMd,
  onExportDocx,
  onExportNotes,
  onExportHerald,
  onExportZip,
  hasHerald,
}: {
  onExportMd: () => void;
  onExportDocx: () => void;
  onExportNotes: () => void;
  onExportHerald: () => void;
  onExportZip: () => void;
  hasHerald: boolean;
}): React.ReactElement {
  const ghost: React.CSSProperties = {
    ...btn,
    padding: '0.3rem 0.7rem',
    borderRadius: '4px',
    border: '1px solid var(--color-paper-dark)',
    backgroundColor: 'var(--color-paper)',
    fontSize: '0.75rem',
    color: 'var(--color-navy)',
    transition: 'opacity 0.15s',
  };
  const solid: React.CSSProperties = {
    ...ghost,
    backgroundColor: 'var(--color-navy)',
    color: 'var(--color-gold)',
    borderColor: 'transparent',
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <span
        className="text-xs mr-1"
        style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
      >
        Export:
      </span>
      <button style={ghost} onClick={onExportMd} type="button">.md</button>
      <button style={ghost} onClick={onExportDocx} type="button">.docx</button>
      <button style={ghost} onClick={onExportNotes} type="button">notes.json</button>
      {hasHerald && (
        <button style={ghost} onClick={onExportHerald} type="button">HERALD.json</button>
      )}
      <button style={solid} onClick={onExportZip} type="button">Bundle .zip</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section heading used inside phases
// ---------------------------------------------------------------------------

function PhaseHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="mb-8">
      <h2
        className="text-3xl font-bold mb-2 leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
      >
        {title}
      </h2>
      {subtitle !== undefined && subtitle.length > 0 && (
        <p
          className="text-base italic"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-body)' }}
        >
          &ldquo;{subtitle}&rdquo;
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage(): React.ReactElement {
  const [appPhase, setAppPhase] = useState<AppPhase>('input');
  const [memoTopic, setMemoTopic] = useState('');
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'memo' | 'notes' | 'herald' | 'queue'>('memo');

  const agent = useAgent();
  const herald = useHerald();
  const { toasts, addToast, removeToast } = useToast();

  const memoSections = agent.memo !== null ? parseMemoSections(agent.memo.memo_markdown) : [];
  const isPostGeneration =
    appPhase === 'review' || appPhase === 'evaluating' || appPhase === 'results';

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (input: MemoInput): Promise<void> => {
      setMemoTopic(input.topic);
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

  const handleRunEvaluation = useCallback(
    async (selectedIds: string[]): Promise<void> => {
      if (agent.memo === null) return;
      setAppPhase('evaluating');
      await herald.evaluate(selectedIds, agent.memo.notes_log, agent.memo.memo_markdown);
      setAppPhase('results');
      setActiveTab('herald');
      addToast({ variant: 'info', message: 'HERALD evaluation complete.' });
    },
    [agent.memo, herald, addToast],
  );

  const handleVerdictSubmit = useCallback(
    async (
      claimId: string,
      submission: {
        verdict: 'valid' | 'invalid' | 'needs_revision' | 'uncertain';
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

  const handleExportMd = useCallback((): void => {
    if (agent.memo === null) return;
    exportAsMarkdown(agent.memo);
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

  const handleReset = useCallback((): void => {
    agent.reset();
    herald.reset();
    setAppPhase('input');
    setMemoTopic('');
    setSelectedClaimId(null);
    setActiveTab('memo');
  }, [agent, herald]);

  // ── Tabs ─────────────────────────────────────────────────────────────────

  const navTabs = [
    { id: 'memo', label: 'Memo' },
    { id: 'notes', label: 'Notes Log' },
    ...(appPhase === 'results'
      ? [
          { id: 'herald', label: 'HERALD Results' },
          ...(herald.humanQueue.filter((e) => e.status === 'pending').length > 0
            ? [{ id: 'queue', label: `Human Review (${herald.humanQueue.filter((e) => e.status === 'pending').length.toString()})` }]
            : []),
        ]
      : []),
  ];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-paper)' }}
    >
      <Header onNewMemo={handleReset} showNewMemo={appPhase !== 'input'} />

      {isPostGeneration && agent.memo !== null && (
        <NavTabBar
          tabs={navTabs}
          active={activeTab}
          onSelect={(id) => { setActiveTab(id as typeof activeTab); }}
        />
      )}

      <main className="flex-1 w-full px-6">

        {/* ── Phase 1: Input ── */}
        {appPhase === 'input' && (
          <div className="max-w-2xl mx-auto py-12">
            <div className="mb-10">
              <h2
                className="text-4xl font-bold mb-3 leading-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
              >
                Write a Policy Memo
              </h2>
              <p
                className="text-base"
                style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-body)' }}
              >
                Describe your topic and the agent will research it, classify every claim by type,
                and produce a sourced memo you can evaluate through the HERALD pipeline.
              </p>
            </div>
            <ErrorBoundary label="Input Form">
              <InputForm
                onSubmit={(input) => { void handleSubmit(input); }}
                isDisabled={false}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* ── Phase 2: Generating ── */}
        {appPhase === 'generating' && (
          <div className="max-w-lg mx-auto py-12">
            <ErrorBoundary label="Agent Progress">
              <PhaseHeading title="Researching" subtitle={memoTopic} />
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
                  className="mt-6 p-4 rounded-lg text-sm"
                  style={{
                    backgroundColor: '#fff5f5',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {agent.error}
                </div>
              )}
            </ErrorBoundary>
          </div>
        )}

        {/* ── Phases 3–5: Review / Evaluate / Results ── */}
        {isPostGeneration && agent.memo !== null && (
          <div className="max-w-6xl mx-auto py-6">
            <ExportRow
              onExportMd={handleExportMd}
              onExportDocx={() => { void handleExportDocx(); }}
              onExportNotes={handleExportNotes}
              onExportHerald={handleExportHerald}
              onExportZip={() => { void handleExportZip(); }}
              hasHerald={herald.results.length > 0}
            />

            {activeTab === 'memo' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  {appPhase === 'review' ? (
                    <ErrorBoundary label="Claim Selector">
                      <ClaimSelector
                        entries={agent.memo.notes_log}
                        onRunEvaluation={(ids) => { void handleRunEvaluation(ids); }}
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
                  <HeraldResults results={herald.results} notesLog={agent.memo.notes_log} />
                ) : (
                  <div
                    className="text-center py-16 text-sm"
                    style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
                  >
                    No HERALD results yet. Select claims in the Memo tab and run evaluation.
                  </div>
                )}
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
      </main>

      {/* HERALD evaluation overlay */}
      {appPhase === 'evaluating' && (
        <div
          className="fixed inset-0 flex items-center justify-center z-40"
          style={{ backgroundColor: 'rgba(26,26,46,0.55)' }}
        >
          <div
            className="rounded-xl p-8 flex flex-col items-center gap-4 shadow-2xl"
            style={{ backgroundColor: 'white', minWidth: '20rem' }}
          >
            <span
              className="inline-block w-9 h-9 rounded-full border-4 animate-spin"
              style={{ borderColor: 'var(--color-gold)', borderTopColor: 'transparent' }}
              aria-label="Evaluating"
            />
            <div className="text-center">
              <p
                className="text-sm font-semibold mb-1"
                style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
              >
                Running HERALD evaluation…
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}>
                {herald.progress.completed.toString()} / {herald.progress.total.toString()} claims
              </p>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown → MemoSection parser
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
          if (!current.claim_ids.includes(id)) current.claim_ids.push(id);
        }
      }
      contentBuffer.push(line);
    }
  }
  flushSection();
  return sections;
}
