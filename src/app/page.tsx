'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import InputForm from '@/ui/components/InputForm';
import AgentProgress, { type AgentStep } from '@/ui/components/AgentProgress';
import MemoViewer from '@/ui/components/MemoViewer';
import NotesLog from '@/ui/components/NotesLog';
import ClaimSelector from '@/ui/components/ClaimSelector';
import HeraldResults from '@/ui/components/HeraldResults';
import { ClaimType, DerivationMethod } from '@/types/claims';
import type { NotesLogEntry } from '@/types/claims';
import type { MemoInput, MemoSection } from '@/types/memo';
import type { HeraldResult } from '@/types/herald';

// ---------------------------------------------------------------------------
// Phase types
// ---------------------------------------------------------------------------

type AppPhase = 'input' | 'generating' | 'memo' | 'notes-log' | 'evaluate' | 'herald';

interface Tab {
  id: Extract<AppPhase, 'memo' | 'notes-log' | 'evaluate' | 'herald'>;
  label: string;
}

const POST_GENERATION_TABS: Tab[] = [
  { id: 'memo', label: 'Memo' },
  { id: 'notes-log', label: 'Notes Log' },
  { id: 'evaluate', label: 'Evaluate Claims' },
  { id: 'herald', label: 'HERALD Results' },
];

// ---------------------------------------------------------------------------
// Default agent steps
// ---------------------------------------------------------------------------

const INITIAL_STEPS: AgentStep[] = [
  { id: 'plan', label: 'Research Plan', detail: 'Waiting to start…', status: 'pending' },
  { id: 'research', label: 'Executing Research', detail: 'Tool calls pending…', status: 'pending' },
  { id: 'extract', label: 'Extracting Claims', detail: 'Building notes log…', status: 'pending' },
  { id: 'write', label: 'Writing Memo', detail: 'Synthesising findings…', status: 'pending' },
];

// ---------------------------------------------------------------------------
// Mock output — replaced by real API response in checkpoint 5.1
// ---------------------------------------------------------------------------

function buildMockOutput(topic: string): {
  sections: MemoSection[];
  notesLog: NotesLogEntry[];
} {
  const sections: MemoSection[] = [
    {
      title: 'Executive Summary',
      content: `This memo examines ${topic}. Evidence suggests significant gaps in policy implementation [C-001]. Cross-country comparisons reveal divergent outcomes depending on institutional capacity [C-002].`,
      claim_ids: ['C-001', 'C-002'],
    },
    {
      title: 'Key Findings',
      content: `Program reach remains limited, with coverage rates below 40% in rural areas [C-003]. Causal analysis indicates that inadequate targeting contributes to persistent exclusion [C-004]. Projections suggest demand will outpace current supply by 2032 [C-005].`,
      claim_ids: ['C-003', 'C-004', 'C-005'],
    },
    {
      title: 'Recommendations',
      content: `Evidence-based targeting frameworks are considered best practice for programme design [C-006]. Strengthening monitoring systems and community feedback loops should be prioritised to improve accountability [C-007].`,
      claim_ids: ['C-006', 'C-007'],
    },
  ];

  const notesLog: NotesLogEntry[] = [
    {
      claim_id: 'C-001',
      claim_text: 'Significant gaps in policy implementation',
      claim_type: ClaimType.Statistical,
      derivation: DerivationMethod.DirectExtraction,
      sources: [
        {
          source_id: 'S-001',
          source_title: 'World Bank Policy Review 2023',
          source_url: 'https://worldbank.org/policy-review-2023',
          relevant_chunk:
            'Implementation gaps persist across 63% of reviewed programmes in low-income countries.',
        },
      ],
      reasoning: 'Directly lifted from World Bank programme review.',
    },
    {
      claim_id: 'C-002',
      claim_text:
        'Cross-country comparisons reveal divergent outcomes depending on institutional capacity',
      claim_type: ClaimType.Comparative,
      derivation: DerivationMethod.CrossSource,
      sources: [
        {
          source_id: 'S-002',
          source_title: 'IMF Working Paper WP/23/041',
          source_url: 'https://imf.org/en/Publications/WP/2023',
          relevant_chunk:
            'Countries with strong public financial management systems showed 2.3x better programme outcomes.',
        },
        {
          source_id: 'S-003',
          source_title: 'OECD Development Co-operation Report',
          source_url: 'https://oecd.org/dac/development-co-operation-report',
          relevant_chunk:
            'Institutional capacity is the primary predictor of programme success across peer countries.',
        },
      ],
      reasoning: 'Combined two sources showing institutional capacity as the key differentiator.',
    },
    {
      claim_id: 'C-003',
      claim_text: 'Coverage rates below 40% in rural areas',
      claim_type: ClaimType.Statistical,
      derivation: DerivationMethod.DirectExtraction,
      sources: [
        {
          source_id: 'S-004',
          source_title: 'UNICEF Rural Coverage Survey 2022',
          source_url: 'https://unicef.org/reports/rural-coverage-2022',
          relevant_chunk: 'Rural coverage remained at 37.4% nationally, down from 41.2% in 2020.',
        },
      ],
      reasoning: 'Direct extraction of the 37.4% figure.',
    },
    {
      claim_id: 'C-004',
      claim_text: 'Inadequate targeting contributes to persistent exclusion',
      claim_type: ClaimType.Causal,
      derivation: DerivationMethod.AgentInference,
      sources: [
        {
          source_id: 'S-004',
          source_title: 'UNICEF Rural Coverage Survey 2022',
          source_url: 'https://unicef.org/reports/rural-coverage-2022',
          relevant_chunk: 'Targeting errors accounted for 58% of exclusion errors in the sample.',
        },
      ],
      reasoning:
        'Inferred causal link from exclusion error data; source shows correlation, not causation.',
    },
    {
      claim_id: 'C-005',
      claim_text: 'Demand will outpace current supply by 2032',
      claim_type: ClaimType.Predictive,
      derivation: DerivationMethod.DirectExtraction,
      sources: [
        {
          source_id: 'S-005',
          source_title: 'UN Population Division Projection 2023',
          source_url: 'https://population.un.org/wpp/2023',
          relevant_chunk:
            'Under the medium fertility scenario, demand for social services is projected to exceed supply capacity by 2031–2033.',
        },
      ],
      reasoning: 'Projection lifted directly from UN medium-fertility scenario.',
    },
    {
      claim_id: 'C-006',
      claim_text:
        'Evidence-based targeting frameworks are considered best practice for programme design',
      claim_type: ClaimType.Normative,
      derivation: DerivationMethod.Paraphrase,
      sources: [
        {
          source_id: 'S-006',
          source_title: 'OECD DAC Peer Learning Guidelines 2023',
          source_url: 'https://oecd.org/dac/peer-learning-guidelines',
          relevant_chunk:
            'Best practice guidance identifies evidence-based targeting as the highest-priority design feature for social protection programmes.',
        },
      ],
      reasoning: 'Paraphrased from OECD best-practice guidance.',
    },
    {
      claim_id: 'C-007',
      claim_text:
        'Strengthening monitoring systems and community feedback loops should be prioritised to improve accountability',
      claim_type: ClaimType.Synthesis,
      derivation: DerivationMethod.CrossSource,
      sources: [
        {
          source_id: 'S-003',
          source_title: 'OECD Development Co-operation Report',
          source_url: 'https://oecd.org/dac/development-co-operation-report',
          relevant_chunk: 'Monitoring systems are a key lever for programme improvement.',
        },
        {
          source_id: 'S-007',
          source_title: 'Accountability in Social Protection — ODI Briefing',
          source_url: 'https://odi.org/briefings/accountability-social-protection',
          relevant_chunk:
            'Community feedback mechanisms are strongly associated with improved accountability outcomes.',
        },
      ],
      reasoning: 'Synthesised from two sources: OECD on monitoring and ODI on community feedback.',
    },
  ];

  return { sections, notesLog };
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
  const [memoSections, setMemoSections] = useState<MemoSection[]>([]);
  const [notesLog, setNotesLog] = useState<NotesLogEntry[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [heraldResults, setHeraldResults] = useState<HeraldResult[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const memoTitle = useMemo(
    () => (memoInput !== null ? `Policy Memo: ${memoInput.topic}` : 'Policy Memo'),
    [memoInput],
  );

  // Polling stub — swap for WebSocket in checkpoint 5.1
  const startPolling = (input: MemoInput): void => {
    setSteps((prev) =>
      prev.map((s, i) => (i === 0 ? { ...s, status: 'running', detail: 'Planning queries…' } : s)),
    );

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
        const { sections, notesLog: log } = buildMockOutput(input.topic);
        setMemoSections(sections);
        setNotesLog(log);
        setPhase('memo');
      }
    }, 1000);
  };

  const handleFormSubmit = (input: MemoInput): void => {
    setMemoInput(input);
    setPhase('generating');
    setSteps(INITIAL_STEPS);
    setToolCallsUsed(0);
    setTokensUsed(0);
    setSelectedClaimId(null);
    setHeraldResults([]);
    startPolling(input);
  };

  const handleClaimClick = (claimId: string): void => {
    setSelectedClaimId(claimId);
    setPhase('notes-log');
  };

  const handleNotesLogSelect = (claimId: string): void => {
    setSelectedClaimId(claimId);
  };

  const handleRunEvaluation = (selectedIds: string[]): void => {
    // Stub: produce mock HERALD results for selected claims
    const mockResults: HeraldResult[] = selectedIds.map((id, idx) => {
      const verdicts = ['valid', 'invalid', 'uncertain'] as const;
      const verdict = verdicts[idx % verdicts.length] ?? 'uncertain';
      const tierReached = ([1, 2, 2, 3] as const)[idx % 4] ?? 2;
      return {
        claim_id: id,
        tier_reached: tierReached,
        verdict,
        confidence: 0.55 + (idx % 5) * 0.09,
        feedback:
          'Mock feedback from HERALD pipeline. Replace with real evaluation in checkpoint 5.x.',
        suggested_revision:
          verdict === 'invalid'
            ? 'Consider softening the causal language to "is associated with" rather than "causes".'
            : null,
        tier_details: {
          tier_1: null,
          tier_2: { tier_id: 2, verdict, confidence: 0.7, reasoning: 'LLM judge evaluation.' },
          tier_3: null,
          tier_4: null,
        },
      };
    });
    setHeraldResults(mockResults);
    setPhase('herald');
  };

  const handleNewMemo = (): void => {
    if (pollRef.current !== null) clearInterval(pollRef.current);
    setPhase('input');
    setMemoInput(null);
    setMemoSections([]);
    setNotesLog([]);
    setSelectedClaimId(null);
    setHeraldResults([]);
    setSteps(INITIAL_STEPS);
    setToolCallsUsed(0);
    setTokensUsed(0);
  };

  const handleTabClick = (
    tab: Extract<AppPhase, 'memo' | 'notes-log' | 'evaluate' | 'herald'>,
  ): void => {
    setPhase(tab);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const isPostGeneration =
    phase === 'memo' || phase === 'notes-log' || phase === 'evaluate' || phase === 'herald';

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
            onClick={handleNewMemo}
            className="text-xs tracking-wide hover:opacity-80 transition-opacity"
            style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-sans)' }}
          >
            ← New Memo
          </button>
        )}
      </header>

      {/* ── Tab bar ── */}
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
        {/* Input */}
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
                The agent researches your topic, extracts and classifies claims, then produces a
                sourced memo. Evaluate claims through the HERALD pipeline.
              </p>
            </div>
            <InputForm onSubmit={handleFormSubmit} isDisabled={false} />
          </div>
        )}

        {/* Generating */}
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

        {/* Memo */}
        {phase === 'memo' && (
          <MemoViewer
            title={memoTitle}
            sections={memoSections}
            notesLog={notesLog}
            selectedClaimId={selectedClaimId}
            onClaimClick={handleClaimClick}
          />
        )}

        {/* Notes Log */}
        {phase === 'notes-log' && (
          <NotesLog
            entries={notesLog}
            selectedClaimId={selectedClaimId}
            onClaimSelect={handleNotesLogSelect}
          />
        )}

        {/* Evaluate */}
        {phase === 'evaluate' && (
          <ClaimSelector entries={notesLog} onRunEvaluation={handleRunEvaluation} />
        )}

        {/* HERALD Results */}
        {phase === 'herald' && <HeraldResults results={heraldResults} notesLog={notesLog} />}
      </main>
    </div>
  );
}
