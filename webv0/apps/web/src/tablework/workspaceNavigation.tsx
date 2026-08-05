import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { workspaceHrefFor } from './workspaceRoutes';

export { workspaceHrefFor } from './workspaceRoutes';

interface WorkspaceNavigationValue {
  readonly workspaceMissionId: string | null;
  readonly hrefFor: (destination: string) => string;
}

const DEFAULT_WORKSPACE_NAVIGATION: WorkspaceNavigationValue = {
  workspaceMissionId: null,
  hrefFor: (destination) => destination,
};

const WorkspaceNavigationContext = createContext<WorkspaceNavigationValue>(DEFAULT_WORKSPACE_NAVIGATION);

export function WorkspaceNavigationProvider({
  missionId,
  children,
}: {
  readonly missionId: string | null;
  readonly children: ReactNode;
}) {
  const value = useMemo<WorkspaceNavigationValue>(
    () => ({
      workspaceMissionId: missionId,
      hrefFor: (destination) => workspaceHrefFor(destination, missionId),
    }),
    [missionId],
  );

  return <WorkspaceNavigationContext.Provider value={value}>{children}</WorkspaceNavigationContext.Provider>;
}

export function useWorkspaceNavigation(): WorkspaceNavigationValue {
  return useContext(WorkspaceNavigationContext);
}

export function useWorkspaceHref(destination: string): string {
  return useWorkspaceNavigation().hrefFor(destination);
}
