import type { Actor } from '@c3web/domain';
import type { AuthenticatedPrincipal } from './auth/types';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated principal (set by the auth hook on protected routes). */
    principal?: AuthenticatedPrincipal;
    /** The tenant-scoped actor derived from the principal. */
    actor?: Actor;
  }
}
