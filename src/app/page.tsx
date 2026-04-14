'use client';

import { useState, useEffect, useRef } from 'react';
import InputForm from '@/ui/components/InputForm';
import AgentProgress, { type AgentStep } from '@/ui/components/AgentProgress';
import type { MemoInput } from '@/types/memo';

// ---------------------------------------------------------------------------
// Phase and tab types
// ---------------------------------------------------------------------------

type AppPhase = 'input' | 'generating' | 'review' | 'evaluate' | 'herald';

interface PostGenerationTab {
  id: Extract<AppPhase, 'review' | 'evaluate' | 'herald'>;
  label: string;
}

const POST_GENERATION_TABS: PostGenerationTab[] = [
  { id: 'review', label: 'Memo' },
  { id: 'evaluate', label: 'Evaluate Claims' },
  { id: 'herald', label: 'HERALD Results' },
];

// ---------------------------------------------------------------------------
// Default agent steps — updated via WebSocket/polling in production
// ---------------------------------------------------------------------------

const INITIAL_STEPS: AgentStep[] = [
  { id: 'plan', label: 'Research Plan', detail: 'Waiting to start…', status: 'pending' },
  { id: 'research', label: 'Executing Research', detail: 'Tool calls pending…', status: 'pending' },
  { id: 'extract', label: 'Extracting Claims', detail: 'Building notes log…', status: 'pending' },
  { id: 'write', label: 'Writing Memo', detail: 'Synthesising findings…', status: 'pending' },
];

// ---------------------------------------------------------------------------
// Placeholder content for post-generation phases (replaced by 4.2 / 4.3)
// ---------------------------------------------------------------------------

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg min-h-64"
      style={{ backgroundColor: 'var(--color-paper-dark)' }}
    >
      <p
        className="text-sm"
        style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
      >
        {label} — implemented in checkpoint 4.2 / 4.3
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Page() {
  const [phase, setPhase] = useState<AppPhase>('input');
  const [memoInput, setMemoInput] = useState<MemoInput | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>(INITIAL_STEPS);
  const [toolCallsUsed, setToolCallsUsed] = useState(0);
  const [tokensUsed, setTokensUsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling stub — replace with WebSocket subscription when backend is live.
  // Polls /api/agent/progress?input_id=... and updates step/budget state.
  const startPolling = (input: MemoInput): void => {
    // Activate first step
    setSteps((prev) =>
      prev.map((s, i) => (i === 0 ? { ...s, status: 'running', detail: 'Planning queries…' } : s)),
    );

    // Placeholder simulation — remove once real API exists
    let tick = 0;
    pollRef.current = setInterval(() => {
      tick += 1;
      setToolCallsUsed((n) => Math.min(n + 2, 25));
      setTokensUsed((n) => Math.min(n + 1500, 50000));

      if (tick === 3) {
        setSteps((prev) =>
          prev.map((s, i) => {
            if (i === 0) return { ...s, status: 'complete', detail: 'Plan created.' };
            if (i === 1)
              return {
                ...s,
                status: 'running',
                detail: `Searching: "${input.topic.slice(0, 40)}…"`,
              };
            return s;
          }),
        );
      }
      if (tick === 6) {
        setSteps((prev) =>
          prev.map((s, i) => {
            if (i === 1) return { ...s, status: 'complete', detail: 'Research complete.' };
            if (i === 2) return { ...s, status: 'running', detail: 'Classifying claims…' };
            return s;
          }),
        );
      }
      if (tick === 9) {
        setSteps((prev) =>
          prev.map((s, i) => {
            if (i === 2) return { ...s, status: 'complete', detail: 'Notes log built.' };
            if (i === 3) return { ...s, status: 'running', detail: 'Writing memo…' };
            return s;
          }),
        );
      }
      if (tick >= 12) {
        setSteps((prev) =>
          prev.map((s, i) => (i === 3 ? { ...s, status: 'complete', detail: 'Memo ready.' } : s)),
        );
        if (pollRef.current !== null) clearInterval(pollRef.current);
        setPhase('review');
      }
    }, 1000);
  };

  const handleFormSubmit = (input: MemoInput): void => {
    setMemoInput(input);
    setPhase('generating');
    setSteps(INITIAL_STEPS);
    setToolCallsUsed(0);
    setTokensUsed(0);
    startPolling(input);
  };

  const handleTabClick = (tab: Extract<AppPhase, 'review' | 'evaluate' | 'herald'>): void => {
    setPhase(tab);
  };

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const isPostGeneration = phase === 'review' || phase === 'evaluate' || phase === 'herald';

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--color-paper)' }}>
      {/* ── Header ── */}
      <header
        className="py-5 px-8 flex items-center justify-between"
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
            style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-sans)' }}
          >
            HERALD Claim Evaluation
          </p>
        </div>
        {memoInput !== null && (
          <button
            type="button"
            onClick={() => {
              if (pollRef.current !== null) clearInterval(pollRef.current);
              setPhase('input');
              setMemoInput(null);
              setSteps(INITIAL_STEPS);
              setToolCallsUsed(0);
              setTokensUsed(0);
            }}
            className="text-xs tracking-wide hover:opacity-80 transition-opacity"
            style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-sans)' }}
          >
            ← New Memo
          </button>
        )}
      </header>

      {/* ── Post-generation tab bar ── */}
      {isPostGeneration && (
        <nav
          className="flex border-b"
          style={{
            backgroundColor: 'var(--color-navy-light)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
          aria-label="Memo sections"
        >
          {POST_GENERATION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                handleTabClick(tab.id);
              }}
              className="px-6 py-3 text-sm font-medium tracking-wide transition-colors"
              style={{
                fontFamily: 'var(--font-sans)',
                color: phase === tab.id ? 'var(--color-gold)' : 'rgba(255,255,255,0.55)',
                borderBottom:
                  phase === tab.id ? '2px solid var(--color-gold)' : '2px solid transparent',
                backgroundColor: 'transparent',
              }}
              aria-current={phase === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-12">
        {/* Input phase */}
        {phase === 'input' && (
          <div>
            <div className="mb-10">
              <h2
                className="text-4xl font-bold mb-3"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
              >
                Write a Policy Memo
              </h2>
              <p
                className="text-base"
                style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-body)' }}
              >
                The agent will research your topic, extract and classify claims, and produce a
                sourced memo. You can then evaluate claims through the HERALD pipeline.
              </p>
            </div>
            <InputForm onSubmit={handleFormSubmit} isDisabled={false} />
          </div>
        )}

        {/* Generating phase */}
        {phase === 'generating' && (
          <div>
            <div className="mb-10">
              <h2
                className="text-3xl font-bold mb-2"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
              >
                Researching
              </h2>
              {memoInput !== null && (
                <p
                  className="text-base italic"
                  style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-body)' }}
                >
                  &ldquo;{memoInput.topic}&rdquo;
                </p>
              )}
            </div>
            <AgentProgress
              steps={steps}
              toolCallsUsed={toolCallsUsed}
              toolCallsBudget={25}
              tokensUsed={tokensUsed}
              tokensBudget={50000}
            />
          </div>
        )}

        {/* Review phase (Memo tab) */}
        {phase === 'review' && <PlaceholderPanel label="Memo Viewer" />}

        {/* Evaluate phase */}
        {phase === 'evaluate' && <PlaceholderPanel label="Claim Selector & Evaluator" />}

        {/* HERALD Results phase */}
        {phase === 'herald' && <PlaceholderPanel label="HERALD Results" />}
      </main>
    </div>
  );
}
