/**
 * ErrorBoundary — Sprint 20 Phase 0 (S20-P0-1)
 *
 * Top-level React error boundary. Catches uncaught render-phase errors before
 * they propagate to the SPFx host and produce a blank white webpart.
 *
 * Placement: wraps renderScreen() in AppShell so individual screen crashes
 * are isolated — the NavRail and MockBanner remain functional and the user
 * can navigate away to a working screen without a full page reload.
 *
 * Behavior:
 *   - Logs full error + component stack to console (important for beta triage).
 *   - Renders a C3-branded fallback with an error detail block and Reload button.
 *   - Does NOT swallow errors silently.
 *   - Uses inline style fallbacks for all design tokens so the fallback renders
 *     correctly even if the token provider itself caused the crash.
 *
 * Note: function components cannot be error boundaries — class component is
 * required by the React error boundary contract.
 *
 * Sprint 20 Phase 0: beta surface hardening.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log full details for beta triage. Do not swallow.
    console.error('[C3/ErrorBoundary] Uncaught render error:', error);
    console.error('[C3/ErrorBoundary] Component stack:', info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error } = this.state;

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '48px 32px',
          gap: '16px',
          textAlign: 'center',
          backgroundColor: 'var(--c3-gray-50, #F8FAFC)',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {/* Icon circle */}
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: 'var(--c3-critical-bg, #FEF2F2)',
              border: '1px solid var(--c3-critical, #DC2626)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              color: 'var(--c3-critical, #DC2626)',
              flexShrink: 0,
            }}
          >
            !
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--c3-gray-950, #0F172A)',
              letterSpacing: '-0.01em',
            }}
          >
            Something went wrong
          </div>

          {/* Body */}
          <div
            style={{
              fontSize: 13,
              color: 'var(--c3-gray-500, #64748B)',
              lineHeight: '1.6',
            }}
          >
            C3 encountered an unexpected error in this screen.
            Your data has not been affected.
            Reload the page to continue working.
          </div>

          {/* Error detail block — visible in beta for triage */}
          {error && (
            <div
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'var(--c3-gray-100, #F1F5F9)',
                border: '1px solid var(--c3-gray-200, #E2E8F0)',
                fontSize: 11,
                fontFamily: 'monospace',
                color: 'var(--c3-gray-600, #475569)',
                textAlign: 'left',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </div>
          )}

          {/* Reload action */}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 4,
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: 'var(--c3-brand, #4F46E5)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
            }}
          >
            Reload C3
          </button>
        </div>
      </div>
    );
  }
}
