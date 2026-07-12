/**
 * recycleBinOps — Track B2: the Recycle Bin.
 *
 * A cross-domain register of everything soft-removed, and a Restore that goes
 * through each domain's OWN governance class — never a backdoor. The read is
 * owner/operations only (lifecycle is their console); each restore path
 * re-asserts its own class-specific gate underneath.
 */
import {
  type Actor,
  type RecycleItem,
  type RestoreRecycleInput,
  ValidationError,
  restoreRecycleInputSchema,
} from '@c3web/domain';
import { assertManageEntities } from '@c3web/authz';
import type { Persistence } from '../ports';
import { reactivateEntity } from './entityOps';
import { reactivateTeam } from './teamOps';
import { reactivateKit, reactivateApparel } from './equipmentOps';
import { submitReactivatePerson } from './submitPersonOps';
import { submitReactivateCredential } from './submitCredentialOps';

export async function listRecycleBin(p: Persistence, actor: Actor): Promise<RecycleItem[]> {
  assertManageEntities(actor); // owner/operations — the lifecycle console
  return p.reads.forActor(actor).listRecycleBin();
}

export interface RestoreResult {
  readonly outcome: 'restored' | 'approval-submitted';
  readonly kind: RestoreRecycleInput['kind'];
  readonly id: string;
  /** Present when a governed restore submitted an approval instead of restoring now. */
  readonly approvalId: string | null;
}

/**
 * Restore one record. The dispatch preserves governance symmetry — each kind is
 * restored through its OWN class, never a backdoor:
 *   - GOVERNED (submits an approval): person → ReactivatePerson,
 *     credential → ReactivateCredential (both deactivate through the pipeline);
 *   - DIRECT (flips immediately, audited): entity, team, kit, apparel.
 * All six v1 recycle kinds now have a real door (HARDEN-3 owner ruling #1).
 */
export async function restoreRecord(p: Persistence, actor: Actor, input: RestoreRecycleInput): Promise<RestoreResult> {
  const parsed = restoreRecycleInputSchema.parse(input);

  switch (parsed.kind) {
    case 'person': {
      const reason = parsed.reason?.trim();
      if (!reason) throw new ValidationError('A reason is required to restore a person.', { field: 'reason' });
      const approval = await submitReactivatePerson(p, actor, { input: { personId: parsed.id, reason }, reason });
      return { outcome: 'approval-submitted', kind: 'person', id: parsed.id, approvalId: approval.approvalId };
    }
    case 'entity': {
      const restored = await reactivateEntity(p, actor, parsed.id, parsed.expectedVersion);
      return { outcome: 'restored', kind: 'entity', id: restored.entityId, approvalId: null };
    }
    case 'team': {
      const restored = await reactivateTeam(p, actor, parsed.id, parsed.expectedVersion);
      return { outcome: 'restored', kind: 'team', id: restored.teamId, approvalId: null };
    }
    // HARDEN-3 (owner ruling #1): the finished high-value doors. Credential
    // deactivation is GOVERNED, so its restore SUBMITS a ReactivateCredential
    // approval (reason required); kit/apparel are direct-audited, so they flip now.
    case 'credential': {
      const reason = parsed.reason?.trim();
      if (!reason) throw new ValidationError('A reason is required to restore a credential.', { field: 'reason' });
      const approval = await submitReactivateCredential(p, actor, { input: { credentialId: parsed.id, reason }, reason });
      return { outcome: 'approval-submitted', kind: 'credential', id: parsed.id, approvalId: approval.approvalId };
    }
    case 'kit': {
      const restored = await reactivateKit(p, actor, parsed.id, parsed.expectedVersion);
      return { outcome: 'restored', kind: 'kit', id: restored.kitId, approvalId: null };
    }
    case 'apparel': {
      const restored = await reactivateApparel(p, actor, parsed.id, parsed.expectedVersion);
      return { outcome: 'restored', kind: 'apparel', id: restored.apparelId, approvalId: null };
    }
    default:
      throw new ValidationError(`${parsed.kind} records are restored from their own page, not the recycle bin.`, {
        kind: parsed.kind,
      });
  }
}
