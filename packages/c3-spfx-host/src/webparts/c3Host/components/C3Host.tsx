import * as React from 'react';

import type { IC3HostProps } from './IC3HostProps';
import type { PlatformApplication, PlatformContext } from '../runtime/C3RuntimeLoader';
import { decideMount, decideRecovery, validateRuntimeModule } from './hostMount';

// ---------------------------------------------------------------------------
// TD-34 — hardened SPFx host mount boundary.
//
// The runtime is loaded via an async dynamic import inside componentDidMount.
// On a COLD hosted load that import is a real network fetch, which widens the
// window for three failure modes that previously left a silent empty <div>:
//   1. the web part is disposed / the container detaches while importing;
//   2. the imported module does not expose a valid mount API;
//   3. mount() itself throws (async rejection React never surfaces).
// This component now awaits explicitly, validates the export, guards against
// late/duplicate mounts and detached targets, catches sync+async failures,
// renders a VISIBLE fail-closed error instead of a blank div, and publishes a
// bounded, non-sensitive diagnostics object for hosted verification.
//
// Sprint 33 hotfix — normal-use cold-load blank (TD-34 reopened):
// mount() returning proves only that React 18 SCHEDULED the first commit.
// The runtime now reports its FIRST actual commit (onFirstCommit) and any
// root render-phase error (onRuntimeError — visible fallback rendered by the
// runtime's root boundary). If neither arrives by ONE bounded deadline, the
// host performs a single deterministic recovery: cleanly unmount the first
// root, remount ONCE, and fail closed visibly if that also does not commit.
// No unbounded timers, no polling, no reloads: at most two one-shot
// deadlines, both cleared on commit or disposal. The normal successful path
// remains a single mount with zero recovery involvement.
// ---------------------------------------------------------------------------

type HostStage =
  | 'idle'
  | 'did-mount'
  | 'importing'
  | 'imported'
  | 'validating'
  | 'mounting'
  | 'mount-complete'
  | 'runtime-committed'
  | 'runtime-error'
  | 'recovering'
  | 'recovered'
  | 'recovery-failed'
  | 'skipped-disposed'
  | 'skipped-duplicate'
  | 'skipped-detached'
  | 'disposed'
  | 'error';

/** Bounded, non-sensitive host diagnostics. NEVER contains tokens, digests,
 *  personal data, or SharePoint response bodies. */
interface C3HostDiagnostics {
  stage: HostStage;
  instanceId?: string;
  dataSourceMode?: string;
  importStatus: 'idle' | 'pending' | 'resolved' | 'rejected';
  mountTargetConnected?: boolean;
  mountInvoked: boolean;
  mountCompleted: boolean;
  /** TD-34: the runtime's first commit signal arrived — application DOM exists. */
  committedFirstMount?: boolean;
  /** TD-34: the single bounded recovery remount was performed. */
  recoveryUsed?: boolean;
  /** TD-34: the recovery remount produced a committed tree. */
  commitAfterRecovery?: boolean;
  /** TD-34: ms from mount() invocation to the first commit signal. */
  timeToCommitMs?: number;
  /** TD-34: sanitized identity of a root render-phase error, if one occurred. */
  runtimeErrorName?: string;
  runtimeErrorMessage?: string;
  errorName?: string;
  errorMessage?: string;
  at: string;
}

interface C3HostState {
  hostError?: string;
}

export default class C3Host extends React.Component<IC3HostProps, C3HostState> {
  /** Single bounded deadline for the runtime's first commit signal (TD-34).
   *  One-shot per mount attempt (initial + at most one recovery). */
  private static readonly COMMIT_DEADLINE_MS = 4000;

  private readonly containerRef = React.createRef<HTMLDivElement>();
  private application?: PlatformApplication;
  private disposed = false;
  private mountedRuntime = false;
  /** TD-34: first-commit signal received from the runtime. */
  private committed = false;
  /** TD-34: the single recovery remount has been used. */
  private recoveryUsed = false;
  private commitDeadline?: number;
  private mountStartedAt = 0;
  public state: C3HostState = {};

  private diag(patch: Partial<C3HostDiagnostics>): void {
    const w = window as unknown as { __C3_HOST_DIAGNOSTICS?: C3HostDiagnostics };
    const prev: C3HostDiagnostics = w.__C3_HOST_DIAGNOSTICS ?? {
      stage: 'idle',
      importStatus: 'idle',
      mountInvoked: false,
      mountCompleted: false,
      at: new Date().toISOString(),
    };
    w.__C3_HOST_DIAGNOSTICS = { ...prev, ...patch, at: new Date().toISOString() };
  }

  private failClosed(message: string, err?: Error): void {
    this.diag({ stage: 'error', errorName: err?.name ?? 'HostError', errorMessage: message });
    if (!this.disposed) {
      this.setState({ hostError: message });
    }
    // Sanitized message only — no tokens / PII / response bodies.
    // eslint-disable-next-line no-console
    console.error(`[C3Host] ${message}`, err ?? '');
  }

  public async componentDidMount(): Promise<void> {
    this.diag({
      stage: 'did-mount',
      instanceId: this.containerRef.current?.getAttribute('id') ?? undefined,
      dataSourceMode: this.props.dataSourceMode,
      importStatus: 'pending',
      mountInvoked: false,
      mountCompleted: false,
    });

    if (this.mountedRuntime) {
      this.diag({ stage: 'skipped-duplicate' });
      return;
    }

    let runtimeModule: unknown;
    try {
      this.diag({ stage: 'importing' });
      runtimeModule = await import(
        /* webpackChunkName: 'c3-runtime' */
        '../assets/c3-runtime/c3-runtime.js'
      );
      this.diag({ stage: 'imported', importStatus: 'resolved' });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.diag({ importStatus: 'rejected' });
      this.failClosed(`C3 runtime failed to load: ${e.message}`, e);
      return;
    }

    // Late-arrival guards — the host may have been disposed or the container
    // detached while the chunk was downloading on a cold load.
    const target = this.containerRef.current;
    const targetConnected = !!target && target.isConnected;
    this.diag({ mountTargetConnected: targetConnected });

    const decision = decideMount({
      disposed: this.disposed,
      alreadyMounted: this.mountedRuntime,
      targetConnected,
    });
    if (!decision.mount) {
      if (decision.reason === 'disposed') {
        this.diag({ stage: 'skipped-disposed' });
        return; // host is gone; nothing to show
      }
      if (decision.reason === 'duplicate') {
        this.diag({ stage: 'skipped-duplicate' });
        return;
      }
      this.diag({ stage: 'skipped-detached' });
      this.failClosed('C3 host container was detached before the runtime could mount.');
      return;
    }

    this.diag({ stage: 'validating' });
    const validation = validateRuntimeModule(runtimeModule);
    if (!validation.ok) {
      this.failClosed(validation.reason);
      return;
    }

    try {
      this.diag({ stage: 'mounting', mountInvoked: true });
      this.application = validation.app;
      this.mountedRuntime = true;
      this.mountRuntimeOnce(validation.app, target as HTMLDivElement, 'initial');
      // mount() returned — the first commit is SCHEDULED, not proven. The
      // runtime's onFirstCommit signal is the proof; arm the single bounded
      // deadline that owns the no-commit case (TD-34).
      this.diag({ stage: 'mount-complete', mountCompleted: true });
      this.armCommitDeadline(target as HTMLDivElement);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.mountedRuntime = false;
      this.failClosed(`C3 runtime mount failed: ${e.message}`, e);
    }
  }

  private buildContext(): PlatformContext {
    return {
      environment: 'dev',
      dataSourceMode: this.props.dataSourceMode,
      spSiteUrl: this.props.spSiteUrl,
      userLoginName: this.props.userLoginName,
      // Fluent UI v9 Toaster registration fails in the SPFx-hosted workbench.
      disableToasts: true,
      services: {},
    };
  }

  /** Invoke runtime mount for the initial attempt or the single recovery.
   *  Both paths use identical context; only diagnostics differ. */
  private mountRuntimeOnce(
    app: PlatformApplication,
    target: HTMLDivElement,
    phase: 'initial' | 'recovery',
  ): void {
    this.mountStartedAt = Date.now();
    app.mount(target, {
      context: this.buildContext(),
      onFirstCommit: () => this.handleFirstCommit(phase),
      onRuntimeError: (errorName, errorMessage) =>
        this.handleRuntimeError(errorName, errorMessage),
    });
  }

  private handleFirstCommit(phase: 'initial' | 'recovery'): void {
    if (this.committed) return;
    this.committed = true;
    this.clearCommitDeadline();
    const timeToCommitMs = Date.now() - this.mountStartedAt;
    if (phase === 'initial') {
      this.diag({ stage: 'runtime-committed', committedFirstMount: true, timeToCommitMs });
    } else {
      this.diag({ stage: 'recovered', commitAfterRecovery: true, timeToCommitMs });
    }
  }

  private handleRuntimeError(errorName: string, errorMessage: string): void {
    // The runtime's ROOT boundary already rendered a VISIBLE fail-closed
    // fallback — record it; the commit signal (fallback UI) clears the
    // deadline, so no recovery remount runs for a render-phase error.
    this.diag({ stage: 'runtime-error', runtimeErrorName: errorName, runtimeErrorMessage: errorMessage });
    // Sanitized message only.
    // eslint-disable-next-line no-console
    console.error(`[C3Host] Runtime render error (visible fallback shown): ${errorName}: ${errorMessage}`);
  }

  private armCommitDeadline(target: HTMLDivElement): void {
    this.clearCommitDeadline();
    this.commitDeadline = window.setTimeout(
      () => this.onCommitDeadline(target),
      C3Host.COMMIT_DEADLINE_MS,
    );
  }

  private clearCommitDeadline(): void {
    if (this.commitDeadline !== undefined) {
      window.clearTimeout(this.commitDeadline);
      this.commitDeadline = undefined;
    }
  }

  /** The single bounded deadline fired without a commit signal (TD-34). */
  private onCommitDeadline(target: HTMLDivElement): void {
    this.commitDeadline = undefined;
    const decision = decideRecovery({
      mountCompleted: this.mountedRuntime,
      committed: this.committed,
      disposed: this.disposed,
      targetConnected: target.isConnected,
      recoveryUsed: this.recoveryUsed,
    });

    if (!decision.recover) {
      if (decision.reason === 'already-recovered') {
        // The one permitted recovery also failed to commit — fail closed.
        this.diag({ stage: 'recovery-failed' });
        try {
          this.application?.unmount(target);
        } catch {
          /* best-effort cleanup before the visible error replaces the container */
        }
        this.failClosed(
          'C3 loaded but did not render, and one bounded recovery attempt also did not render.',
        );
      } else if (decision.reason === 'detached') {
        this.diag({ stage: 'skipped-detached' });
        this.failClosed('C3 host container was detached before the runtime rendered.');
      }
      // 'committed' → normal path; 'disposed' → host is gone, stay silent;
      // 'not-mounted' → unreachable (deadline is armed only after mount-complete).
      return;
    }

    // Bounded ONE-SHOT recovery: clean the first root, remount exactly once.
    this.recoveryUsed = true;
    this.diag({ stage: 'recovering', recoveryUsed: true });
    const app = this.application;
    if (!app) {
      this.failClosed('C3 recovery could not run: runtime handle missing.');
      return;
    }
    try {
      // Cleanly unmount the first (uncommitted) root before the remount —
      // the runtime keys roots by container, so this guarantees no duplicate
      // root or duplicate application instance can exist.
      app.unmount(target);
    } catch {
      /* the first root may have nothing to clean — recovery proceeds */
    }
    try {
      this.mountRuntimeOnce(app, target, 'recovery');
      this.armCommitDeadline(target); // second (final) bounded deadline
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.diag({ stage: 'recovery-failed' });
      this.failClosed(`C3 recovery remount failed: ${e.message}`, e);
    }
  }

  public componentWillUnmount(): void {
    this.disposed = true;
    this.clearCommitDeadline();
    this.diag({ stage: 'disposed' });
    if (this.mountedRuntime && this.application && this.containerRef.current) {
      try {
        this.application.unmount(this.containerRef.current);
      } catch {
        /* best-effort cleanup */
      }
    }
    this.mountedRuntime = false;
  }

  public render(): React.ReactElement {
    if (this.state.hostError) {
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            margin: 12,
            border: '1px solid #f3d6d8',
            borderRadius: 4,
            background: '#fdf3f4',
            fontFamily: 'Segoe UI, system-ui, sans-serif',
          }}
        >
          <strong style={{ color: '#a4262c' }}>C3 could not start on this page.</strong>
          <div style={{ marginTop: 6, color: '#605e5c', fontSize: 13 }}>
            {this.state.hostError} Please reload the page. If this persists, contact an administrator.
          </div>
        </div>
      );
    }
    return <div ref={this.containerRef} />;
  }
}
