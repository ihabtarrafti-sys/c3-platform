import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { WitnessState } from './TruthPanel';
import {
  DEFAULT_MISSION_COMMAND,
  missionCommandReducer,
  restoreMissionCommand,
  type MissionCommandModuleId,
  type MissionCommandPreset,
  type MissionCommandRect,
} from './missionCommandModel';
import {
  MAX_SAVED_WORKSPACE_LAYOUTS,
  type WorkspaceSnap,
} from './workspaceModel';
import './mission-command.css';

export interface MissionCommandModule {
  readonly id: MissionCommandModuleId;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly truth: WitnessState;
  /** Whether governed controls in this module may currently act. */
  readonly actionable?: boolean;
  /** Desktop modules may release their live tree when explicitly closed. */
  readonly unmountWhenClosed?: boolean;
  readonly children: ReactNode;
}

interface MissionCommandWorkspaceProps {
  readonly missionId: string;
  readonly missionName: string;
  readonly modules: readonly MissionCommandModule[];
  /** The module named by the current route. It may arrive before its live tree. */
  readonly requestedModule?: MissionCommandModuleId;
  /** A navigation-instance key lets the same route request raise/reopen again. */
  readonly requestKey?: string | number;
  /** Reports the topmost open module that actually exists in this workspace. */
  readonly onForegroundModuleChange?: (id: MissionCommandModuleId | null) => void;
  /** Runs only after a user close has committed; minimize never calls it. */
  readonly onCloseModule?: (id: MissionCommandModuleId) => void;
  /** A parked workspace retains its model while releasing transient UI. */
  readonly active?: boolean;
}

const LAYOUT_LABELS: ReadonlyArray<{ id: MissionCommandPreset; label: string }> = [
  { id: 'commander', label: 'Commander' },
  { id: 'review', label: 'Review' },
  { id: 'brief', label: 'Brief' },
  { id: 'finance', label: 'Finance' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'planning', label: 'Planning' },
  { id: 'coordinate', label: 'Coordinate' },
  { id: 'continuity', label: 'Continuity' },
  { id: 'command', label: 'Command' },
  { id: 'people', label: 'People' },
];

const COMPACT_QUERY = '(max-width: 71.999rem)';

const SNAP_OPTIONS: ReadonlyArray<{ id: WorkspaceSnap; label: string }> = [
  { id: 'left-half', label: 'Left half' },
  { id: 'right-half', label: 'Right half' },
  { id: 'left-third', label: 'Left third' },
  { id: 'center-third', label: 'Center third' },
  { id: 'right-third', label: 'Right third' },
  { id: 'top-left', label: 'Top left quarter' },
  { id: 'top-right', label: 'Top right quarter' },
  { id: 'bottom-left', label: 'Bottom left quarter' },
  { id: 'bottom-right', label: 'Bottom right quarter' },
  { id: 'full', label: 'Full canvas' },
];

function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

const MODULE_GLYPHS: Readonly<Record<MissionCommandModuleId, string>> = {
  'mission-field': '◇',
  'mission-current': '↯',
  'mission-obligations': '✓',
  'mission-finance': '¤',
  'approvals-register': '⌁',
  'calendar-horizon': '◫',
  'command-constellation': '✦',
  'command-attention': '◎',
  'mission-continuity': '⟷',
  'conversation-relay': '◉',
  'people-field': '○',
  'person-record': '◌',
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a, input, select, textarea, label') !== null;
}

function storageKey(missionId: string): string {
  return `c3:mission-command:${missionId}:workspace:v2`;
}

function legacyStorageKey(missionId: string): string {
  return `c3:mission-command:${missionId}:workspace:v1`;
}

function nextSavedLayoutId(ids: readonly string[]): string | null {
  for (let index = 1; index <= MAX_SAVED_WORKSPACE_LAYOUTS; index += 1) {
    const candidate = `view-${index}`;
    if (!ids.includes(candidate)) return candidate;
  }
  return null;
}

function truthLabel(truth: WitnessState): string {
  switch (truth.kind) {
    case 'loading':
      return 'Checking';
    case 'verified':
      return 'Verified';
    case 'proven-empty':
      return 'Verified empty';
    case 'denied':
      return truth.reasonClass === 'THREAD_NOT_AVAILABLE' || truth.reasonClass === 'PERSON_NOT_AVAILABLE'
        ? 'Unavailable'
        : 'Denied';
    case 'fetch-failed':
      return 'Fetch failed';
    case 'stale':
      return 'Stale';
  }
}

function styleFor(rect: MissionCommandRect, z: number): CSSProperties {
  return {
    '--mc-x': `${rect.x}%`,
    '--mc-y': `${rect.y}%`,
    '--mc-w': `${rect.width}%`,
    '--mc-h': `${rect.height}%`,
    zIndex: z,
  } as CSSProperties;
}

export function MissionCommandWorkspace({
  missionId,
  missionName,
  modules,
  requestedModule,
  requestKey,
  onForegroundModuleChange,
  onCloseModule,
  active = true,
}: MissionCommandWorkspaceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutNameRef = useRef<HTMLInputElement>(null);
  const governedControlWindow = useRef<MissionCommandModuleId | null>(null);
  const previousActionability = useRef(new Map<MissionCommandModuleId, boolean>());
  const initialRouteRequestHandled = useRef(false);
  const lastRouteRequest = useRef<{ id: MissionCommandModuleId; key: string | number | undefined } | null>(null);
  const pendingRouteForeground = useRef<MissionCommandModuleId | null>(null);
  const lastReportedForeground = useRef<MissionCommandModuleId | null | undefined>(undefined);
  const pendingCloseNotifications = useRef<MissionCommandModuleId[]>([]);
  const pointerCleanup = useRef<(() => void) | null>(null);
  const blockedGovernedClick = useRef<{
    readonly moduleId: MissionCommandModuleId;
    readonly pointerId: number;
  } | null>(null);
  const compact = useCompactWorkspace();
  const [snapMenu, setSnapMenu] = useState<MissionCommandModuleId | null>(null);
  const [layoutLibraryOpen, setLayoutLibraryOpen] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [state, dispatch] = useReducer(
    missionCommandReducer,
    DEFAULT_MISSION_COMMAND,
    () => {
      try {
        const current = localStorage.getItem(storageKey(missionId));
        return restoreMissionCommand(current ?? localStorage.getItem(legacyStorageKey(missionId)));
      } catch {
        return restoreMissionCommand(null);
      }
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(missionId), JSON.stringify(state));
    } catch {
      /* Device persistence is an enhancement; the workspace remains usable. */
    }
  }, [missionId, state]);

  useEffect(() => {
    if (!layoutLibraryOpen) return;
    window.requestAnimationFrame(() => layoutNameRef.current?.focus());
  }, [layoutLibraryOpen]);

  useLayoutEffect(() => {
    if (active) return;
    setSnapMenu(null);
    setLayoutLibraryOpen(false);
    pointerCleanup.current?.();
  }, [active]);

  useEffect(
    () => () => {
      pointerCleanup.current?.();
    },
    [],
  );

  const moduleById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules]);
  const requestedModuleAvailable = requestedModule !== undefined && moduleById.has(requestedModule);
  const foregroundModule = useMemo(() => {
    let front: { id: MissionCommandModuleId; z: number } | null = null;
    for (const window of state.windows) {
      if (window.visibility !== 'open' || !moduleById.has(window.id)) continue;
      // Equal z values are legal in restored state; the later DOM sibling is
      // visually above, so it is also the truthful foreground report.
      if (front === null || window.z >= front.z) front = { id: window.id, z: window.z };
    }
    return front?.id ?? null;
  }, [moduleById, state.windows]);
  const availableSavedLayoutId = nextSavedLayoutId(state.savedLayouts.map((layout) => layout.id));
  const canSaveLayout = availableSavedLayoutId !== null && layoutName.trim().length > 0;

  const focusDockButton = (id: MissionCommandModuleId) => {
    window.requestAnimationFrame(() => {
      const root = rootRef.current;
      const launcher = root?.querySelector<HTMLButtonElement>(`[data-window-launcher="${id}"]`);
      (launcher ?? root?.querySelector<HTMLButtonElement>('[data-window-launcher]'))?.focus();
    });
  };

  const focusWindow = (id: MissionCommandModuleId) => {
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-module="${id}"]`)?.focus();
    });
  };

  const closeLayoutLibrary = () => {
    setLayoutLibraryOpen(false);
    window.requestAnimationFrame(() => layoutTriggerRef.current?.focus());
  };

  const arrangeWindow = (id: MissionCommandModuleId, snap: WorkspaceSnap) => {
    dispatch({ type: 'snap-window', id, snap });
    setSnapMenu(null);
    focusWindow(id);
  };

  const restoreFreeformWindow = (id: MissionCommandModuleId) => {
    dispatch({ type: 'restore-window', id });
    setSnapMenu(null);
    focusWindow(id);
  };

  useLayoutEffect(() => {
    if (!requestedModule || !requestedModuleAvailable) return;
    const previous = lastRouteRequest.current;
    if (previous?.id === requestedModule && Object.is(previous.key, requestKey)) return;
    lastRouteRequest.current = { id: requestedModule, key: requestKey };
    pendingRouteForeground.current = requestedModule;
    const shouldFocus = initialRouteRequestHandled.current;
    initialRouteRequestHandled.current = true;
    dispatch({ type: 'activate-route', id: requestedModule });
    // The initial deep link leaves focus on the skip-link/browser target. A
    // later route request is an explicit workspace transition and may focus.
    if (shouldFocus) focusWindow(requestedModule);
  }, [requestKey, requestedModule, requestedModuleAvailable]);

  useLayoutEffect(() => {
    const pending = pendingRouteForeground.current;
    if (pending !== null) {
      // A layout-effect activation dispatches before paint. Do not briefly
      // report the old front window while that committed request is pending.
      if (foregroundModule !== pending) return;
      pendingRouteForeground.current = null;
    }
    if (!onForegroundModuleChange) {
      lastReportedForeground.current = undefined;
      return;
    }
    if (lastReportedForeground.current === foregroundModule) return;
    lastReportedForeground.current = foregroundModule;
    onForegroundModuleChange(foregroundModule);
  }, [foregroundModule, onForegroundModuleChange]);

  useLayoutEffect(() => {
    if (pendingCloseNotifications.current.length === 0) return;
    const confirmed: MissionCommandModuleId[] = [];
    const stillPending: MissionCommandModuleId[] = [];
    for (const id of pendingCloseNotifications.current) {
      const visibility = state.windows.find((window) => window.id === id)?.visibility;
      if (visibility === 'closed') confirmed.push(id);
      else stillPending.push(id);
    }
    pendingCloseNotifications.current = stillPending;
    for (const id of confirmed) onCloseModule?.(id);
  }, [onCloseModule, state.windows]);

  useLayoutEffect(() => {
    const next = new Map(modules.map((module) => [module.id, module.actionable ?? true] as const));
    const lostFocusOwner = modules.find(
      (module) =>
        previousActionability.current.get(module.id) === true &&
        next.get(module.id) === false &&
        governedControlWindow.current === module.id,
    );
    previousActionability.current = next;
    if (!lostFocusOwner) return;
    governedControlWindow.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-module="${lostFocusOwner.id}"]`)?.focus();
  }, [modules]);

  const parkWindow = (id: MissionCommandModuleId, visibility: 'minimized' | 'closed') => {
    if (visibility === 'closed' && !pendingCloseNotifications.current.includes(id)) {
      pendingCloseNotifications.current.push(id);
    }
    setSnapMenu(null);
    dispatch({ type: 'set-visibility', id, visibility });
    focusDockButton(id);
  };

  const queueForceCloseTransitions = (next: typeof state) => {
    for (const module of modules) {
      if (!module.unmountWhenClosed) continue;
      const currentVisibility = state.windows.find((window) => window.id === module.id)?.visibility;
      const nextVisibility = next.windows.find((window) => window.id === module.id)?.visibility;
      if (
        currentVisibility !== 'closed' &&
        nextVisibility === 'closed' &&
        !pendingCloseNotifications.current.includes(module.id)
      ) {
        pendingCloseNotifications.current.push(module.id);
      }
    }
  };

  const applyLayout = (layout: MissionCommandPreset) => {
    setSnapMenu(null);
    const action = { type: 'apply-layout' as const, layout };
    queueForceCloseTransitions(missionCommandReducer(state, action));
    dispatch(action);
  };

  const applySavedLayout = (id: string) => {
    const saved = state.savedLayouts.find((layout) => layout.id === id);
    if (!saved) return;
    setSnapMenu(null);
    const action = { type: 'apply-saved-layout' as const, id };
    queueForceCloseTransitions(missionCommandReducer(state, action));
    dispatch(action);
  };

  const resetLayout = () => {
    setSnapMenu(null);
    const action = { type: 'reset' as const };
    queueForceCloseTransitions(missionCommandReducer(state, action));
    dispatch(action);
  };

  const adjustWithKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    id: MissionCommandModuleId,
    rect: MissionCommandRect,
    action: 'move' | 'resize',
  ) => {
    if (!active || compact) return;
    const step = event.shiftKey ? 5 : 1;
    const horizontal = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const vertical = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (horizontal === 0 && vertical === 0) return;
    event.preventDefault();
    dispatch({
      type: 'set-rect',
      id,
      rect:
        action === 'move'
          ? { ...rect, x: rect.x + horizontal, y: rect.y + vertical }
          : { ...rect, width: rect.width + horizontal, height: rect.height + vertical },
    });
  };

  const beginPointerAction = (
    event: ReactPointerEvent<HTMLElement>,
    id: MissionCommandModuleId,
    rect: MissionCommandRect,
    action: 'move' | 'resize',
  ) => {
    if (!active || compact || event.button !== 0) return;
    if (action === 'move' && (event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The resize handle is itself a button, so the article deliberately does
    // not raise it on pointer-down. Raise here before the geometry gesture.
    if (action === 'resize') dispatch({ type: 'bring-forward', id });
    event.preventDefault();
    dispatch({ type: 'bring-forward', id });
    const bounds = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;

    const move = (next: PointerEvent) => {
      const dx = ((next.clientX - startX) / bounds.width) * 100;
      const dy = ((next.clientY - startY) / bounds.height) * 100;
      dispatch({
        type: 'set-rect',
        id,
        rect:
          action === 'move'
            ? { ...rect, x: rect.x + dx, y: rect.y + dy }
            : { ...rect, width: rect.width + dx, height: rect.height + dy },
      });
    };
    pointerCleanup.current?.();
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (pointerCleanup.current === finish) pointerCleanup.current = null;
    };
    pointerCleanup.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  return (
    <section
      className="mission-command"
      data-tablework="MissionCommand"
      data-testid="mission-command"
      aria-label={`${missionName} Mission Command`}
      ref={rootRef}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        const owner = target.closest<HTMLElement>('[data-module]');
        governedControlWindow.current =
          target.closest('[data-governed-control]') && owner
            ? (owner.dataset.module as MissionCommandModuleId)
            : null;
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        const owner = modules.find((module) => module.id === governedControlWindow.current);
        if (event.relatedTarget === null && owner?.actionable === false) return;
        governedControlWindow.current = null;
      }}
    >
      <header className="mission-command-bar">
        <div className="mission-command-identity">
          <span className="mission-command-mark" aria-hidden="true">
            C3
          </span>
          <span>
            <small>Mission Command</small>
            <strong>{missionName}</strong>
          </span>
          <span className="mission-command-id">{missionId}</span>
        </div>
        <div className="mission-command-layouts" role="group" aria-label="Workspace layouts">
          {LAYOUT_LABELS.map((layout) => (
            <button
              type="button"
              key={layout.id}
              className={state.layout === layout.id ? 'is-active' : undefined}
              aria-pressed={state.layout === layout.id}
              onClick={() => applyLayout(layout.id)}
            >
              {layout.label}
            </button>
          ))}
          <button type="button" onClick={resetLayout}>
            Reset
          </button>
          <button
            type="button"
            ref={layoutTriggerRef}
            className={state.activeSavedLayoutId !== null ? 'is-active' : undefined}
            aria-expanded={layoutLibraryOpen}
            aria-controls="mission-command-layout-library"
            onClick={() => setLayoutLibraryOpen((open) => !open)}
          >
            Views {state.savedLayouts.length > 0 ? state.savedLayouts.length : ''}
          </button>
        </div>
      </header>

      {layoutLibraryOpen ? (
        <dialog
          open
          id="mission-command-layout-library"
          className="mission-command-layoutlibrary"
          aria-label="Saved workspace views"
          onCancel={(event) => {
            event.preventDefault();
            closeLayoutLibrary();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeLayoutLibrary();
            }
          }}
        >
          <header>
            <span>
              <small>Device workspace</small>
              <strong>Saved views</strong>
            </span>
            <button type="button" aria-label="Close saved views" onClick={closeLayoutLibrary}>
              ×
            </button>
          </header>
          <p>Save window position, size, and lifecycle only. Records, identity, drafts, permissions, and truth never enter a view.</p>
          <form
            className="mission-command-layoutform"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSaveLayout || availableSavedLayoutId === null) return;
              dispatch({ type: 'save-layout', id: availableSavedLayoutId, name: layoutName });
              setLayoutName('');
            }}
          >
            <label htmlFor="mission-command-layout-name">Name this view</label>
            <span>
              <input
                ref={layoutNameRef}
                id="mission-command-layout-name"
                value={layoutName}
                maxLength={48}
                placeholder="e.g. Morning command"
                onChange={(event) => setLayoutName(event.target.value)}
              />
              <button type="submit" disabled={!canSaveLayout}>
                Save current
              </button>
            </span>
          </form>
          {state.savedLayouts.length === 0 ? (
            <p className="mission-command-layoutempty">No saved views yet.</p>
          ) : (
            <div className="mission-command-layoutlist" role="list" aria-label="Saved views">
              {state.savedLayouts.map((layout) => (
                <article
                  key={layout.id}
                  role="listitem"
                  className={state.activeSavedLayoutId === layout.id ? 'is-active' : undefined}
                >
                  <span>
                    <strong>{layout.name}</strong>
                    <small>{state.activeSavedLayoutId === layout.id ? 'In use' : 'Ready'}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      applySavedLayout(layout.id);
                      closeLayoutLibrary();
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="is-quiet"
                    aria-label={`Delete ${layout.name}`}
                    onClick={() => dispatch({ type: 'delete-saved-layout', id: layout.id })}
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          )}
          <footer>
            <span>{state.savedLayouts.length} / {MAX_SAVED_WORKSPACE_LAYOUTS} views</span>
            <span>Stored on this device</span>
          </footer>
        </dialog>
      ) : null}

      <div className="mission-command-canvas" ref={canvasRef}>
        <div className="mission-command-contours" aria-hidden="true" />
        {state.windows.map((windowState) => {
          const module = moduleById.get(windowState.id);
          if (!module || (module.unmountWhenClosed && windowState.visibility === 'closed')) return null;
          return (
            <article
              key={module.id}
              className={`mission-command-window module-${module.id}`}
              data-module={module.id}
              data-module-truth={module.truth.kind}
              data-window-snap={windowState.snap ?? 'freeform'}
              tabIndex={-1}
              aria-label={`${module.title} window`}
              hidden={windowState.visibility !== 'open'}
              style={styleFor(windowState.rect, windowState.z)}
              onPointerDownCapture={(event) => {
                const governed =
                  event.target instanceof HTMLElement && event.target.closest('[data-governed-control]') !== null;
                if (!governed || module.id === foregroundModule) return;
                blockedGovernedClick.current = { moduleId: module.id, pointerId: event.pointerId };
                event.preventDefault();
                event.stopPropagation();
                dispatch({ type: 'bring-forward', id: module.id });
              }}
              onPointerUpCapture={(event) => {
                const token = blockedGovernedClick.current;
                if (!token || token.moduleId !== module.id || token.pointerId !== event.pointerId) return;
                window.setTimeout(() => {
                  if (blockedGovernedClick.current === token) blockedGovernedClick.current = null;
                }, 0);
              }}
              onPointerCancelCapture={(event) => {
                const token = blockedGovernedClick.current;
                if (token?.moduleId === module.id && token.pointerId === event.pointerId) {
                  blockedGovernedClick.current = null;
                }
              }}
              onClickCapture={(event) => {
                const governed =
                  event.target instanceof HTMLElement && event.target.closest('[data-governed-control]') !== null;
                if (!governed) return;
                const hasPointerToken = blockedGovernedClick.current?.moduleId === module.id;
                const isBackground = module.id !== foregroundModule;
                if (!hasPointerToken && !isBackground) return;
                blockedGovernedClick.current = null;
                event.preventDefault();
                event.stopPropagation();
                if (isBackground) dispatch({ type: 'bring-forward', id: module.id });
              }}
              onKeyDownCapture={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const governed =
                  event.target instanceof HTMLElement && event.target.closest('[data-governed-control]') !== null;
                if (!governed || (module.id === foregroundModule && module.actionable !== false)) return;
                event.preventDefault();
                event.stopPropagation();
                if (module.id !== foregroundModule) dispatch({ type: 'bring-forward', id: module.id });
              }}
              onPointerDown={(event) => {
                // A foreground edge starts a synchronous re-witness and may
                // replace a truth wrapper. Let links and controls receive
                // their click before that transition; otherwise a pointer-down
                // in a background window can remove its own click target.
                if (!isInteractiveTarget(event.target)) dispatch({ type: 'bring-forward', id: module.id });
              }}
              onClick={(event) => {
                if (isInteractiveTarget(event.target)) dispatch({ type: 'bring-forward', id: module.id });
              }}
            >
              <header
                className="mission-command-windowbar"
                tabIndex={compact ? undefined : 0}
                aria-label={compact ? undefined : `Move ${module.title} window with arrow keys`}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget) adjustWithKeyboard(event, module.id, windowState.rect, 'move');
                }}
                onPointerDown={
                  compact ? undefined : (event) => beginPointerAction(event, module.id, windowState.rect, 'move')
                }
              >
                <span className="mission-command-windowglyph" aria-hidden="true">
                  {MODULE_GLYPHS[module.id]}
                </span>
                <span className="mission-command-windowname">
                  <small>{module.eyebrow}</small>
                  <strong>{module.title}</strong>
                </span>
                <span className={`mission-command-truth truth-${module.truth.kind}`}>{truthLabel(module.truth)}</span>
                <div className="mission-command-windowactions">
                  {!compact ? (
                    <>
                      <button
                        type="button"
                        className="mission-command-arrange"
                        title={`Arrange ${module.title}`}
                        aria-label={`Arrange ${module.title}`}
                        aria-expanded={snapMenu === module.id}
                        aria-controls={`snap-${missionId}-${module.id}`}
                        onClick={() => setSnapMenu((open) => (open === module.id ? null : module.id))}
                      >
                        ▦
                      </button>
                      {snapMenu === module.id ? (
                        <div
                          id={`snap-${missionId}-${module.id}`}
                          className="mission-command-snappalette"
                          role="group"
                          aria-label={`Arrange ${module.title} on the workspace`}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setSnapMenu(null);
                              focusWindow(module.id);
                            }
                          }}
                        >
                          <strong>Snap window</strong>
                          <span className="mission-command-snapgrid">
                            {SNAP_OPTIONS.map((option) => (
                              <button
                                type="button"
                                key={option.id}
                                className={windowState.snap === option.id ? 'is-active' : undefined}
                                data-snap-target={option.id}
                                title={option.label}
                                aria-label={`${option.label}: ${module.title}`}
                                aria-pressed={windowState.snap === option.id}
                                onClick={() => arrangeWindow(module.id, option.id)}
                              >
                                <span className={`mission-command-snapicon snap-${option.id}`} aria-hidden="true" />
                              </button>
                            ))}
                          </span>
                          {windowState.snap !== null ? (
                            <button
                              type="button"
                              className="mission-command-freeform"
                              onClick={() => restoreFreeformWindow(module.id)}
                            >
                              Restore freeform
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    title={`Minimize ${module.title}`}
                    aria-label={`Minimize ${module.title}`}
                    onClick={() => parkWindow(module.id, 'minimized')}
                  >
                    —
                  </button>
                  <button
                    type="button"
                    title={`Close ${module.title}`}
                    aria-label={`Close ${module.title}`}
                    onClick={() => parkWindow(module.id, 'closed')}
                  >
                    ×
                  </button>
                </div>
              </header>
              <p className="mission-command-windowdetail">{module.detail}</p>
              <div className="mission-command-windowbody">{module.children}</div>
              {!compact ? (
                <button
                  className="mission-command-resize"
                  type="button"
                  aria-label={`Resize ${module.title}. Drag or use arrow keys.`}
                  title={`Resize ${module.title}. Drag or use arrow keys.`}
                  onKeyDown={(event) => adjustWithKeyboard(event, module.id, windowState.rect, 'resize')}
                  onClick={(event) => {
                    if (event.detail === 0) {
                      dispatch({
                        type: 'set-rect',
                        id: module.id,
                        rect: { ...windowState.rect, width: windowState.rect.width + 5, height: windowState.rect.height + 5 },
                      });
                    }
                  }}
                  onPointerDown={(event) => beginPointerAction(event, module.id, windowState.rect, 'resize')}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <footer className="mission-command-dock" aria-label="Open Mission Command modules">
        <span className="mission-command-docklabel">Open windows</span>
        {state.windows.map((windowState) => {
          const module = moduleById.get(windowState.id);
          if (!module || (module.unmountWhenClosed && windowState.visibility === 'closed')) return null;
          return (
            <button
              type="button"
              key={module.id}
              className={windowState.visibility === 'open' ? 'is-open' : undefined}
              data-window-state={windowState.visibility}
              data-window-launcher={module.id}
              onClick={() => {
                if (windowState.visibility === 'open') dispatch({ type: 'bring-forward', id: module.id });
                else dispatch({ type: 'open', id: module.id });
                focusWindow(module.id);
              }}
            >
              <span aria-hidden="true">{MODULE_GLYPHS[module.id]}</span>
              {module.title}
              <small>{windowState.visibility}</small>
            </button>
          );
        })}
        <span className="mission-command-docknote">Layouts stay on this device · closing removes only the window</span>
      </footer>
    </section>
  );
}
