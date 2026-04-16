'use client';

/**
 * ErrorBoundary — React class component that catches render errors.
 *
 * Usage:
 *   <ErrorBoundary label="Memo Viewer">
 *     <MemoViewer ... />
 *   </ErrorBoundary>
 *
 * Props:
 *   label        — human-readable name for the wrapped section (used in the fallback UI)
 *   fallback     — custom fallback node (overrides the default error panel)
 *   onError      — optional callback for error logging / telemetry
 *   resetKey     — when this value changes, the boundary resets and re-renders children
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
  label?: string;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

function DefaultFallback({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: Error | null;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="rounded-lg border p-6 flex flex-col gap-3"
      style={{
        borderColor: '#fca5a5',
        backgroundColor: '#fff5f5',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold"
          style={{ backgroundColor: '#dc2626', color: 'white' }}
          aria-hidden="true"
        >
          !
        </span>
        <span className="font-semibold text-base" style={{ color: '#991b1b' }}>
          {label} encountered an unexpected error
        </span>
      </div>

      {error !== null && (
        <details className="text-sm" style={{ color: '#7f1d1d' }}>
          <summary className="cursor-pointer select-none">Error details</summary>
          <pre
            className="mt-2 p-3 rounded text-xs overflow-auto whitespace-pre-wrap"
            style={{ backgroundColor: '#fee2e2', maxHeight: '8rem' }}
          >
            {error.message}
            {error.stack !== undefined ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      )}

      <button
        onClick={onRetry}
        className="self-start rounded px-4 py-2 text-sm font-medium cursor-pointer transition-opacity hover:opacity-80"
        style={{
          backgroundColor: 'var(--color-navy, #0b2545)',
          color: 'white',
          border: 'none',
        }}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary class
// ---------------------------------------------------------------------------

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    // Log to console in dev — in production this would go to Braintrust
    console.error(`[ErrorBoundary: ${this.props.label ?? 'unknown'}]`, error, errorInfo);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset when resetKey changes — allows parent to trigger recovery
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <DefaultFallback
        label={this.props.label ?? 'Component'}
        error={this.state.error}
        onRetry={this.handleRetry}
      />
    );
  }
}
