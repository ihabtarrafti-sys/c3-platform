/**
 * CreateAmendmentPanel — C3 Design System v1.0
 *
 * Slide-in panel for creating a new amendment against a contract.
 * Proof-of-concept for Phase 5D: establishes the form/mutation/feedback
 * pattern for all future write operations in C3.
 *
 * Behaviour:
 *   - Opens as an OverlayDrawer from the right edge
 *   - Three required fields: Amendment Type, Effective Date, Description
 *   - Submit disabled until all required fields are filled
 *   - On success: dismiss panel + success toast + invalidate amendments query
 *   - On error:   error toast, panel stays open for correction
 *   - Form resets when the panel is dismissed
 *
 * No validation rules beyond field presence (proof-of-concept scope).
 * No optimistic updates. No workflow engine changes.
 *
 * Layer: Shared (components/shared) — imports domain types and hooks.
 */

import { useState } from 'react';
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Input,
  OverlayDrawer,
  Select,
  Textarea,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { FormField } from '@c3/components/ui';
import { useApp } from '@c3/hooks/useApp';
import { useCreateAmendment } from '@c3/hooks/useCreateAmendment';
import { useToast } from '@c3/hooks/useToast';

// ---------------------------------------------------------------------------
// Amendment type catalogue
// ---------------------------------------------------------------------------

const AMENDMENT_TYPES = [
  'Salary Adjustment',
  'Role Change',
  'Contract Extension',
  'Team Transfer',
  'Termination Notice',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAmendmentPanelProps {
  /** Internal contract record ID — used to invalidate the amendments query. */
  contractId: string;
  /** Human-readable contract code shown in the panel header (e.g. "CTR-2024-001"). */
  contractCode: string;
  /** Controls panel visibility. */
  open: boolean;
  /** Called when the user closes the panel (X button, Cancel, or backdrop click). */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CreateAmendmentPanel = ({
  contractId,
  contractCode,
  open,
  onDismiss,
}: CreateAmendmentPanelProps) => {
  const { currentUser } = useApp();
  const { mutateAsync, isPending } = useCreateAmendment(contractId);
  const toast = useToast();

  // Form state
  const [amendmentType, setAmendmentType] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [description, setDescription] = useState('');

  const isValid =
    amendmentType.trim().length > 0 &&
    effectiveDate.trim().length > 0 &&
    description.trim().length > 0;

  const resetForm = () => {
    setAmendmentType('');
    setEffectiveDate('');
    setDescription('');
  };

  const handleDismiss = () => {
    resetForm();
    onDismiss();
  };

  const handleSubmit = async () => {
    try {
      await mutateAsync({
        ContractID: contractCode,
        AmendmentType: amendmentType,
        Description: description,
        EffectiveDate: effectiveDate,
        PerformedByName: currentUser.displayName,
        PerformedByEmail: currentUser.email,
        PerformedByType: currentUser.c3Role,
      });
      toast.success(
        'Amendment created',
        `Amendment for ${contractCode} has been submitted.`,
      );
      handleDismiss();
    } catch {
      toast.error(
        'Failed to create amendment',
        'Please try again or contact support.',
      );
    }
  };

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
          Add Amendment · {contractCode}
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
          <FormField
            label="Amendment Type"
            required
            htmlFor="cap-amendment-type"
          >
            <Select
              id="cap-amendment-type"
              value={amendmentType}
              onChange={(_, data) => setAmendmentType(data.value)}
            >
              <option value="">Select type…</option>
              {AMENDMENT_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Effective Date"
            required
            htmlFor="cap-effective-date"
          >
            <Input
              id="cap-effective-date"
              type="date"
              value={effectiveDate}
              onChange={(_, data) => setEffectiveDate(data.value)}
            />
          </FormField>

          <FormField
            label="Description"
            required
            htmlFor="cap-description"
            hint="Describe the nature and reason for this amendment."
          >
            <Textarea
              id="cap-description"
              value={description}
              onChange={(_, data) => setDescription(data.value)}
              rows={5}
              placeholder="Enter amendment description…"
              resize="vertical"
            />
          </FormField>
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
            {isPending ? 'Creating…' : 'Create Amendment'}
          </Button>
        </div>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
