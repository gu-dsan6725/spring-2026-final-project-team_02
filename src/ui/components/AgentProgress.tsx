'use client';

export type StepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface AgentStep {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
}

interface AgentProgressProps {
  steps: AgentStep[];
  toolCallsUsed: number;
  toolCallsBudget: number;
  tokensUsed: number;
  tokensBudget: number;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return (
      <span
        className="inline-block w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
        style={{ borderColor: 'var(--color-gold)', borderTopColor: 'transparent' }}
        aria-label="Running"
      />
    );
  }
  if (status === 'complete') {
    return (
      <span
        className="inline-flex w-5 h-5 rounded-full items-center justify-center text-xs flex-shrink-0"
        style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-navy)' }}
        aria-label="Complete"
      >
        ✓
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="inline-flex w-5 h-5 rounded-full items-center justify-center text-xs flex-shrink-0"
        style={{ backgroundColor: '#dc2626', color: 'white' }}
        aria-label="Error"
      >
        ✕
      </span>
    );
  }
  // pending
  return (
    <span
      className="inline-block w-5 h-5 rounded-full border-2 flex-shrink-0"
      style={{ borderColor: 'var(--color-paper-dark)' }}
      aria-label="Pending"
    />
  );
}

function ProgressBar({ used, budget, label }: { used: number; budget: number; label: string }) {
  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
  const isNearLimit = pct >= 80;

  return (
    <div>
      <div
        className="flex justify-between text-xs mb-1"
        style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-muted)' }}
      >
        <span>{label}</span>
        <span style={{ color: isNearLimit ? '#dc2626' : 'var(--color-navy)' }}>
          {used.toLocaleString()} / {budget.toLocaleString()}
        </span>
      </div>
      <div
        className="w-full h-1.5 rounded-full"
        style={{ backgroundColor: 'var(--color-paper-dark)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{
            width: `${pct.toFixed(1)}%`,
            backgroundColor: isNearLimit ? '#dc2626' : 'var(--color-gold)',
          }}
        />
      </div>
    </div>
  );
}

export default function AgentProgress({
  steps,
  toolCallsUsed,
  toolCallsBudget,
  tokensUsed,
  tokensBudget,
}: AgentProgressProps) {
  return (
    <div className="space-y-6">
      {/* Step list */}
      <div>
        <h3
          className="text-xs font-semibold tracking-widest uppercase mb-4"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Agent Progress
        </h3>
        <ol className="space-y-4" aria-label="Generation steps">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold leading-tight"
                  style={{
                    fontFamily: 'var(--font-sans)',
                    color: step.status === 'pending' ? 'var(--color-muted)' : 'var(--color-navy)',
                  }}
                >
                  {step.label}
                </p>
                {step.detail.length > 0 && (
                  <p
                    className="text-xs mt-0.5 truncate"
                    style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
                  >
                    {step.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Budget progress bars */}
      <div className="rounded p-4 space-y-3" style={{ backgroundColor: 'var(--color-paper-dark)' }}>
        <h3
          className="text-xs font-semibold tracking-widest uppercase mb-1"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Research Budget
        </h3>
        <ProgressBar used={toolCallsUsed} budget={toolCallsBudget} label="Tool Calls" />
        <ProgressBar used={tokensUsed} budget={tokensBudget} label="Research Tokens" />
      </div>
    </div>
  );
}
