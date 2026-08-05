import { createElement } from 'react';
import { useSession } from './session';
import { PrincipalWorkspaceOutlet } from './tablework/WorkspaceOSHost';

export type PrincipalSessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'unprovisioned';

export interface PrincipalDataActor<TCapabilities extends object = Record<string, unknown>> {
  readonly userId: string;
  readonly tenantSlug: string;
  readonly role: string;
  readonly capabilities: TCapabilities;
}

/**
 * The in-memory ownership key for every actor-bound browser resource.
 *
 * This value is used only as a React key. It is never persisted, placed in a
 * URL, or rendered. Sorting the capability entries means a server-side role or
 * capability change deterministically remounts the data subtree even when the
 * actor and tenant stay the same, without teaching this client a second list of
 * capability names that could drift from /me.
 */
export function principalDataScopeOf<TCapabilities extends object>(
  status: PrincipalSessionStatus,
  me: PrincipalDataActor<TCapabilities> | null,
): string {
  if (status !== 'authenticated' || !me) return JSON.stringify([status]);

  const capabilities = Object.entries(me.capabilities).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  return JSON.stringify(['authenticated', me.userId, me.tenantSlug, me.role, capabilities]);
}

function PrincipalRouteOutlet() {
  return createElement(PrincipalWorkspaceOutlet);
}

/**
 * Keyed boundary for authenticated product routes. The router lane mounts this
 * above product children while leaving /auth/callback and public intake as
 * siblings, so drafts, streams, and workspace state reset with the principal
 * without replaying callback effects by remounting RouterProvider itself.
 */
export function PrincipalRouteBoundary() {
  const { status, me } = useSession();
  return createElement(PrincipalRouteOutlet, { key: principalDataScopeOf(status, me) });
}
