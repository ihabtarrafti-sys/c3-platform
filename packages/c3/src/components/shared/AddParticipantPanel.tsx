/**
 * AddParticipantPanel — S29B governed participant addition (full ADR-013).
 *
 * SP DSM: submits an AddMissionParticipant approval (owner approves +
 * executes later — the participant is NOT added optimistically).
 * Mock DSM: direct write via the same governed service contract.
 *
 * Person picker rules:
 *   - excludes currently ACTIVE participants of the mission
 *   - historically removed people remain selectable (execution performs a
 *     governed reactivation of the retained inactive row)
 *   - shows role/team context so the right person is selected
 *
 * Duplicate-pending protection is validated in the submit hook (service
 * flow), not only by UI affordance.
 */

import { useMemo, useState } from 'react';
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  OverlayDrawer,
  Select,
  Textarea,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { usePeople } from '@c3/hooks/usePeople';
import { useSubmitParticipantApproval } from '@c3/hooks/useSubmitParticipantApproval';
import { useToast } from '@c3/hooks/useToast';
import type { MissionParticipant, MissionParticipantRole } from '@c3/types';
import { PARTICIPANT_ROLES, normalizeExternalCode } from '@c3/utils/participantWrites';

interface AddParticipantPanelProps {
  missionId: string;
  missionName: string;
  /** Currently ACTIVE participants — excluded from the picker. */
  activeParticipants: MissionParticipant[];
  open: boolean;
  onDismiss: () => void;
}

export const AddParticipantPanel = ({
  missionId,
  missionName,
  activeParticipants,
  open,
  onDismiss,
}: AddParticipantPanelProps) => {
  const toast = useToast();
  const { data: people = [] } = usePeople();
  const { submitAdd, isPending } = useSubmitParticipantApproval();

  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<MissionParticipantRole>('Player');
  const [externalCode, setExternalCode] = useState('');
  const [perDiem, setPerDiem] = useState('');
  const [reason, setReason] = useState('');

  const activeIds = useMemo(
    () => new Set(activeParticipants.map(p => p.PersonID)),
    [activeParticipants],
  );
  const selectablePeople = useMemo(
    () => people.filter(p => !activeIds.has(p.PersonID)),
    [people, activeIds],
  );

  const reset = () => {
    setPersonId(''); setRole('Player'); setExternalCode(''); setPerDiem(''); setReason('');
  };
  const handleDismiss = () => { reset(); onDismiss(); };

  const perDiemValue = perDiem.trim() === '' ? undefined : Number(perDiem);
  const perDiemInvalid =
    perDiemValue !== undefined && (!Number.isFinite(perDiemValue) || perDiemValue < 0);
  const formValid =
    personId !== '' && normalizeExternalCode(externalCode) !== '' && !perDiemInvalid;

  const handleSubmit = async () => {
    try {
      const outcome = await submitAdd({
        missionId,
        personId,
        externalCode,
        role,
        perDiemRate: perDiemValue,
        reason: reason.trim() || undefined,
      });
      if (outcome.mode === 'approval') {
        toast.success(
          'Participant addition submitted',
          `${outcome.approvalTitle} — awaiting owner approval. The participant is added at execution.`,
        );
      } else {
        toast.success('Participant added', `${personId} → ${missionId} (${outcome.outcome}).`);
      }
      handleDismiss();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to submit participant addition', msg.slice(0, 240));
    }
  };

  return (
    <OverlayDrawer open={open} onOpenChange={(_, data) => { if (!data.open) handleDismiss(); }} position="end" size="medium">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label="Close" icon={<Dismiss24Regular />} onClick={handleDismiss} />}
        >
          Add Participant
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
        <Field label="Mission">
          <Input value={`${missionId} — ${missionName}`} disabled />
        </Field>

        <Field
          label="Person"
          required
          hint="Active participants are excluded. Selecting a previously removed person reactivates their retained record on execution."
        >
          <Select value={personId} onChange={e => setPersonId(e.target.value)}>
            <option value="">Select a person…</option>
            {selectablePeople.map(p => (
              <option key={p.PersonID} value={p.PersonID}>
                {p.FullName} ({p.PersonID}){p.PrimaryRole ? ` · ${p.PrimaryRole}` : ''}{p.CurrentTeam ? ` · ${p.CurrentTeam}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Mission role" required>
          <Select value={role} onChange={e => setRole(e.target.value as MissionParticipantRole)}>
            {PARTICIPANT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>

        <Field label="External code" required hint="Geekay participant code, e.g. RL/PL/030 — Finance/Logistics cross-reference.">
          <Input value={externalCode} onChange={(_, d) => setExternalCode(d.value)} placeholder="RL/PL/030" maxLength={50} />
        </Field>

        <Field
          label="Per diem rate"
          hint="Optional — in the mission's operating currency."
          validationState={perDiemInvalid ? 'error' : 'none'}
          validationMessage={perDiemInvalid ? 'Must be a non-negative number.' : undefined}
        >
          <Input value={perDiem} onChange={(_, d) => setPerDiem(d.value)} placeholder="35" maxLength={10} />
        </Field>

        <Field label="Reason" hint="Optional — shown to the approving owner.">
          <Textarea value={reason} onChange={(_, d) => setReason(d.value)} rows={3} maxLength={500} />
        </Field>
      </DrawerBody>

      <DrawerFooter>
        <Button appearance="primary" disabled={!formValid || isPending} onClick={handleSubmit}>
          {isPending ? 'Submitting…' : 'Submit for approval'}
        </Button>
        <Button appearance="secondary" onClick={handleDismiss} disabled={isPending}>
          Cancel
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
