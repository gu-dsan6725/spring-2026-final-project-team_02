'use client';

import { useState, useMemo } from 'react';
import { ClaimType, DerivationMethod, CLAIM_TYPE_CONFIG, DERIVATION_CONFIG } from '@/types/claims';
import type { NotesLogEntry } from '@/types/claims';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClaimSelectorProps {
  entries: NotesLogEntry[];
  onRunEvaluation: (selectedIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHighRisk(entry: NotesLogEntry): boolean {
  return (
    entry.derivation === DerivationMethod.AgentInference ||
    entry.claim_type === ClaimType.Causal ||
    entry.claim_type === ClaimType.Synthesis
  );
}

function estimateSeconds(entries: NotesLogEntry[], selected: Set<string>): number {
  let tier1 = 0;
  let tier2 = 0;
  for (const e of entries) {
    if (!selected.has(e.claim_id)) continue;
    if (CLAIM_TYPE_CONFIG[e.claim_type].skipNLI) {
      tier2++;
    } else {
      tier1++;
    }
  }
  return tier1 * 2 + tier2 * 5 + 3;
}

function formatSeconds(s: number): string {
  if (s < 60) return `~${s.toString()}s`;
  return `~${Math.ceil(s / 60).toString()}m`;
}

const RISK_COLOR: Record<'low' | 'medium' | 'high', { bg: string; text: string }> = {
  low: { bg: '#dcfce7', text: '#15803d' },
  medium: { bg: '#fef3c7', text: '#d97706' },
  high: { bg: '#fee2e2', text: '#dc2626' },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ClaimSelector({ entries, onRunEvaluation }: ClaimSelectorProps) {
  const defaultSelected = useMemo(
    () => new Set(entries.filter(isHighRisk).map((e) => e.claim_id)),
    [entries],
  );

  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  const toggle = (claimId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(new Set(entries.map((e) => e.claim_id)));
  };

  const clearAll = (): void => {
    setSelected(new Set());
  };

  const handleRun = (): void => {
    onRunEvaluation([...selected]);
  };

  const estTime = estimateSeconds(entries, selected);

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-paper-dark)' }}>
        <p
          className="text-xs font-semibold tracking-widest uppercase mb-3"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Claim Type Legend
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CLAIM_TYPE_CONFIG).map(([type, cfg]) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${cfg.color}18`,
                color: cfg.color,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {cfg.icon} {cfg.label}
              {cfg.skipNLI && <span className="ml-1 opacity-60">→ Tier 2</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={selectAll}
          className="text-sm px-3 py-1.5 rounded border transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--color-paper-dark)',
            color: 'var(--color-navy)',
            fontFamily: 'var(--font-sans)',
            backgroundColor: 'white',
          }}
        >
          Select All
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-sm px-3 py-1.5 rounded border transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--color-paper-dark)',
            color: 'var(--color-navy)',
            fontFamily: 'var(--font-sans)',
            backgroundColor: 'white',
          }}
        >
          Clear All
        </button>
        <span
          className="text-xs ml-auto"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          {selected.size.toString()} of {entries.length.toString()} selected
        </span>
      </div>

      {/* Claim list */}
      {entries.length === 0 && (
        <div
          className="flex items-center justify-center rounded-lg min-h-32"
          style={{ backgroundColor: 'var(--color-paper-dark)' }}
        >
          <p
            className="text-sm"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            No claims available for evaluation.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {entries.map((entry) => {
          const typeCfg = CLAIM_TYPE_CONFIG[entry.claim_type];
          const derivCfg = DERIVATION_CONFIG[entry.derivation];
          const riskColors = RISK_COLOR[derivCfg.riskLevel];
          const isChecked = selected.has(entry.claim_id);
          const skipsNLI = typeCfg.skipNLI;
          const highRisk = isHighRisk(entry);

          return (
            <label
              key={entry.claim_id}
              className="flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors"
              style={{
                borderColor: isChecked ? typeCfg.color : 'var(--color-paper-dark)',
                backgroundColor: isChecked ? `${typeCfg.color}06` : 'white',
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {
                  toggle(entry.claim_id);
                }}
                className="mt-1 flex-shrink-0"
                aria-label={`Select ${entry.claim_id} for evaluation`}
              />

              <div className="flex-1 min-w-0">
                {/* Badges row */}
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span
                    className="font-bold text-sm"
                    style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
                  >
                    {entry.claim_id}
                  </span>

                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${typeCfg.color}18`,
                      color: typeCfg.color,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {typeCfg.icon} {typeCfg.label}
                  </span>

                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: riskColors.bg,
                      color: riskColors.text,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {derivCfg.label}
                  </span>

                  {skipsNLI && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: '#ede9fe',
                        color: '#7c3aed',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      → Skips to Tier 2
                    </span>
                  )}

                  {highRisk && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: '#fee2e2',
                        color: '#dc2626',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      Pre-selected (high risk)
                    </span>
                  )}

                  <span
                    className="ml-auto text-xs"
                    style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
                  >
                    {entry.sources.length.toString()} source{entry.sources.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Claim text */}
                <p
                  className="text-sm leading-snug"
                  style={{
                    fontFamily: 'var(--font-body)',
                    color: 'var(--color-navy)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {entry.claim_text}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Run button */}
      <div className="sticky bottom-0 pt-4 pb-2" style={{ backgroundColor: 'var(--color-paper)' }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={selected.size === 0}
          className="w-full py-4 text-base font-semibold tracking-wide transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--color-navy)',
            color: 'var(--color-gold)',
            fontFamily: 'var(--font-sans)',
            borderRadius: '2px',
            letterSpacing: '0.06em',
          }}
        >
          {selected.size === 0
            ? 'Select claims to evaluate'
            : `Run HERALD Evaluation — ${selected.size.toString()} claim${selected.size !== 1 ? 's' : ''} (${formatSeconds(estTime)})`}
        </button>
      </div>
    </div>
  );
}
