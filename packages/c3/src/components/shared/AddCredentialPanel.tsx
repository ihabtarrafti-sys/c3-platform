/**
 * AddCredentialPanel — C3 Design System v1.0
 *
 * Slide-in panel for registering a new credential against a Person.
 * First write surface for the Credential domain; establishes the operator-
 * facing pattern for credential management.
 *
 * Capability-driven mode:
 *   When `capabilityHint` is provided (opened from a Readiness "Resolve" action),
 *   the credential type dropdown shows two groups:
 *     - "Recommended for this requirement" — types that satisfy the capability
 *     - "Other credential types" — all remaining types
 *   This surfaces the capability model to operators without exposing its internals.
 *   The operator is guided, not blocked — edge-case types remain selectable.
 *
 * Constraints (Sprint 7):
 *   Add only. No edit, delete, deactivate, supersession, upload, or OCR.
 *
 * Behaviour:
 *   - Required: Credential Type, Reference Number
 *   - Optional: Expiry Date, Issue Date, Issued By, Sub-Type, Notes
 *   - On success: toast (names the credential type added) + dismiss + form reset
 *   - On error: toast, panel stays open
 *
 * Layer: Shared (components/shared) — imports domain types, hooks, protocols.
 */

import { useState } from 'react';
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Input,
  Label,
  OverlayDrawer,
  Select,
  Textarea,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

import { FormField } from '@c3/components/ui';
import { useAddCredential } from '@c3/hooks/useAddCredential';
import { useToast } from '@c3/hooks/useToast';
import { credentialTypesFor } from '@c3/protocols';
import type { CredentialCapability, CredentialType } from '@c3/types';
import {
  CAPABILITY_LABELS,
  CREDENTIAL_TYPE_LABELS,
  CREDENTIAL_TYPE_ORDER,
} from '@c3/utils/credentialLabels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddCredentialPanelProps {
  /** PersonID of the person this credential will be registered against. */
  personId: string;
  /** Controls panel visibility. */
  open: boolean;
  /** Called when the panel is closed (X, Cancel, or backdrop). */
  onDismiss: () => void;
  /**
   * When provided, the panel is in capability-driven mode:
   *   - Title changes to "Add Credential — Resolves {capabilityLabel}"
   *   - Credential type dropdown shows recommended types for this capability first
   */
  capabilityHint?: CredentialCapability;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AddCredentialPanel = ({
  personId,
  open,
  onDismiss,
  capabilityHint,
}: AddCredentialPanelProps) => {
  const { mutateAsync, isPending } = useAddCredential();
  const toast = useToast();

  // Form state
  const [credentialType,  setCredentialType]  = useState<CredentialType | ''>('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [expiryDate,      setExpiryDate]      = useState('');
  const [issueDate,       setIssueDate]       = useState('');
  const [issuedBy,        setIssuedBy]        = useState('');
  const [subType,         setSubType]         = useState('');
  const [notes,           setNotes]           = useState('');

  const isValid = credentialType !== '' && referenceNumber.trim().length > 0;

  const resetForm = () => {
    setCredentialType('');
    setReferenceNumber('');
    setExpiryDate('');
    setIssueDate('');
    setIssuedBy('');
    setSubType('');
    setNotes('');
  };

  const handleDismiss = () => {
    resetForm();
    onDismiss();
  };

  const handleSubmit = async () => {
    if (!credentialType) return;
    try {
      await mutateAsync({
        HolderPersonID:  personId,
        Type:            credentialType,
        ReferenceNumber: referenceNumber.trim(),
        ExpiryDate:      expiryDate     || undefined,
        IssuedDate:      issueDate      || undefined,
        IssuedBy:        issuedBy.trim()  || undefined,
        SubType:         subType.trim()   || undefined,
        Notes:           notes.trim()     || undefined,
      });
      toast.success(
        'Credential registered',
        `${CREDENTIAL_TYPE_LABELS[credentialType]} added successfully.`,
      );
      handleDismiss();
    } catch {
      toast.error(
        'Failed to register credential',
        'Please try again or contact support.',
      );
    }
  };

  // ── Dropdown options ──────────────────────────────────────────────────────

  const recommended = capabilityHint ? credentialTypesFor(capabilityHint) : [];
  const others = capabilityHint
    ? CREDENTIAL_TYPE_ORDER.filter(t => !recommended.includes(t))
    : CREDENTIAL_TYPE_ORDER;

  // ── Panel title ───────────────────────────────────────────────────────────

  const panelTitle = capabilityHint
    ? `Add Credential — Resolves ${CAPABILITY_LABELS[capabilityHint]}`
    : 'Add Credential';

  // ── Render ────────────────────────────────────────────────────────────────

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
          {panelTitle}
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
          {/* Credential Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
            <Label htmlFor="acp-type" required>
              Credential Type
            </Label>
            <Select
              id="acp-type"
              value={credentialType}
              onChange={(_, data) => setCredentialType(data.value as CredentialType | '')}
            >
              <option value="" disabled>
                Select a credential type…
              </option>

              {capabilityHint ? (
                <>
                  <optgroup label="Recommended for this requirement">
                    {recommended.map(type => (
                      <option key={type} value={type}>
                        {CREDENTIAL_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </optgroup>
                  {others.length > 0 && (
                    <optgroup label="Other credential types">
                      {others.map(type => (
                        <option key={type} value={type}>
                          {CREDENTIAL_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                CREDENTIAL_TYPE_ORDER.map(type => (
                  <option key={type} value={type}>
                    {CREDENTIAL_TYPE_LABELS[type]}
                  </option>
                ))
              )}
            </Select>
          </div>

          {/* Reference Number */}
          <FormField
            label="Reference Number"
            required
            htmlFor="acp-reference"
            hint="The number printed on the credential (passport no., ID no., permit no., etc.)."
          >
            <Input
              id="acp-reference"
              value={referenceNumber}
              onChange={(_, data) => setReferenceNumber(data.value)}
              placeholder="e.g. A12345678"
              style={{ fontFamily: 'monospace' }}
            />
          </FormField>

          {/* Expiry Date */}
          <FormField
            label="Expiry Date"
            htmlFor="acp-expiry"
            hint="Leave blank if this credential does not expire."
          >
            <Input
              id="acp-expiry"
              type="date"
              value={expiryDate}
              onChange={(_, data) => setExpiryDate(data.value)}
            />
          </FormField>

          {/* Issue Date */}
          <FormField
            label="Issue Date"
            htmlFor="acp-issued"
          >
            <Input
              id="acp-issued"
              type="date"
              value={issueDate}
              onChange={(_, data) => setIssueDate(data.value)}
            />
          </FormField>

          {/* Issued By */}
          <FormField
            label="Issued By"
            htmlFor="acp-issued-by"
            hint="Issuing authority, country, league, or organisation."
          >
            <Input
              id="acp-issued-by"
              value={issuedBy}
              onChange={(_, data) => setIssuedBy(data.value)}
              placeholder="e.g. UAE Federal Authority for Identity"
            />
          </FormField>

          {/* Sub-Type */}
          <FormField
            label="Sub-Type"
            htmlFor="acp-subtype"
            hint="Visa category, registration tier, permit class, etc."
          >
            <Input
              id="acp-subtype"
              value={subType}
              onChange={(_, data) => setSubType(data.value)}
              placeholder="e.g. Employment, Tourist, Student"
            />
          </FormField>

          {/* Notes */}
          <FormField
            label="Notes"
            htmlFor="acp-notes"
          >
            <Textarea
              id="acp-notes"
              value={notes}
              onChange={(_, data) => setNotes(data.value)}
              rows={3}
              placeholder="Optional notes…"
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
            {isPending ? 'Registering…' : 'Register Credential'}
          </Button>
        </div>
      </DrawerFooter>
    </OverlayDrawer>
  );
};
