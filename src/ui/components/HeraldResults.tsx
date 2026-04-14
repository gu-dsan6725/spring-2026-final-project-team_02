'use client';

import { useState } from 'react';
import { ClaimType, CLAIM_TYPE_CONFIG, DerivationMethod, DERIVATION_CONFIG } from '@/types/claims';
import type { NotesLogEntry } from '@/types/claims';
import type { HeraldResult, Verdict } from '@/types/herald';
import TierProgress from './TierProgress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeraldResultsProps {
  results: HeraldResult[];
  notesLog: NotesLogEntry[];
}

// ---------------------------------------------------------------------------
// Verdict display helpers
// ---------------------------------------------------------------------------

const VERDICT_CONFIG: Record<Verdict, { icon: string; label: string; color: string; bg: string }> =
  {
    valid: { icon: '✓', label: 'Valid', color: '#15803d', bg: '#dcfce7' },
    invalid: { icon: '✕', label: 'Invalid', color: '#dc2626', bg: '#fee2e2' },
    needs_revision: { icon: '!', label: 'Needs Revision', color: '#d97706', bg: '#fef3c7' },
    uncertain: { icon: '?', label: 'Uncertain', color: '#6b7280', bg: '#f3f4f6' },
  };

const RISK_COLOR: Record<'low' | 'medium' | 'high', string> = {
  low: '#15803d',
  medium: '#d97706',
  high: '#dc2626',
};

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function SummaryBar({ results }: { results: HeraldResult[] }) {
  const counts: Record<Verdict, number> = {
    valid: 0,
    invalid: 0,
    needs_revision: 0,
    uncertain: 0,
  };
  for (const r of results) {
    counts[r.verdict] += 1;
  }
  const total = results.length;

  return (
    <div
      className="rounded-lg p-4 flex flex-wrap gap-4 items-center"
      style={{ backgroundColor: 'var(--color-paper-dark)' }}
    >
      <span
        className="text-sm font-semibold"
        style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
      >
        {total.toString()} claim{total !== 1 ? 's' : ''} evaluated
      </span>
      {(Object.entries(counts) as [Verdict, number][])
        .filter(([, n]) => n > 0)
        .map(([verdict, n]) => {
          const cfg = VERDICT_CONFIG[verdict];
          return (
            <span
              key={verdict}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
              style={{
                backgroundColor: cfg.bg,
                color: cfg.color,
                fontFamily: 'var(--font-sans)',
              }}
            >
              <span>{cfg.icon}</span>
              <span>
                {n.toString()} {cfg.label}
              </span>
            </span>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single result card
// ---------------------------------------------------------------------------

function ResultCard({ result, entry }: { result: HeraldResult; entry: NotesLogEntry | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const verdict = VERDICT_CONFIG[result.verdict];
  const claimTypeCfg = entry !== undefined ? CLAIM_TYPE_CONFIG[entry.claim_type] : null;
  const derivationCfg = entry !== undefined ? DERIVATION_CONFIG[entry.derivation] : null;

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor:
          result.verdict === 'valid'
            ? '#bbf7d0'
            : result.verdict === 'invalid'
              ? '#fecaca'
              : 'var(--color-paper-dark)',
        backgroundColor: 'white',
      }}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={() => {
          setExpanded((e) => !e);
        }}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
      >
        {/* Verdict icon */}
        <span
          className="inline-flex w-8 h-8 rounded-full items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5"
          style={{ backgroundColor: verdict.bg, color: verdict.color }}
          aria-label={verdict.label}
        >
          {verdict.icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Top row: claim ID, type badge, derivation badge, confidence */}
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span
              className="font-bold text-sm"
              style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
            >
              {result.claim_id}
            </span>

            {claimTypeCfg !== null && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: `${claimTypeCfg.color}18`,
                  color: claimTypeCfg.color,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {claimTypeCfg.icon} {claimTypeCfg.label}
              </span>
            )}

            {derivationCfg !== null && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: `${RISK_COLOR[derivationCfg.riskLevel]}18`,
                  color: RISK_COLOR[derivationCfg.riskLevel],
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {derivationCfg.label}
              </span>
            )}

            <span
              className="ml-auto text-sm font-semibold"
              style={{ color: verdict.color, fontFamily: 'var(--font-sans)' }}
            >
              {verdict.label} · {Math.round(result.confidence * 100).toString()}%
            </span>
          </div>

          {/* Claim text preview */}
          {entry !== undefined && (
            <p
              className="text-sm leading-snug"
              style={{
                color: 'var(--color-navy)',
                fontFamily: 'var(--font-body)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              &ldquo;{entry.claim_text}&rdquo;
            </p>
          )}
        </div>

        {/* Expand chevron */}
        <span
          className="text-xs flex-shrink-0 mt-1 transition-transform"
          style={{
            color: 'var(--color-muted)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div
          className="px-5 pb-5 space-y-4 border-t"
          style={{ borderColor: 'var(--color-paper-dark)' }}
        >
          {/* Tier progression */}
          <div className="pt-4">
            <p
              className="text-xs font-semibold tracking-widest uppercase mb-3"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
            >
              Tier Progression
            </p>
            {entry !== undefined && (
              <TierProgress
                tierReached={result.tier_reached}
                claimType={entry.claim_type}
                verdict={result.verdict}
                animated={true}
              />
            )}
          </div>

          {/* Feedback */}
          {result.feedback.length > 0 && (
            <div>
              <p
                className="text-xs font-semibold tracking-widest uppercase mb-2"
                style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
              >
                Evaluation Feedback
              </p>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-body)' }}
              >
                {result.feedback}
              </p>
            </div>
          )}

          {/* Suggested revision */}
          {result.suggested_revision !== null && result.suggested_revision.length > 0 && (
            <div
              className="rounded p-4 border-l-4"
              style={{
                backgroundColor: '#fffbeb',
                borderLeftColor: '#f59e0b',
              }}
            >
              <p
                className="text-xs font-semibold tracking-widest uppercase mb-2"
                style={{ color: '#92400e', fontFamily: 'var(--font-sans)' }}
              >
                Suggested Revision
              </p>
              <p
                className="text-sm leading-relaxed italic"
                style={{ color: '#78350f', fontFamily: 'var(--font-body)' }}
              >
                {result.suggested_revision}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HeraldResults({ results, notesLog }: HeraldResultsProps) {
  const entryIndex = new Map(notesLog.map((e) => [e.claim_id, e]));

  if (results.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg min-h-48"
        style={{ backgroundColor: 'var(--color-paper-dark)' }}
      >
        <p
          className="text-sm"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          No evaluations yet. Select claims in the Evaluate Claims tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SummaryBar results={results} />
      {results.map((result) => (
        <ResultCard key={result.claim_id} result={result} entry={entryIndex.get(result.claim_id)} />
      ))}
    </div>
  );
}

export type { HeraldResultsProps };
export { VERDICT_CONFIG };
export type { ClaimType, DerivationMethod };
