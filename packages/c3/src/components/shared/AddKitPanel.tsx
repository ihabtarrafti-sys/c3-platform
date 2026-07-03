/**
 * AddKitPanel — S29A (ADR-013 Addendum: Mission Kit Logistics Exemption).
 *
 * Role-gated kit assignment creation drawer (owner/operations — the caller
 * gates visibility; the service is the authority; SharePoint ACLs are the
 * security boundary).
 *
 * Initial KitStatus is ALWAYS 'NotOrdered' — there is no status field here.
 * The actor identity is stamped inside useCreateKitAssignment from the
 * authenticated AppContext user; this form never collects it.
 *
 * Errors surface via toast — no silent failures. Duplicate keys, inactive
 * participants, and permission failures all arrive as domain errors from the
 * service layer.
 */

import { useState } from 'react';
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
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { useApp } from '@c3/hooks/useApp';
import { useCreateKitAssignment } from '@c3/hooks/useCreateKitAssignment';
import { useToast } from '@c3/hooks/useToast';
import type { ItemCategory } from '@c3/types';
import { ITEM_CATEGORIES } from '@c3/types';
import { normalizeAssignmentKey } from '@c3/utils/kitLifecycle';

interface AddKitPanelProps {
  missionId: string;
  personId: string;
  personName: string;
  open: boolean;
  onDismiss: () => void;
}

export const AddKitPanel = ({ missionId, personId, personName, open, onDismiss }: AddKitPanelProps) => {
  const toast = useToast();
  const { currentUser } = useApp();
  const createKit = useCreateKitAssignment();

  const [category, setCategory] = useState<ItemCategory>('Jersey');
  const [assignmentKey, setAssignmentKey] = useState('');
  const [description, setDescription] = useState('');
  const [jerseyNumber, setJerseyNumber] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  const reset = () => {
    setCategory('Jersey');
    setAssignmentKey('');
    setDescription('');
    setJerseyNumber('');
    setOwnerEmail('');
  };

  const handleDismiss = () => {
    reset();
    onDismiss();
  };

  const keyValid = normalizeAssignmentKey(assignmentKey) !== '';

  const handleSubmit = async () => {
    try {
      const created = await createKit.mutateAsync({
        MissionID: missionId,
        PersonID: personId,
        ItemCategory: category,
        AssignmentKey: assignmentKey,
        ItemDescription: description.trim() || undefined,
        JerseyNumber: jerseyNumber.trim() || undefined,
        OwnerEmail: ownerEmail.trim() || undefined,
      });
      toast.success(
        'Kit item added',
        `${created.ItemCategory} ${created.AssignmentKey} for ${personName} — status NotOrdered.`,
      );
      handleDismiss();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to add kit item', msg.slice(0, 240));
    }
  };

  return (
    <OverlayDrawer open={open} onOpenChange={(_, data) => { if (!data.open) handleDismiss(); }} position="end" size="medium">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label="Close" icon={<Dismiss24Regular />} onClick={handleDismiss} />}
        >
          Add Kit Item
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
        <Field label="Participant">
          <Input value={`${personName} (${personId}) — ${missionId}`} disabled />
        </Field>

        <Field label="Item category" required>
          <Select value={category} onChange={e => setCategory(e.target.value as ItemCategory)}>
            {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>

        <Field
          label="Assignment key"
          required
          hint="Stable key within this person/mission/category — e.g. HOME-2026, AWAY-2026, CONTROLLER-01. Cannot be changed later."
          validationState={assignmentKey !== '' && !keyValid ? 'error' : 'none'}
        >
          <Input value={assignmentKey} onChange={(_, d) => setAssignmentKey(d.value)} placeholder="HOME-2026" maxLength={100} />
        </Field>

        <Field label="Description" hint="Editable display text — not identity.">
          <Input value={description} onChange={(_, d) => setDescription(d.value)} placeholder="Home jersey 2026" maxLength={255} />
        </Field>

        <Field label="Jersey number" hint="Optional — mission-specific.">
          <Input value={jerseyNumber} onChange={(_, d) => setJerseyNumber(d.value)} placeholder="7" maxLength={10} />
        </Field>

        <Field label="Fulfillment owner email" hint={`Defaults to you (${currentUser.email}).`}>
          <Input value={ownerEmail} onChange={(_, d) => setOwnerEmail(d.value)} placeholder={currentUser.email} maxLength={255} />
        </Field>
      </DrawerBody>

      <DrawerFooter>
        <Button
          appearance="primary"
          disabled={!keyValid || createKit.isPending}
          onClick={handleSubmit}
        >
          {createKit.isPending ? 'Adding…' : 'Add kit item'}
        </Button>
        <Button appearance="secondary" onClick={handleDismiss} disabled={createKit.isPending}>
          Cancel
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
