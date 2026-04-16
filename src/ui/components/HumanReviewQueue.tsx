'use client';

/**
 * HumanReviewQueue — HERALD Tier 4 UI (Checkpoint 7.2)
 *
 * Presents pending human review entries side-by-side with source chunks
 * and the full evaluation trail (Tiers 1-3), enabling a reviewer to make
 * a well-informed final verdict without external research.
 */

import { useState } from 'react';
import { CLAIM_TYPE_CONFIG, DERIVATION_CONFIG } from '@/types/claims';
import type { NotesLogEntry } from '@/types/claims';
import type { HeraldResult, TierOutput, Verdict } from '@/types/herald';
import type { HumanReviewEntry, HumanVerdictSubmission } from '@/herald/tier4-human';
import { VERDICT_CONFIG } from './HeraldResults';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HumanReviewQueueProps {
  entries: HumanReviewEntry[];
  /** Called when the user submits a verdict. */
  onSubmitVerdict: (claimId: string, submission: HumanVerdictSubmission) => void | Promise<void>;
  /** If provided, shows a loading spinner on the given claimId. */
  submittingClaimId?: string;
}

// ---------------------------------------------------------------------------
// Tier trail display
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Tier 1 — NLI Model',
  2: 'Tier 2 — LLM Judge',
  3: 'Tier 3 — Debate',
  4: 'Tier 4 — Human',
};

function tierLabel(tierId: 1 | 2 | 3 | 4): string {
  return TIER_LABELS[tierId];
}

function TierTrail({ results }: { results: TierOutput[] }) {
  if (results.length === 0) {
    return (
      <p className="text-sm italic" style={{ color: 'var(--color-muted)' }}>
        No automated tier results recorded.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result) => {
        const verdictCfg = VERDICT_CONFIG[result.verdict];
        return (
          <div
            key={result.tier_id}
            className="rounded-lg p-3 border-l-4"
            style={{
              borderLeftColor: verdictCfg.color,
              backgroundColor: verdictCfg.bg,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold tracking-wide uppercase"
                style={{ color: verdictCfg.color, fontFamily: 'var(--font-sans)' }}
              >
                {tierLabel(result.tier_id)}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: verdictCfg.color,
                  color: 'white',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {verdictCfg.label} · {Math.round(result.confidence * 100).toString()}%
              </span>
            </div>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-body)' }}
            >
              {result.reasoning}
            </p>
            {result.suggested_revision !== undefined && result.suggested_revision.length > 0 && (
              <p
                className="text-sm mt-1 italic"
                style={{ color: '#78350f', fontFamily: 'var(--font-body)' }}
              >
                Suggested: &ldquo;{result.suggested_revision}&rdquo;
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source chunk panel
// ---------------------------------------------------------------------------

function SourcePanel({ claim }: { claim: NotesLogEntry }) {
  if (claim.sources.length === 0) {
    return (
      <div
        className="rounded-lg p-4 italic text-sm"
        style={{
          backgroundColor: 'var(--color-paper-dark)',
          color: 'var(--color-muted)',
          fontFamily: 'var(--font-body)',
        }}
      >
        No sources cited for this claim.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {claim.sources.map((src, i) => (
        <div
          key={src.source_id}
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--color-paper-dark)', backgroundColor: 'white' }}
        >
          <div
            className="px-4 py-2 flex items-center justify-between gap-2"
            style={{ backgroundColor: 'var(--color-paper-dark)' }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
            >
              Source {String(i + 1)}: {src.source_title}
            </span>
            <a
              href={src.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline flex-shrink-0"
              style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
            >
              {src.source_id} ↗
            </a>
          </div>
          {/* Source chunk highlighted against claim text */}
          <div className="px-4 py-3">
            <p
              className="text-sm leading-relaxed"
              style={{
                color: 'var(--color-navy)',
                fontFamily: 'var(--font-body)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {src.relevant_chunk}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict form
// ---------------------------------------------------------------------------

interface VerdictFormProps {
  claimId: string;
  isSubmitting: boolean;
  onSubmit: (claimId: string, submission: HumanVerdictSubmission) => void | Promise<void>;
}

function VerdictForm({ claimId, isSubmitting, onSubmit }: VerdictFormProps) {
  const [verdict, setVerdict] = useState<Verdict | ''>('');
  const [notes, setNotes] = useState('');
  const [suggestedRevision, setSuggestedRevision] = useState('');

  const canSubmit = verdict !== '' && notes.trim().length > 0 && !isSubmitting;

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (verdict === '') return;
    void onSubmit(claimId, {
      verdict,
      notes: notes.trim(),
      suggested_revision:
        suggestedRevision.trim().length > 0 ? suggestedRevision.trim() : undefined,
    });
  }

  const verdictOptions: { value: Verdict; label: string; color: string }[] = [
    { value: 'valid', label: 'Valid — claim is accurate', color: '#15803d' },
    { value: 'invalid', label: 'Invalid — claim cannot stand', color: '#dc2626' },
    { value: 'needs_revision', label: 'Needs Revision — revise as suggested', color: '#d97706' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Verdict selector */}
      <div>
        <p
          className="text-xs font-semibold tracking-widest uppercase mb-2"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Your Verdict
        </p>
        <div className="flex flex-wrap gap-2">
          {verdictOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setVerdict(opt.value);
              }}
              className="px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all"
              style={{
                borderColor: verdict === opt.value ? opt.color : 'var(--color-paper-dark)',
                backgroundColor: verdict === opt.value ? `${opt.color}18` : 'white',
                color: verdict === opt.value ? opt.color : 'var(--color-navy)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label
          htmlFor={`notes-${claimId}`}
          className="block text-xs font-semibold tracking-widest uppercase mb-2"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Reasoning <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <textarea
          id={`notes-${claimId}`}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
          rows={3}
          placeholder="Explain your decision, citing specific evidence from the sources..."
          className="w-full rounded-lg border px-3 py-2 text-sm resize-y"
          style={{
            borderColor: 'var(--color-paper-dark)',
            color: 'var(--color-navy)',
            fontFamily: 'var(--font-body)',
          }}
          required
        />
      </div>

      {/* Suggested revision (shown when verdict is needs_revision) */}
      {verdict === 'needs_revision' && (
        <div>
          <label
            htmlFor={`revision-${claimId}`}
            className="block text-xs font-semibold tracking-widest uppercase mb-2"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            Suggested Revision
          </label>
          <textarea
            id={`revision-${claimId}`}
            value={suggestedRevision}
            onChange={(e) => {
              setSuggestedRevision(e.target.value);
            }}
            rows={2}
            placeholder="Provide the revised claim text that would be accurate and supported by the sources..."
            className="w-full rounded-lg border px-3 py-2 text-sm resize-y"
            style={{
              borderColor: '#f59e0b',
              color: 'var(--color-navy)',
              fontFamily: 'var(--font-body)',
              backgroundColor: '#fffbeb',
            }}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity"
        style={{
          backgroundColor: canSubmit ? 'var(--color-navy)' : 'var(--color-paper-dark)',
          color: canSubmit ? 'white' : 'var(--color-muted)',
          fontFamily: 'var(--font-sans)',
          opacity: isSubmitting ? 0.6 : 1,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {isSubmitting ? 'Submitting…' : 'Submit Verdict'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Single review card
// ---------------------------------------------------------------------------

function ReviewCard({
  entry,
  isSubmitting,
  onSubmit,
}: {
  entry: HumanReviewEntry;
  isSubmitting: boolean;
  onSubmit: (claimId: string, submission: HumanVerdictSubmission) => void | Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'sources' | 'trail' | 'verdict'>('sources');
  const claimTypeCfg = CLAIM_TYPE_CONFIG[entry.claim.claim_type];
  const derivationCfg = DERIVATION_CONFIG[entry.claim.derivation];
  const isReviewed = entry.status === 'reviewed';

  const tabs: { id: 'sources' | 'trail' | 'verdict'; label: string }[] = [
    { id: 'sources', label: 'Source Evidence' },
    { id: 'trail', label: 'Evaluation Trail' },
    { id: 'verdict', label: isReviewed ? 'Decision' : 'Submit Verdict' },
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: isReviewed ? '#bbf7d0' : '#fecaca',
        backgroundColor: 'white',
      }}
    >
      {/* Header */}
      <div
        className="px-5 py-4"
        style={{
          backgroundColor: isReviewed ? '#f0fdf4' : '#fff7f7',
          borderBottom: '1px solid',
          borderColor: isReviewed ? '#bbf7d0' : '#fecaca',
        }}
      >
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {/* Human Review badge */}
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ backgroundColor: '#7c3aed', color: 'white', fontFamily: 'var(--font-sans)' }}
          >
            ⚠ Tier 4 — Human Review
          </span>

          <span
            className="font-bold text-sm"
            style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
          >
            {entry.claim.claim_id}
          </span>

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

          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: '#f3f4f6',
              color: 'var(--color-navy)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {derivationCfg.label}
          </span>

          {isReviewed && entry.verdict !== null && (
            <span
              className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold"
              style={{
                backgroundColor: VERDICT_CONFIG[entry.verdict].bg,
                color: VERDICT_CONFIG[entry.verdict].color,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {VERDICT_CONFIG[entry.verdict].icon} {VERDICT_CONFIG[entry.verdict].label}
            </span>
          )}
        </div>

        {/* Claim text */}
        <blockquote
          className="text-base font-medium leading-snug mb-3"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-body)' }}
        >
          &ldquo;{entry.claim.claim_text}&rdquo;
        </blockquote>

        {/* Escalation reason */}
        <p
          className="text-xs"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          {entry.escalation_reason}
        </p>
      </div>

      {/* Tab bar */}
      <div
        className="flex border-b"
        style={{ borderColor: 'var(--color-paper-dark)', backgroundColor: 'var(--color-paper)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className="px-5 py-3 text-xs font-semibold tracking-wide uppercase transition-colors"
            style={{
              color: activeTab === tab.id ? 'var(--color-navy)' : 'var(--color-muted)',
              borderBottom:
                activeTab === tab.id ? '2px solid var(--color-navy)' : '2px solid transparent',
              fontFamily: 'var(--font-sans)',
              background: 'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {activeTab === 'sources' && <SourcePanel claim={entry.claim} />}

        {activeTab === 'trail' && (
          <div className="space-y-4">
            <TierTrail results={entry.previous_tier_results} />
            {entry.claim.reasoning.length > 0 && (
              <div
                className="rounded-lg p-4 mt-4"
                style={{ backgroundColor: 'var(--color-paper-dark)' }}
              >
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-1"
                  style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
                >
                  Agent Reasoning
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-body)' }}
                >
                  {entry.claim.reasoning}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'verdict' && !isReviewed && (
          <VerdictForm
            claimId={entry.claim.claim_id}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
          />
        )}

        {activeTab === 'verdict' && isReviewed && (
          <div className="space-y-4">
            <div
              className="rounded-lg p-4 border-l-4"
              style={{
                borderLeftColor:
                  entry.verdict !== null ? VERDICT_CONFIG[entry.verdict].color : '#6b7280',
                backgroundColor:
                  entry.verdict !== null ? VERDICT_CONFIG[entry.verdict].bg : '#f3f4f6',
              }}
            >
              <p
                className="text-xs font-semibold tracking-widest uppercase mb-1"
                style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
              >
                Human Decision
              </p>
              <p
                className="text-sm"
                style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-body)' }}
              >
                {entry.notes ?? ''}
              </p>
            </div>

            {entry.suggested_revision !== null && entry.suggested_revision.length > 0 && (
              <div
                className="rounded-lg p-4 border-l-4"
                style={{ borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb' }}
              >
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-1"
                  style={{ color: '#92400e', fontFamily: 'var(--font-sans)' }}
                >
                  Suggested Revision
                </p>
                <p
                  className="text-sm italic"
                  style={{ color: '#78350f', fontFamily: 'var(--font-body)' }}
                >
                  &ldquo;{entry.suggested_revision}&rdquo;
                </p>
              </div>
            )}

            <p
              className="text-xs"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
            >
              Reviewed:{' '}
              {entry.reviewed_at !== null ? new Date(entry.reviewed_at).toLocaleString() : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HumanReviewQueue({
  entries,
  onSubmitVerdict,
  submittingClaimId,
}: HumanReviewQueueProps) {
  const pending = entries.filter((e) => e.status === 'pending');
  const reviewed = entries.filter((e) => e.status === 'reviewed');

  if (entries.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl min-h-48 gap-3"
        style={{ backgroundColor: 'var(--color-paper-dark)' }}
      >
        <span className="text-2xl">✓</span>
        <p
          className="text-sm"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          No claims awaiting human review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div
        className="rounded-lg p-4 flex flex-wrap gap-4 items-center"
        style={{ backgroundColor: 'var(--color-paper-dark)' }}
      >
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Human Review Queue
        </span>
        {pending.length > 0 && (
          <span
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
            style={{ backgroundColor: '#fee2e2', color: '#dc2626', fontFamily: 'var(--font-sans)' }}
          >
            {pending.length.toString()} pending
          </span>
        )}
        {reviewed.length > 0 && (
          <span
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
            style={{ backgroundColor: '#dcfce7', color: '#15803d', fontFamily: 'var(--font-sans)' }}
          >
            {reviewed.length.toString()} reviewed
          </span>
        )}
      </div>

      {/* Pending entries */}
      {pending.length > 0 && (
        <section>
          <h3
            className="text-xs font-semibold tracking-widest uppercase mb-3"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            Awaiting Review
          </h3>
          <div className="space-y-4">
            {pending.map((entry) => (
              <ReviewCard
                key={entry.id}
                entry={entry}
                isSubmitting={submittingClaimId === entry.claim.claim_id}
                onSubmit={onSubmitVerdict}
              />
            ))}
          </div>
        </section>
      )}

      {/* Reviewed entries */}
      {reviewed.length > 0 && (
        <section>
          <h3
            className="text-xs font-semibold tracking-widest uppercase mb-3"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            Completed Reviews
          </h3>
          <div className="space-y-4">
            {reviewed.map((entry) => (
              <ReviewCard
                key={entry.id}
                entry={entry}
                isSubmitting={false}
                onSubmit={onSubmitVerdict}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export type { HumanReviewQueueProps, HumanReviewEntry, HumanVerdictSubmission };
export type { HeraldResult, TierOutput };
