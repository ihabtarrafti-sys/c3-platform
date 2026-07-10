/**
 * teamOps — S7: the Teams domain use-cases.
 *
 * CRUD + membership are DIRECT-BUT-AUDITED (org structure records facts —
 * the entity-register standing), gated canManageEntities (owner/operations:
 * the org-structure grant). Reads ride the baseline person read — the
 * structure itself carries no money.
 *
 * The money view (per-team P&L + ROI%) is separate and FINANCE-GATED: it
 * aggregates the blended per-mission P&Ls of the missions tagged to the
 * team, honest-null one level up (any unblendable mission = no team total,
 * culprits named). GK-Core's #1 real report, derived — never stored.
 */
import {
  type Actor,
  type Team,
  type TeamCreateInput,
  type TeamFinance,
  type TeamMemberInput,
  type TeamMembership,
  type TeamUpdateInput,
  buildTeamFinance,
  computeMissionPnl,
  ConcurrencyError,
  ConflictError,
  formatTeamId,
  NotFoundError,
  teamCreateInputSchema,
  teamMemberInputSchema,
  teamUpdateInputSchema,
} from '@c3web/domain';
import { assertManageEntities, assertReadPeople, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

// ── reads ────────────────────────────────────────────────────────────────────

export async function listTeams(p: Persistence, actor: Actor): Promise<Team[]> {
  assertReadPeople(actor);
  return p.reads.forActor(actor).listTeams();
}

export async function getTeam(p: Persistence, actor: Actor, teamId: string): Promise<Team> {
  assertReadPeople(actor);
  const team = await p.reads.forActor(actor).getTeamById(teamId);
  if (!team) throw new NotFoundError('Team', teamId);
  return team;
}

export async function listTeamMembers(p: Persistence, actor: Actor, teamId: string): Promise<TeamMembership[]> {
  assertReadPeople(actor);
  await getTeam(p, actor, teamId);
  return p.reads.forActor(actor).listTeamMembers(teamId);
}

export async function listTeamMembershipsForPerson(p: Persistence, actor: Actor, personId: string): Promise<TeamMembership[]> {
  assertReadPeople(actor);
  return p.reads.forActor(actor).listTeamMembershipsForPerson(personId);
}

// ── CRUD (direct-audited) ────────────────────────────────────────────────────

/** Friendly duplicate-code check (the UNIQUE constraint is the last line). */
async function assertTeamCodeAvailable(p: Persistence, actor: Actor, code: string, exceptTeamId?: string): Promise<void> {
  const taken = (await p.reads.forActor(actor).listTeams()).some((t) => t.code === code && t.teamId !== exceptTeamId);
  if (taken) throw new ConflictError('That team code is already in use.', { code });
}

export async function createTeam(p: Persistence, actor: Actor, input: TeamCreateInput): Promise<Team> {
  assertManageEntities(actor);
  const parsed = teamCreateInputSchema.parse(input);
  await assertTeamCodeAvailable(p, actor, parsed.code);

  return p.writes.transaction(actor, async (tx) => {
    const teamId = formatTeamId(await tx.allocateSequence('team'));
    const team = await tx.insertTeam({
      teamId,
      name: parsed.name,
      code: parsed.code,
      kind: parsed.kind,
      gameTitle: parsed.gameTitle,
      notes: parsed.notes,
    });
    await tx.appendAuditEvent({
      entityType: 'Team',
      entityId: teamId,
      action: 'TeamCreated',
      actor: actor.identity,
      before: null,
      after: { teamId, name: parsed.name, code: parsed.code, kind: parsed.kind },
    });
    return team;
  });
}

export async function updateTeam(p: Persistence, actor: Actor, teamId: string, input: TeamUpdateInput): Promise<Team> {
  assertManageEntities(actor);
  const parsed = teamUpdateInputSchema.parse(input);
  await assertTeamCodeAvailable(p, actor, parsed.code, teamId);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getTeam(teamId);
    if (!current) throw new NotFoundError('Team', teamId);

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['name', 'code', 'gameTitle', 'notes'] as const) {
      const next = parsed[key] as unknown;
      const prev = (current as unknown as Record<string, unknown>)[key] ?? null;
      if (next !== prev) {
        patch[key] = next;
        before[key] = prev;
        after[key] = next;
      }
    }
    if (Object.keys(patch).length === 0) return current;

    const updated = await tx.updateTeam(teamId, parsed.expectedVersion, patch);
    if (!updated) throw new ConcurrencyError('Team', teamId);
    await tx.appendAuditEvent({ entityType: 'Team', entityId: teamId, action: 'TeamUpdated', actor: actor.identity, before, after });
    return updated;
  });
}

export async function deactivateTeam(p: Persistence, actor: Actor, teamId: string, expectedVersion: number): Promise<Team> {
  assertManageEntities(actor);
  return p.writes.transaction(actor, async (tx) => {
    const flipped = await tx.deactivateTeam(teamId, expectedVersion);
    if (!flipped) throw new ConcurrencyError('Team', teamId);
    await tx.appendAuditEvent({
      entityType: 'Team',
      entityId: teamId,
      action: 'TeamDeactivated',
      actor: actor.identity,
      before: { isActive: true },
      after: { isActive: false },
    });
    return flipped;
  });
}

export async function reactivateTeam(p: Persistence, actor: Actor, teamId: string, expectedVersion: number): Promise<Team> {
  assertManageEntities(actor);
  return p.writes.transaction(actor, async (tx) => {
    const flipped = await tx.reactivateTeam(teamId, expectedVersion);
    if (!flipped) throw new ConcurrencyError('Team', teamId);
    await tx.appendAuditEvent({
      entityType: 'Team',
      entityId: teamId,
      action: 'TeamReactivated',
      actor: actor.identity,
      before: { isActive: false },
      after: { isActive: true },
    });
    return flipped;
  });
}

// ── membership (the mission-participant reactivation pattern, direct) ───────

export async function addTeamMember(p: Persistence, actor: Actor, teamId: string, input: TeamMemberInput): Promise<TeamMembership> {
  assertManageEntities(actor);
  const parsed = teamMemberInputSchema.parse(input);
  const person = await p.reads.forActor(actor).getPersonById(parsed.personId);
  if (!person) throw new NotFoundError('Person', parsed.personId);

  return p.writes.transaction(actor, async (tx) => {
    const team = await tx.getTeam(teamId);
    if (!team) throw new NotFoundError('Team', teamId);
    if (!team.isActive) throw new ConflictError('This team is deactivated.', { teamId });

    const existing = await tx.getTeamMembership(teamId, parsed.personId);
    if (existing?.isActive) {
      throw new ConflictError(`${existing.personName} is already an active member of this team.`, { teamId, personId: parsed.personId });
    }
    const membership = existing
      ? await tx.reactivateTeamMembership(teamId, parsed.personId, parsed.role)
      : await tx.insertTeamMembership(teamId, parsed.personId, parsed.role);
    if (!membership) throw new ConcurrencyError('Team membership', `${teamId}/${parsed.personId}`);

    await tx.appendAuditEvent({
      entityType: 'Team',
      entityId: teamId,
      action: 'TeamMemberAdded',
      actor: actor.identity,
      before: existing ? { personId: parsed.personId, isActive: false } : null,
      after: { personId: parsed.personId, personName: membership.personName, role: parsed.role },
    });
    return membership;
  });
}

export async function removeTeamMember(p: Persistence, actor: Actor, teamId: string, personId: string): Promise<TeamMembership> {
  assertManageEntities(actor);
  return p.writes.transaction(actor, async (tx) => {
    const removed = await tx.deactivateTeamMembership(teamId, personId);
    if (!removed) throw new NotFoundError('Active team membership', `${teamId}/${personId}`);
    await tx.appendAuditEvent({
      entityType: 'Team',
      entityId: teamId,
      action: 'TeamMemberRemoved',
      actor: actor.identity,
      before: { personId, isActive: true },
      after: { personId, isActive: false },
    });
    return removed;
  });
}

// ── the money view (finance-gated; derived, never stored) ────────────────────

export async function getTeamFinance(p: Persistence, actor: Actor, teamId: string): Promise<TeamFinance> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const team = await reads.getTeamById(teamId);
  if (!team) throw new NotFoundError('Team', teamId);

  const [missions, allLines, allBudgets, rates] = await Promise.all([
    reads.listMissions(),
    reads.listAllMissionLines(),
    reads.listAllMissionBudgets(),
    reads.listFxRates(),
  ]);

  // Same read shape as the finance dashboard: lines-only blending (per-diem
  // roll-in lives on each mission's own page; the summary is honest + cheap).
  const rows = missions
    .filter((m) => m.teamId === teamId)
    .map((m) => {
      const pnl = computeMissionPnl({
        startsOn: m.startsOn,
        endsOn: m.endsOn,
        lines: allLines.filter((l) => l.missionId === m.missionId),
        budgets: allBudgets.filter((b) => b.missionId === m.missionId),
        participants: [],
        rates,
      });
      return {
        missionId: m.missionId,
        name: m.name,
        code: m.code,
        financeStage: m.financeStage,
        isActive: m.isActive,
        blended: pnl.blended,
        missingRates: pnl.missingRates,
      };
    });

  return buildTeamFinance(rows);
}
