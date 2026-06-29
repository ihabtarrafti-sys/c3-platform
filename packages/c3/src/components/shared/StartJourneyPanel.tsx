/**
 * StartJourneyPanel — C3 Design System v1.0
 *
 * Slide-in panel for initiating an Onboarding Journey for a person.
 * Establishes the write pattern for Journey operations, parallel to
 * CreateAmendmentPanel for Amendment operations.
 *
 * Behaviour:
 *   - Opens as an OverlayDrawer from the right edge
 *   - Two required fields: Assigned Owner, Initiation Reason
 *   - One optional field: Notes
 *   - Optional per-obligation assignment section (Sprint 9, S9-2)
 *   - Optional mission context band (Sprint 10, M10-4)
 *   - Submit disabled until required fields are filled
 *   - On success: dismiss panel + success toast + invalidate journey queries
 *   - On error: error toast, panel stays open for correction
 *   - Form resets when the panel is dismissed
 *
 * Sprint 9 (S9-2): When open obligations are passed via the `obligations` prop,
 * the panel renders a per-obligation assignment section below the main fields.
 * Each obligation input is pre-filled from its protocol `suggestedOwner`.
 * Gaps with an assignment submitted here will show as Covered in the Situation
 * Room immediately after the journey is started.
 *
 * Sprint 10 (M10-4): When `missionContext` is provided, the panel shows a
 * mission context band at the top of the form body, making it clear to the
 * operator why this journey is being opened. The resulting Journey carries
 * MissionID for audit trail and future Mission timeline views.
 *
 * Journey Type is fixed to 'Onboarding' for this sprint.
 * InitiatedBy is set automatically from currentUser.displayName.
 *
 * Layer: Shared (components/shared) — imports domain types and hooks.
 */

import { useEffect, useState } from 'react';
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Input,
  OverlayDrawer,
  Text,
  Textarea,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { FormField } from '@c3/components/ui';
import { useApp } from '@c3/hooks/useApp';
import { useSubmitJourneyApproval } from '@c3/hooks/useSubmitJourneyApproval';
import { useToast } from '@c3/hooks/useToast';
import type { CredentialCapability, ObligationAssignment } from '@c3/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single open obligation passed from the parent for assignment.
 *
 * These map directly to the protocol-computed obligations that are not yet
 * Satisfied. The `suggestedOwner` comes from `obligation.defaultOwner` and
 * pre-fills the assignment input in the panel.
 */
export interface ObligationForAssignment {
  /** Matches Journey.obligationAssignments[].obligationType */
  capability: CredentialCapability;
  /** Human-readable label shown in the UI */
  requirement: string;
  /** Pre-filled from protocol's defaultOwner */
  suggestedOwner?: string;
}

/**
 * Mission context passed when the panel is launched from a Mission-scoped gap.
 * Used to display a context band and tag the resulting Journey with MissionID.
 * Sprint 10 (M10-4).
 */
export interface MissionPanelContext {
  missionId: string;
  missionName: string;
}

export interface StartJourneyPanelProps {
  /** PersonID of the person this journey belongs to. */
  personId: string;
  /** Full name shown in the panel header. */
  personName: string;
  /** Controls panel visibility. */
  open: boolean;
  /** Called when the user closes the panel (X button, Cancel, or backdrop). */
  onDismiss: () => void;
  /**
   * Open obligations from the onboarding protocol evaluation.
   *
   * When provided, the panel renders a per-obligation assignment section
   * below the main fields. The operator can assign an owner to each obligation
   * individually. Assignments submitted here result in Covered gaps in the
   * Situation Room. Obligations left blank remain Routed.
   *
   * Sprint 9 (S9-2). Omit or leave undefined to suppress the section.
   */
  obligations?: ObligationForAssignment[];
  /**
   * Mission context when the panel is launched from a Mission-scoped gap.
   *
   * When provided, a context band is displayed at the top of the form body
   * and the resulting Journey is tagged with MissionID. This preserves the
   * audit trail of why the Journey was opened.
   *
   * Sprint 10 (M10-4). Omit or leave undefined when not in mission context.
   */
  missionContext?: MissionPanelContext;
}

// ---------------------------------------------------------------------------
// MissionContextBand
// ---------------------------------------------------------------------------

const MissionContextBand = ({ ctx }: { ctx: MissionPanelContext }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--c3-space-3)',
      padding: 'var(--c3-space-3) var(--c3-space-4)',
      borderRadius: 'var(--c3-radius-md)',
      border: '1px solid var(--c3-brand-20)',
      background: 'var(--c3-brand-10)',
    }}
  >
    <div
      style={{
        width: 3,
        alignSelf: 'stretch',
        borderRadius: 2,
        background: 'var(--c3-brand-60)',
        flexShrink: 0,
      }}
    />
    <div>
      <Text size={200} weight="semibold" style={{ display: 'block', color: 'var(--c3-brand-70)' }}>
        Mission context
      </Text>
      <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-700)', marginTop: 2 }}>
        {ctx.missionName}
      </Text>
      <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)', marginTop: 1 }}>
        {ctx.missionId} · This journey will be linked to this mission.
      </Text>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StartJourneyPanel = ({
  personId,
  personName,
  open,
  onDismiss,
  obligations,
  missionContext,
}: StartJourneyPanelProps) => {
  const { currentUser, config } = useApp();
  const { submitAsync, isPending } = useSubmitJourneyApproval();
  const toast = useToast();
  const isSpMode = config.dataSourceMode === 'sharepoint';

  // ── Main form state ───────────────────────────────────────────────────────
  const [assignedTo,       setAssignedTo]       = useState('');
  const [initiationReason, setInitiationReason] = useState('');
  const [notes,            setNotes]            = useState('');

  // ── Per-obligation owners (S9-2) ──────────────────────────────────────────
  // Keyed by CredentialCapability string. Pre-filled from suggestedOwner when
  // the panel opens; operator may override each independently or leave blank.
  const [obligationOwners, setObligationOwners] = useState<Record<string, string>>({});

  // Pre-fill obligation owners from suggestedOwner whenever the panel opens
  // or the obligation set changes (e.g. evaluation loaded after panel opens).
  useEffect(() => {
    if (!open || !obligations?.length) return;
    const initial: Record<string, string> = {};
    for (const obl of obligations) {
      initial[obl.capability] = obl.suggestedOwner ?? '';
    }
    setObligationOwners(initial);
  }, [open, obligations]);

  const isValid =
    assignedTo.trim().length > 0 &&
    initiationReason.trim().length > 0;

  const resetForm = () => {
    setAssignedTo('');
    setInitiationReason('');
    setNotes('');
    setObligationOwners({});
  };

  const handleDismiss = () => {
    resetForm();
    onDismiss();
  };

  const handleObligationOwnerChange = (capability: string, value: string) => {
    setObligationOwners(prev => ({ ...prev, [capability]: value }));
  };

  const handleSubmit = async () => {
    // Collect obligation assignments — only those where the operator entered a value.
    const obligationAssignments: ObligationAssignment[] = (obligations ?? [])
      .filter(obl => (obligationOwners[obl.capability] ?? '').trim().length > 0)
      .map(obl => ({
        obligationType: obl.capability,
        requirement:    obl.requirement,
        assignedTo:     (obligationOwners[obl.capability] ?? '').trim(),
        assignedAt:     new Date().toISOString(),
      }));

    try {
      const outcome = await submitAsync({
        personId:          personId,
        journeyType:       'Onboarding',
        initiationReason:  initiationReason.trim(),
        assignedTo:        assignedTo.trim(),
        notes:             notes.trim() || undefined,
        missionId:         missionContext?.missionId,
        obligationAssignments,
      });

      if (outcome.mode === 'direct') {
        // Mock / dev path — journey created immediately.
        const coveredCount = obligationAssignments.length;
        const missionSuffix = missionContext ? ` — linked to ${missionContext.missionId}` : '';
        const detail = coveredCount > 0
          ? `Journey opened and ${coveredCount} obligation${coveredCount === 1 ? '' : 's'} assigned.${missionSuffix}`
          : `Journey opened for ${personName} and assigned to ${assignedTo.trim()}.${missionSuffix}`;
        toast.success('Onboarding journey started', detail);
      } else {
        // SharePoint approval path — no journey created yet.
        toast.success(
          'Approval submitted',
          `Journey request for ${personName} is pending Platform Owner review. Ref: ${outcome.approvalTitle}`,
        );
      }

      handleDismiss();
    } catch {
      toast.error(
        isSpMode ? 'Failed to submit approval' : 'Failed to start journey',
        'Please try again or contact support.',
      );
    }
  };

  const hasObligations = (obligations?.length ?? 0) > 0;

  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, { open: isOpen }) => {
        if (!isOpen) handleDismiss();
      }}
      position="end"
      size="medium"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              icon={<Dismiss24Regular />}
              onClick={handleDismiss}
              aria-label="Close panel"
            />
          }
        >
          Start Onboarding Journey · {personName}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--c3-space-5)',
            paddingTop: 'var(--c3-space-5)',
          }}
        >
          {/* ── Mission context band (M10-4) ─────────────────────────────── */}
          {missionContext && <MissionContextBand ctx={missionContext} />}

          <FormField
            label="Assigned Owner"
            required
            htmlFor="sjp-assigned-to"
            hint="The person responsible for tracking this journey to completion."
          >
            <Input
              id="sjp-assigned-to"
              value={assignedTo}
              onChange={(_, data) => setAssignedTo(data.value)}
              placeholder="e.g. ops.coordinator@geekay.gg"
            />
          </FormField>

          <FormField
            label="Initiation Reason"
            required
            htmlFor="sjp-initiation-reason"
            hint="Why this journey is being opened."
          >
            <Input
              id="sjp-initiation-reason"
              value={initiationReason}
              onChange={(_, data) => setInitiationReason(data.value)}
              placeholder="e.g. New signing — 2026/27 season"
            />
          </FormField>

          <FormField
            label="Notes"
            htmlFor="sjp-notes"
            hint="Any additional context for operational records."
          >
            <Textarea
              id="sjp-notes"
              value={notes}
              onChange={(_, data) => setNotes(data.value)}
              rows={4}
              placeholder="Optional notes…"
              resize="vertical"
            />
          </FormField>

          {/* ── Obligation Assignments (S9-2) ───────────────────────────── */}
          {hasObligations && (
            <>
              <div
                style={{
                  height: 1,
                  backgroundColor: 'var(--c3-gray-200)',
                  marginTop: 'var(--c3-space-1)',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
                <Text weight="semibold" style={{ color: 'var(--c3-gray-900)' }}>
                  Obligation Assignments
                </Text>
                <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                  Assign each open requirement to its responsible person or team.
                  Gaps with an assignment will show as Covered in the Situation Room.
                  Leave blank to leave the gap Routed.
                </Text>
              </div>

              {obligations!.map(obl => (
                <FormField
                  key={obl.capability}
                  label={obl.requirement}
                  htmlFor={`sjp-obl-${obl.capability}`}
                  hint={obl.suggestedOwner ? `Suggested by protocol: ${obl.suggestedOwner}` : undefined}
                >
                  <Input
                    id={`sjp-obl-${obl.capability}`}
                    value={obligationOwners[obl.capability] ?? ''}
                    onChange={(_, data) =>
                      handleObligationOwnerChange(obl.capability, data.value)
                    }
                    placeholder={obl.suggestedOwner ?? 'e.g. team@geekay.gg'}
                  />
                </FormField>
              ))}
            </>
          )}
        </div>
      </DrawerBody>

      <DrawerFooter>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--c3-space-2)',
            width: '100%',
          }}
        >
          <Button
            appearance="secondary"
            onClick={handleDismiss}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={() => void handleSubmit()}
            disabled={!isValid || isPending}
          >
            {isPending
              ? (isSpMode ? 'Submitting…' : 'Starting…')
              : (isSpMode ? 'Submit for Approval' : 'Start Journey')}
          </Button>
        </div>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
