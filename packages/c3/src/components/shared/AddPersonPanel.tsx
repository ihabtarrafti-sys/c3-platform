/**
 * AddPersonPanel -- C3 Design System v1.0
 *
 * Governed panel for creating a new person in C3.
 *
 * Submission model (ADR-013):
 *   Mock DSM: creates the person directly in the mock store.
 *             Button: "Add Person". Toast: "Person added."
 *   SP DSM:   submits a C3Approvals record (OperationType: AddPerson).
 *             No C3People row is created at submission time.
 *             Button: "Submit for Approval". Toast: "Person creation request submitted (APR-XXXX)."
 *             The person is not visible in C3 until an owner approves and executes the request.
 *
 * Required field: Full Name.
 * Optional fields: IGN, Primary Role, Personnel Code, Nationality, Current Team,
 *                  Current Game Title, Primary Department, Notes.
 *
 * No email field -- Email is not in the current C3People SP list schema (TD-24).
 * No induction, credential, mission, or finance fields -- out of scope for AddPerson.
 *
 * Constraints:
 *   - No direct SP write from this component. Submission routes through
 *     useSubmitAddPersonApproval which enforces the ADR-013 approval gate.
 *   - FullName must not be blank (enforced client-side).
 *   - Duplicate detection: the hook checks by FullName against the cached People
 *     list before SP submission.
 *
 * Sprint 25.
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { useState } from 'react';
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Input,
  MessageBar,
  MessageBarBody,
  OverlayDrawer,
  Textarea,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { FormField } from '@c3/components/ui';
import { useApp } from '@c3/hooks/useApp';
import { useSubmitAddPersonApproval } from '@c3/hooks/useSubmitAddPersonApproval';
import { useToast } from '@c3/hooks/useToast';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddPersonPanelProps {
  /** Controls panel visibility. */
  open: boolean;
  /** Called when the panel is closed (X, Cancel, or success). */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AddPersonPanel = ({ open, onDismiss }: AddPersonPanelProps) => {
  const { config } = useApp();
  const { submitAsync, isPending } = useSubmitAddPersonApproval();
  const toast = useToast();

  const isSPMode = config.dataSourceMode === 'sharepoint';

  // -- Form state --
  const [fullName,          setFullName]          = useState('');
  const [ign,               setIgn]               = useState('');
  const [primaryRole,       setPrimaryRole]       = useState('');
  const [personnelCode,     setPersonnelCode]     = useState('');
  const [nationality,       setNationality]       = useState('');
  const [currentTeam,       setCurrentTeam]       = useState('');
  const [currentGameTitle,  setCurrentGameTitle]  = useState('');
  const [primaryDepartment, setPrimaryDepartment] = useState('');
  const [notes,             setNotes]             = useState('');

  const [error, setError] = useState<string | null>(null);

  // -- Validation --
  const isValid = fullName.trim().length > 0;

  // -- Reset --
  const resetForm = () => {
    setFullName('');
    setIgn('');
    setPrimaryRole('');
    setPersonnelCode('');
    setNationality('');
    setCurrentTeam('');
    setCurrentGameTitle('');
    setPrimaryDepartment('');
    setNotes('');
    setError(null);
  };

  const handleDismiss = () => {
    resetForm();
    onDismiss();
  };

  // -- Submit --
  const handleSubmit = async () => {
    if (!isValid) return;
    setError(null);

    try {
      const outcome = await submitAsync({
        FullName:          fullName.trim(),
        IGN:               ign.trim()               || undefined,
        PrimaryRole:       primaryRole.trim()       || undefined,
        PersonnelCode:     personnelCode.trim()     || undefined,
        Nationality:       nationality.trim()        || undefined,
        CurrentTeam:       currentTeam.trim()       || undefined,
        CurrentGameTitle:  currentGameTitle.trim()  || undefined,
        PrimaryDepartment: primaryDepartment.trim() || undefined,
        Notes:             notes.trim()             || undefined,
      });

      if (outcome.mode === 'direct') {
        toast.success('Person added', `${outcome.person.FullName} (${outcome.person.PersonID})`);
      } else {
        toast.success(
          'Person creation submitted',
          `Approval ${outcome.approvalTitle} submitted. The person will appear in C3 once an owner approves and executes the request.`,
        );
      }

      resetForm();
      onDismiss();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  // -- Title and button text --
  const panelTitle  = isSPMode ? 'Submit Person Creation Request' : 'Add Person';
  const submitLabel = isSPMode ? 'Submit for Approval' : 'Add Person';

  return (
    <OverlayDrawer
      position="end"
      size="medium"
      open={open}
      onOpenChange={(_, { open: isOpen }) => { if (!isOpen) handleDismiss(); }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Close"
              icon={<Dismiss24Regular />}
              onClick={handleDismiss}
            />
          }
        >
          {panelTitle}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
        {/* SP mode guidance */}
        {isSPMode && (
          <MessageBar intent="info">
            <MessageBarBody>
              This person will not appear in C3 until an owner approves and executes the request.
              Approval may take time.
            </MessageBarBody>
          </MessageBar>
        )}

        {/* Full Name -- required */}
        <FormField label="Full Name" required>
          <Input
            id="add-person-full-name"
            placeholder="e.g. Jane Smith"
            value={fullName}
            onChange={(_, d) => setFullName(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* IGN */}
        <FormField label="IGN / Alias">
          <Input
            id="add-person-ign"
            placeholder="e.g. Phantom"
            value={ign}
            onChange={(_, d) => setIgn(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Primary Role */}
        <FormField label="Primary Role">
          <Input
            id="add-person-role"
            placeholder="e.g. Player, Coach, Analyst"
            value={primaryRole}
            onChange={(_, d) => setPrimaryRole(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Personnel Code */}
        <FormField
          label="Personnel Code"
          hint="Internal HR reference code (e.g. FN/PL/001). Used for contract linking. Leave blank if not yet assigned."
        >
          <Input
            id="add-person-personnel-code"
            placeholder="e.g. FN/PL/001"
            value={personnelCode}
            onChange={(_, d) => setPersonnelCode(d.value)}
            disabled={isPending}
            style={{ fontFamily: 'monospace' }}
          />
        </FormField>

        {/* Nationality */}
        <FormField label="Nationality">
          <Input
            id="add-person-nationality"
            placeholder="e.g. Saudi Arabia"
            value={nationality}
            onChange={(_, d) => setNationality(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Current Team */}
        <FormField label="Current Team">
          <Input
            id="add-person-team"
            placeholder="e.g. GKE Fortnite"
            value={currentTeam}
            onChange={(_, d) => setCurrentTeam(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Current Game Title */}
        <FormField label="Current Game Title">
          <Input
            id="add-person-game"
            placeholder="e.g. Fortnite"
            value={currentGameTitle}
            onChange={(_, d) => setCurrentGameTitle(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Primary Department */}
        <FormField label="Primary Department">
          <Input
            id="add-person-department"
            placeholder="e.g. Esports, Creative"
            value={primaryDepartment}
            onChange={(_, d) => setPrimaryDepartment(d.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Notes / Reason */}
        <FormField label={isSPMode ? 'Reason / Notes' : 'Notes'}>
          <Textarea
            id="add-person-notes"
            placeholder={isSPMode ? 'Reason for creating this person record' : 'Optional notes'}
            value={notes}
            onChange={(_, d) => setNotes(d.value)}
            disabled={isPending}
            rows={3}
          />
        </FormField>

        {/* Error */}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
      </DrawerBody>

      <DrawerFooter style={{ display: 'flex', gap: 'var(--c3-space-2)' }}>
        <Button
          appearance="primary"
          disabled={!isValid || isPending}
          onClick={() => { void handleSubmit(); }}
        >
          {isPending ? 'Submitting...' : submitLabel}
        </Button>
        <Button appearance="secondary" disabled={isPending} onClick={handleDismiss}>
          Cancel
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
