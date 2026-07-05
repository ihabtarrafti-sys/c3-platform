import * as React from 'react';

import type { IC3HostProps } from './IC3HostProps';
import type { PlatformApplication } from '../runtime/C3RuntimeLoader';
import { decideMount, validateRuntimeModule } from './hostMount';

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
// ---------------------------------------------------------------------------

type HostStage =
  | 'idle'
  | 'did-mount'
  | 'importing'
  | 'imported'
  | 'validating'
  | 'mounting'
  | 'mount-complete'
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
  errorName?: string;
  errorMessage?: string;
  at: string;
}

interface C3HostState {
  hostError?: string;
}

export default class C3Host extends React.Component<IC3HostProps, C3HostState> {
  private readonly containerRef = React.createRef<HTMLDivElement>();
  private application?: PlatformApplication;
  private disposed = false;
  private mountedRuntime = false;
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
      validation.app.mount(target as HTMLDivElement, {
        context: {
          environment: 'dev',
          dataSourceMode: this.props.dataSourceMode,
          spSiteUrl: this.props.spSiteUrl,
          userLoginName: this.props.userLoginName,
          // Fluent UI v9 Toaster registration fails in the SPFx-hosted workbench.
          disableToasts: true,
          services: {},
        },
      });
      this.diag({ stage: 'mount-complete', mountCompleted: true });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.mountedRuntime = false;
      this.failClosed(`C3 runtime mount failed: ${e.message}`, e);
    }
  }

  public componentWillUnmount(): void {
    this.disposed = true;
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
