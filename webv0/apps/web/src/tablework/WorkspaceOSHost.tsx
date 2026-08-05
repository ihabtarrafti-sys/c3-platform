import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation } from 'react-router-dom';
import { MissionCommsPage } from '../pages/MissionCommsPage';
import {
  missionWorkspaceTargetOf,
  type MissionWorkspaceTarget,
} from '../pages/MissionWorkspaceRoute';

interface RememberedMissionWorkspace extends MissionWorkspaceTarget {
  readonly requestKey: string;
}

function ParkableMissionWorkspace({
  target,
  active,
}: {
  readonly target: RememberedMissionWorkspace;
  readonly active: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [portalTarget] = useState(() => {
    const element = document.createElement('div');
    element.dataset.workspaceOwner = 'principal';
    return element;
  });

  useLayoutEffect(() => {
    if (active) {
      mountRef.current?.appendChild(portalTarget);
      return;
    }

    const ownedFocus = portalTarget.contains(document.activeElement);
    portalTarget.remove();
    if (ownedFocus) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.skip-link')?.focus());
    }
  }, [active, portalTarget]);

  useLayoutEffect(
    () => () => {
      portalTarget.remove();
    },
    [portalTarget],
  );

  return (
    <>
      {active ? <div ref={mountRef} data-workspace-slot="principal" /> : null}
      {createPortal(
        <MissionCommsPage
          missionIdOverride={target.missionId}
          requestedModule={target.requestedModule}
          workspaceRequestKey={target.requestKey}
          workspaceActive={active}
        />,
        portalTarget,
      )}
    </>
  );
}

/**
 * One workspace owner per authenticated principal. Workspace routes attach the
 * stable portal target to the document; ordinary product routes render their
 * existing outlet and park that same target off-document without unmounting
 * drafts or geometry. The principal key above this component is the hard reset
 * boundary for actors, tenants, roles, and capabilities.
 */
export function PrincipalWorkspaceOutlet() {
  const location = useLocation();
  const routeTarget = missionWorkspaceTargetOf(location.pathname, location.search);
  const [remembered, setRemembered] = useState<RememberedMissionWorkspace | null>(null);
  const current: RememberedMissionWorkspace | null = routeTarget
    ? { ...routeTarget, requestKey: location.key }
    : remembered;

  useLayoutEffect(() => {
    if (!routeTarget) return;
    setRemembered({ ...routeTarget, requestKey: location.key });
  }, [location.key, routeTarget?.missionId, routeTarget?.requestedModule]);

  const active = routeTarget !== null;
  return (
    <>
      {current ? (
        <ParkableMissionWorkspace key={current.missionId} target={current} active={active} />
      ) : null}
      {active ? null : <Outlet />}
    </>
  );
}
