'use client';

import { useState, useEffect } from 'react';
import { ClaimType, CLAIM_TYPE_CONFIG } from '@/types/claims';
import type { Verdict } from '@/types/herald';

// ---------------------------------------------------------------------------
// HERALD tier definitions
// ---------------------------------------------------------------------------

export interface HeraldTier {
  id: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  icon: string;
}

export const HERALD_TIERS: HeraldTier[] = [
  { id: 1, name: 'NLI Model', description: 'Local entailment check', icon: '🔬' },
  { id: 2, name: 'LLM Judge', description: 'Claude Sonnet', icon: '⚖️' },
  { id: 3, name: 'Debate', description: 'Multi-agent debate', icon: '🗣️' },
  { id: 4, name: 'Human', description: 'Manual review', icon: '👤' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierProgressProps {
  tierReached: 1 | 2 | 3 | 4;
  claimType: ClaimType;
  verdict: Verdict;
  animated: boolean;
}

type TierState = 'skipped' | 'reached-final' | 'reached' | 'unreached' | 'hidden';

function getTierState(
  tier: HeraldTier,
  tierReached: number,
  claimType: ClaimType,
  visibleUpTo: number,
): TierState {
  const isSkipped = tier.id === 1 && CLAIM_TYPE_CONFIG[claimType].skipNLI;
  if (isSkipped) return 'skipped';
  if (tier.id > visibleUpTo) return 'hidden';
  if (tier.id > tierReached) return 'unreached';
  if (tier.id === tierReached) return 'reached-final';
  return 'reached';
}

function tierBackground(state: TierState, verdict: Verdict): string {
  switch (state) {
    case 'reached':
      return '#22c55e';
    case 'reached-final':
      if (verdict === 'valid') return '#22c55e';
      if (verdict === 'invalid') return '#f59e0b';
      return '#9ca3af';
    case 'skipped':
      return '#e5e7eb';
    case 'unreached':
    case 'hidden':
      return '#f3f4f6';
  }
}

function tierTextColor(state: TierState, verdict: Verdict): string {
  if (state === 'reached' || state === 'reached-final') {
    return verdict === 'uncertain' && state === 'reached-final' ? '#4b5563' : 'white';
  }
  return '#9ca3af';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TierProgress({
  tierReached,
  claimType,
  verdict,
  animated,
}: TierProgressProps) {
  const [visibleUpTo, setVisibleUpTo] = useState(animated ? 0 : tierReached);

  useEffect(() => {
    if (!animated) {
      setVisibleUpTo(tierReached);
      return;
    }
    setVisibleUpTo(0);
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      setVisibleUpTo(current);
      if (current >= tierReached) clearInterval(interval);
    }, 500);
    return () => {
      clearInterval(interval);
    };
  }, [animated, tierReached]);

  return (
    <div className="flex gap-2" aria-label="HERALD tier progression">
      {HERALD_TIERS.map((tier) => {
        const state = getTierState(tier, tierReached, claimType, visibleUpTo);
        const bg = tierBackground(state, verdict);
        const fg = tierTextColor(state, verdict);
        const isSkipped = state === 'skipped';
        const isHidden = state === 'hidden';

        return (
          <div
            key={tier.id}
            className="flex-1 rounded p-2 text-center transition-all duration-500"
            style={{
              backgroundColor: bg,
              opacity: isHidden ? 0.3 : 1,
            }}
            aria-label={`Tier ${tier.id.toString()}: ${state}`}
          >
            <div className="text-base leading-none mb-1">{tier.icon}</div>
            <div
              className="text-xs font-semibold leading-tight"
              style={{
                color: fg,
                fontFamily: 'var(--font-sans)',
                textDecoration: isSkipped ? 'line-through' : 'none',
              }}
            >
              {tier.name}
            </div>
            {isSkipped && (
              <div
                className="text-xs mt-0.5"
                style={{ color: '#9ca3af', fontFamily: 'var(--font-sans)' }}
              >
                Skipped
              </div>
            )}
            {!isSkipped && (
              <div
                className="text-xs mt-0.5 leading-tight"
                style={{
                  color: isHidden || state === 'unreached' ? '#d1d5db' : `${fg}cc`,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {tier.description}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
