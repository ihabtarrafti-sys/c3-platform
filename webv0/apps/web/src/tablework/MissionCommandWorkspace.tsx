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
import './mission-command.css';

export interface MissionCommandModule {
  readonly id: MissionCommandModuleId;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly truth: WitnessState;
  /** Whether governed controls in this module may currently act. */
  readonly actionable?: boolean;
  readonly children: ReactNode;
}

interface MissionCommandWorkspaceProps {
  readonly missionId: string;
  readonly missionName: string;
  readonly modules: readonly MissionCommandModule[];
}

const LAYOUT_LABELS: ReadonlyArray<{ id: MissionCommandPreset; label: string }> = [
  { id: 'commander', label: 'Commander' },
  { id: 'review', label: 'Review' },
  { id: 'brief', label: 'Brief' },
];

const COMPACT_QUERY = '(max-width: 71.999rem)';

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
};

function storageKey(missionId: string): string {
  return `c3:mission-command:${missionId}:workspace:v1`;
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
      return 'Denied';
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

export function MissionCommandWorkspace({ missionId, missionName, modules }: MissionCommandWorkspaceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const governedControlWindow = useRef<MissionCommandModuleId | null>(null);
  const previousActionability = useRef(new Map<MissionCommandModuleId, boolean>());
  const compact = useCompactWorkspace();
  const [state, dispatch] = useReducer(
    missionCommandReducer,
    DEFAULT_MISSION_COMMAND,
    () => {
      try {
        return restoreMissionCommand(localStorage.getItem(storageKey(missionId)));
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

  const moduleById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules]);

  const focusDockButton = (id: MissionCommandModuleId) => {
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-window-launcher="${id}"]`)?.focus();
    });
  };

  const focusWindow = (id: MissionCommandModuleId) => {
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-module="${id}"]`)?.focus();
    });
  };

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
    dispatch({ type: 'set-visibility', id, visibility });
    focusDockButton(id);
  };

  const adjustWithKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    id: MissionCommandModuleId,
    rect: MissionCommandRect,
    action: 'move' | 'resize',
  ) => {
    if (compact) return;
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
    if (compact || event.button !== 0) return;
    if (action === 'move' && (event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
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
              onClick={() => dispatch({ type: 'apply-layout', layout: layout.id })}
            >
              {layout.label}
            </button>
          ))}
          <button type="button" onClick={() => dispatch({ type: 'reset' })}>
            Reset
          </button>
        </div>
      </header>

      <div className="mission-command-canvas" ref={canvasRef}>
        <div className="mission-command-contours" aria-hidden="true" />
        {state.windows.map((windowState) => {
          const module = moduleById.get(windowState.id);
          if (!module) return null;
          return (
            <article
              key={module.id}
              className={`mission-command-window module-${module.id}`}
              data-module={module.id}
              data-module-truth={module.truth.kind}
              tabIndex={-1}
              aria-label={`${module.title} window`}
              hidden={windowState.visibility !== 'open'}
              style={styleFor(windowState.rect, windowState.z)}
              onPointerDown={() => dispatch({ type: 'bring-forward', id: module.id })}
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
                <span className="mission-command-windowactions">
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
                </span>
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
          if (!module) return null;
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
