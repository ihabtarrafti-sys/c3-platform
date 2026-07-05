/**
 * ApparelProfilePanel — S29A (role-gated master-data update: owner /
 * operations / hr, per the ADR-013 Addendum — Mission Kit Logistics
 * Exemption).
 *
 * Upsert semantics: creates the profile when none exists, updates the exact
 * active row otherwise (ETag concurrency in the service). SP version history
 * is the authoritative audit; the Notes field is user content only.
 *
 * Actor identity is stamped inside useUpsertApparelProfile from the
 * authenticated AppContext user.
 */

import { useEffect, useState } from 'react';
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

import { useToast } from '@c3/hooks/useToast';
import { useDeferredMount } from '@c3/hooks/useDeferredMount';
import { useUpsertApparelProfile } from '@c3/hooks/useUpsertApparelProfile';
import type { ApparelProfile, JerseySize } from '@c3/types';
import { JERSEY_SIZES } from '@c3/types';
import { NAME_ON_JERSEY_MAX_LENGTH } from '@c3/utils/kitLifecycle';

interface ApparelProfilePanelProps {
  personId: string;
  personName: string;
  /** null = no profile on file (panel creates); object = editing existing. */
  existing: ApparelProfile | null;
  open: boolean;
  onDismiss: () => void;
}

export const ApparelProfilePanel = ({ personId, personName, existing, open, onDismiss }: ApparelProfilePanelProps) => {
  const toast = useToast();
  const upsert = useUpsertApparelProfile();

  const [jerseySize, setJerseySize] = useState<JerseySize | ''>('');
  const [nameOnJersey, setNameOnJersey] = useState('');
  const [notes, setNotes] = useState('');

  // Re-seed form state whenever the drawer opens for a (possibly different) profile.
  useEffect(() => {
    if (open) {
      setJerseySize(existing?.JerseySize ?? '');
      setNameOnJersey(existing?.NameOnJersey ?? '');
      setNotes(existing?.Notes ?? '');
    }
  }, [open, existing]);

  const nameTooLong = nameOnJersey.trim().length > NAME_ON_JERSEY_MAX_LENGTH;

  const handleSubmit = async () => {
    try {
      await upsert.mutateAsync({
        PersonID: personId,
        JerseySize: jerseySize === '' ? undefined : jerseySize,
        NameOnJersey: nameOnJersey.trim() || undefined,
        Notes: notes.trim() || undefined,
      });
      toast.success(
        existing ? 'Apparel profile updated' : 'Apparel profile created',
        `${personName} (${personId})`,
      );
      onDismiss();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to save apparel profile', msg.slice(0, 240));
    }
  };

  // TD-33: defer mounting the overlay until first opened (cold-render modalizer guard).
  const shouldMount = useDeferredMount(open);
  if (!shouldMount) return null;

  return (
    <OverlayDrawer open={open} onOpenChange={(_, data) => { if (!data.open) onDismiss(); }} position="end" size="medium">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label="Close" icon={<Dismiss24Regular />} onClick={onDismiss} />}
        >
          {existing ? 'Edit Apparel Profile' : 'Add Apparel Profile'}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
        <Field label="Person">
          <Input value={`${personName} (${personId})`} disabled />
        </Field>

        <Field label="Jersey size">
          <Select value={jerseySize} onChange={e => setJerseySize(e.target.value as JerseySize | '')}>
            <option value="">(not set)</option>
            {JERSEY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>

        <Field
          label="Name on jersey"
          hint={`Print name — max ${NAME_ON_JERSEY_MAX_LENGTH} characters.`}
          validationState={nameTooLong ? 'error' : 'none'}
          validationMessage={nameTooLong ? `Maximum ${NAME_ON_JERSEY_MAX_LENGTH} characters.` : undefined}
        >
          <Input value={nameOnJersey} onChange={(_, d) => setNameOnJersey(d.value)} placeholder="ABDULAZIZ" maxLength={60} />
        </Field>

        <Field label="Notes" hint="Fit/preference notes — user content, never system audit text.">
          <Textarea value={notes} onChange={(_, d) => setNotes(d.value)} rows={4} maxLength={1000} />
        </Field>
      </DrawerBody>

      <DrawerFooter>
        <Button appearance="primary" disabled={nameTooLong || upsert.isPending} onClick={handleSubmit}>
          {upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create profile'}
        </Button>
        <Button appearance="secondary" onClick={onDismiss} disabled={upsert.isPending}>
          Cancel
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
