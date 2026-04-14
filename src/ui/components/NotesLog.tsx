'use client';

import { useEffect, useRef } from 'react';
import { CLAIM_TYPE_CONFIG, DERIVATION_CONFIG } from '@/types/claims';
import type { NotesLogEntry } from '@/types/claims';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotesLogProps {
  entries: NotesLogEntry[];
  selectedClaimId: string | null;
  onClaimSelect: (claimId: string) => void;
}

// ---------------------------------------------------------------------------
// Risk level colours for derivation badges
// ---------------------------------------------------------------------------

const RISK_COLOR: Record<'low' | 'medium' | 'high', { bg: string; text: string }> = {
  low: { bg: '#dcfce7', text: '#15803d' },
  medium: { bg: '#fef3c7', text: '#d97706' },
  high: { bg: '#fee2e2', text: '#dc2626' },
};

// ---------------------------------------------------------------------------
// Individual claim card
// ---------------------------------------------------------------------------

function ClaimCard({
  entry,
  isSelected,
  cardRef,
  onSelect,
}: {
  entry: NotesLogEntry;
  isSelected: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
}) {
  const typeCfg = CLAIM_TYPE_CONFIG[entry.claim_type];
  const derivCfg = DERIVATION_CONFIG[entry.derivation];
  const riskColors = RISK_COLOR[derivCfg.riskLevel];

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      aria-pressed={isSelected}
      className="rounded-lg border cursor-pointer transition-all duration-200"
      style={{
        borderColor: isSelected ? typeCfg.color : 'var(--color-paper-dark)',
        borderLeftWidth: isSelected ? '4px' : '1px',
        backgroundColor: isSelected ? `${typeCfg.color}08` : 'white',
        outline: 'none',
      }}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className="font-bold text-sm"
            style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
          >
            {entry.claim_id}
          </span>

          {/* Claim type badge */}
          <span
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: `${typeCfg.color}18`,
              color: typeCfg.color,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {typeCfg.icon} {typeCfg.label}
          </span>

          {/* Derivation badge */}
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: riskColors.bg,
              color: riskColors.text,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {derivCfg.label}
          </span>
        </div>

        {/* Claim text */}
        <p
          className="text-base leading-relaxed mb-4"
          style={{
            fontFamily: 'var(--font-body)',
            color: 'var(--color-navy)',
            fontStyle: 'italic',
          }}
        >
          &ldquo;{entry.claim_text}&rdquo;
        </p>

        {/* Sources */}
        {entry.sources.length > 0 && (
          <div className="space-y-4 mb-4">
            <p
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
            >
              Sources
            </p>
            {entry.sources.map((source) => (
              <div key={source.source_id}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span
                    className="text-xs font-bold flex-shrink-0"
                    style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
                  >
                    {source.source_id}
                  </span>
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
                  >
                    {source.source_title}
                  </span>
                </div>
                <a
                  href={source.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="block text-xs mb-2 truncate hover:underline"
                  style={{
                    color: 'var(--color-gold)',
                    fontFamily: 'var(--font-sans)',
                    maxWidth: '100%',
                  }}
                >
                  {source.source_url}
                </a>
                <blockquote
                  className="pl-4 py-1 text-sm leading-relaxed italic"
                  style={{
                    borderLeft: '3px solid var(--color-gold)',
                    color: 'var(--color-muted)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {source.relevant_chunk}
                </blockquote>
              </div>
            ))}
          </div>
        )}

        {/* Agent reasoning */}
        {entry.reasoning.length > 0 && (
          <div>
            <p
              className="text-xs font-semibold tracking-widest uppercase mb-1"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
            >
              Agent Reasoning
            </p>
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
            >
              {entry.reasoning}
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

export default function NotesLog({ entries, selectedClaimId, onClaimSelect }: NotesLogProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-scroll to selected card
  useEffect(() => {
    if (selectedClaimId === null) return;
    const el = cardRefs.current[selectedClaimId] ?? null;
    if (el !== null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedClaimId]);

  if (entries.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg min-h-48"
        style={{ backgroundColor: 'var(--color-paper-dark)' }}
      >
        <p
          className="text-sm"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          No claims in the notes log yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p
        className="text-xs font-semibold tracking-widest uppercase"
        style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
      >
        {entries.length.toString()} claim{entries.length !== 1 ? 's' : ''} — click any card to
        highlight in memo
      </p>
      {entries.map((entry) => (
        <ClaimCard
          key={entry.claim_id}
          entry={entry}
          isSelected={selectedClaimId === entry.claim_id}
          cardRef={(el) => {
            cardRefs.current[entry.claim_id] = el;
          }}
          onSelect={() => {
            onClaimSelect(entry.claim_id);
          }}
        />
      ))}
    </div>
  );
}
