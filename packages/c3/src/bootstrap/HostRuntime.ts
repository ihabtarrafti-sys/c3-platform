import type { HostContextValue } from '../hosts/HostContext';

export interface HostRuntime {
  context: HostContextValue;
  /**
   * TD-34 (Sprint 33): invoked exactly once after the FIRST React commit of
   * the runtime tree. Under React 18 `root.render()` only SCHEDULES a
   * concurrent commit — mount() returning proves nothing about visible DOM.
   * The absence of this signal after mount() returned is the host's
   * detection point for a scheduled-but-never-committed first render.
   */
  onFirstCommit?: () => void;
  /**
   * TD-34 (Sprint 33): invoked when the runtime ROOT error boundary catches
   * a render-phase error. Without the root boundary such an error unmounts
   * the ENTIRE tree silently (blank container, root still attached).
   * Sanitized name/message only — never tokens, PII, or response bodies.
   */
  onRuntimeError?: (errorName: string, errorMessage: string) => void;
}
