import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { IntakeLinkDto, IntakeSubmissionDto } from '@c3web/api-contracts';
import { useIntakeLinks, useIntakeSandbox } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  WorkSurface,
  FactList,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Textarea,
  Selector,
  GovernedAction,
} from '../tablework';

/**
 * Guest intake (Track B6) — the staff side, on the Tablework frame (pivot W2;
 * the Fluent page's behaviour, testids, and copy verbatim). Mint a
 * single-purpose, expiring link and send it to a new joiner; they fill an
 * onboarding form (no account) and it lands in the SANDBOX below. Reviewing a
 * submission PROMOTES it through the AddPerson approval pipeline (under your
 * identity) or REJECTS it (the details are wiped). Owner/operations only.
 * Nothing a guest types reaches live data without a governed promotion.
 *
 * ⚠️ THE HIGHEST-RISK SCREEN IN THE PIVOT. It renders a one-time capability
 * token into the DOM *and* the clipboard, prints the whole guest payload,
 * offers a quarantined identity-document download, and carries an ERASURE
 * whose own copy promises "This cannot be undone". Its erasure path now has an
 * oracle — `e2e/zzz-intake-erasure.spec.ts` (D2) — which was landed and
 * RED-proven BEFORE this conversion, and which addresses the screen only
 * through testids and copy so it certifies both grammars.
 */

const EXPIRY_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

function linkVariant(status: IntakeLinkDto['status']): 'ready' | 'neutral' | 'blocked' {
  if (status === 'Active') return 'ready';
  if (status === 'Revoked') return 'blocked';
  return 'neutral';
}
function subVariant(status: IntakeSubmissionDto['status']): 'ready' | 'pending' | 'blocked' {
  if (status === 'Pending') return 'pending';
  if (status === 'Rejected') return 'blocked';
  return 'ready';
}

export function IntakePage() {
  return (
    <TableworkPage record="Guest intake" section="Links & sandbox">
      <IntakeDesk />
    </TableworkPage>
  );
}

function IntakeDesk() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageIntake ?? false;

  // THE WIRE LAW: the capability IS the `enabled` flag on BOTH queries. The
  // sandbox carries unpromoted guest PII; hoisting it to always-on and hiding
  // it visually would ship that payload to a browser that must not receive it,
  // and no testid assertion catches it.
  const links = useIntakeLinks(canManage);
  const sandbox = useIntakeSandbox(canManage);

  const [label, setLabel] = useState('');
  const [expiryHours, setExpiryHours] = useState(168);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // NO-TOUCH (existing behaviour that looks like a bug): ONE `note` shared
  // across all rows. Carried as-is — making it per-row is a behaviour change.
  const [note, setNote] = useState('');

  if (!canManage) {
    return (
      <CollectionFrame title="Guest intake">
        <EmptyState data-testid="intake-denied" message="Guest intake is available to owners and operations." />
      </CollectionFrame>
    );
  }

  async function mint(): Promise<void> {
    setMinting(true);
    try {
      const res = await api.createIntakeLink({ kind: 'Onboarding', label: label.trim() || null, expiresInHours: expiryHours });
      setMinted(`${window.location.origin}/intake/${res.token}`);
      setLabel('');
      await qc.invalidateQueries({ queryKey: ['intakeLinks'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not mint a link.');
    } finally {
      setMinting(false);
    }
  }

  async function copyMinted(): Promise<void> {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      notify('success', 'Link copied — send it to the joiner. It is shown only once.');
    } catch {
      notify('error', 'Could not copy — select the link and copy it manually.');
    }
  }

  async function revoke(link: IntakeLinkDto): Promise<void> {
    try {
      await api.revokeIntakeLink(link.id);
      notify('success', 'Link revoked.');
      await qc.invalidateQueries({ queryKey: ['intakeLinks'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Revoke failed.');
    }
  }

  async function downloadFile(submissionId: string, uploadId: string, fileName: string): Promise<void> {
    try {
      const { blob } = await api.downloadIntakeUpload(submissionId, uploadId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Download failed.');
    }
  }

  async function promote(sub: IntakeSubmissionDto): Promise<void> {
    try {
      const res = await api.promoteSubmission(sub.id, note.trim() || null);
      notify('success', `Promoted — an owner must approve ${res.approval.approvalId} to create the person.`);
      setNote('');
      setOpenId(null);
      await qc.invalidateQueries({ queryKey: ['intakeSandbox'] });
      await qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Promote failed.');
    }
  }

  async function reject(sub: IntakeSubmissionDto): Promise<void> {
    try {
      await api.rejectSubmission(sub.id, note.trim() || null);
      notify('success', 'Submission rejected — its details were wiped.');
      setNote('');
      setOpenId(null);
      await qc.invalidateQueries({ queryKey: ['intakeSandbox'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Reject failed.');
    }
  }

  // Move a promoted submission's quarantined files onto the CREATED person.
  // Only possible once the AddPerson request has been approved + executed (the
  // person exists then) — the API 409s otherwise, surfaced truthfully here.
  async function attachFiles(sub: IntakeSubmissionDto): Promise<void> {
    try {
      const res = await api.attachIntakeUploads(sub.id, sub.uploads.map((u) => u.uploadId));
      notify(res.attachedCount > 0 ? 'success' : 'info', res.attachedCount > 0 ? `${res.attachedCount} file(s) attached to ${res.personId}.` : 'No files remained to attach.');
      await qc.invalidateQueries({ queryKey: ['intakeSandbox'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Approve and execute the request first, then attach.');
    }
  }

  const pending = (sandbox.data?.submissions ?? []).filter((x) => x.status === 'Pending');
  const reviewed = (sandbox.data?.submissions ?? []).filter((x) => x.status !== 'Pending');

  return (
    <CollectionFrame
      kicker="Retire the manager-as-typist"
      title="Guest intake"
      scope={
        <>
          Mint a single-use link and send it to a new joiner. They fill their own details — no account needed — and the
          submission lands in the sandbox below. Reviewing it promotes it through the normal AddPerson approval (under your
          name) or rejects it and wipes the details.
        </>
      }
    >
      {/* ── mint ── */}
      <p className="eyebrow">New invitation link</p>
      <div className="collection-filters">
        <Field label="Label (optional)">
          <Input value={label} placeholder="e.g. LoL support tryout — Ahmad" onChange={(e) => setLabel(e.target.value)} data-testid="intake-label" />
        </Field>
        <Field label="Expires in">
          <Selector
            data-testid="intake-expiry"
            value={String(expiryHours)}
            display={EXPIRY_OPTIONS.find((o) => o.hours === expiryHours)?.label ?? '7 days'}
            options={EXPIRY_OPTIONS.map((o) => ({ value: String(o.hours), label: o.label }))}
            onSelect={(value) => setExpiryHours(Number(value))}
          />
        </Field>
        <button className="primary-action" type="button" onClick={() => void mint()} disabled={minting} data-testid="intake-mint">
          {minting ? 'Minting…' : 'Mint link'}
        </button>
      </div>

      {minted && (
        <WorkSurface tier="raised" className="collection-frame" data-testid="intake-minted">
          <p className="record-lead">Send this link to the joiner. It is shown only once — copy it now.</p>
          {/* The whole capability, shown ONCE. `<code>` keeps a monospace face
              (its UA rule beats the inherited human font) while the kit class
              supplies the colour, size and overflow-wrap a 256-bit URL-safe
              token needs — the kit has no mono class that wraps. */}
          <code className="record-row-name">{minted}</code>
          <div>
            <button className="secondary-action" type="button" onClick={() => void copyMinted()} data-testid="intake-copy">Copy link</button>
          </div>
        </WorkSurface>
      )}

      {links.isLoading && <LoadingState label="Loading links…" />}
      {links.isError && (
        <ErrorState
          message={links.error instanceof ApiError ? links.error.message : 'Could not load links.'}
          correlationId={links.error instanceof ApiError ? links.error.correlationId : undefined}
        />
      )}
      {links.data && links.data.links.length === 0 && <EmptyState data-testid="intake-links-empty" message="No links yet — mint one above." />}
      {links.data && links.data.links.length > 0 && (
        <ComparisonTable label="Intake links" testId="intake-links-table">
          <thead>
            <tr>
              <th>Link</th>
              <th>Status</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.data.links.map((l) => (
              <tr key={l.id} data-testid={`intake-link-${l.id}`}>
                <td>
                  <div>{l.label ?? 'Onboarding'}</div>
                  {/* Raw ISO slices — formatDisplayDate is a NEGATIVE contract. */}
                  <div className="record-row-meta">{l.createdBy} · {l.createdAt.slice(0, 10)}</div>
                </td>
                <td><StatusBadge variant={linkVariant(l.status)}>{l.status}</StatusBadge></td>
                <td className="mono">{l.expiresAt.slice(0, 10)}</td>
                <td>
                  {l.status === 'Active' && (
                    <GovernedAction
                      triggerLabel="Revoke"
                      triggerTestId={`intake-revoke-${l.id}`}
                      triggerAppearance="secondary"
                      title="Revoke this link?"
                      description="The link stops working immediately. Anyone you sent it to will need a fresh one."
                      confirmLabel="Revoke"
                      onConfirm={() => revoke(l)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ComparisonTable>
      )}

      {/* ── sandbox ── */}
      <p className="eyebrow">Sandbox — submissions to review</p>
      {sandbox.isLoading && <LoadingState label="Loading submissions…" />}
      {sandbox.isError && (
        <ErrorState
          message={sandbox.error instanceof ApiError ? sandbox.error.message : 'Could not load the sandbox.'}
          correlationId={sandbox.error instanceof ApiError ? sandbox.error.correlationId : undefined}
        />
      )}
      {sandbox.data && sandbox.data.submissions.length === 0 && (
        <EmptyState data-testid="intake-sandbox-empty" message="No submissions yet — nothing to review." />
      )}
      {sandbox.data && sandbox.data.submissions.length > 0 && (
        <ComparisonTable label="Intake sandbox" testId="intake-sandbox-table">
          <thead>
            <tr>
              <th>Submission</th>
              <th>Received</th>
              <th>Status</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {[...pending, ...reviewed].map((sub) => {
              const name = typeof sub.payload?.fullName === 'string' ? (sub.payload.fullName as string) : '—';
              const open = openId === sub.id;
              return (
                <tr key={sub.id} data-testid={`intake-sub-${sub.id}`}>
                  <td>
                    <div>{name}</div>
                    <div className="record-row-meta">{sub.id.slice(0, 8).toUpperCase()} · {sub.uploads.length} file(s)</div>
                    {open && sub.payload && (
                      <>
                        {/* The whole guest payload, as submitted. FactList carries
                            the honest-absence marker for a field left blank. */}
                        <FactList
                          items={Object.entries(sub.payload).map(([k, v]) => ({
                            label: k,
                            value: v === null || v === undefined || v === '' ? null : String(v),
                          }))}
                        />
                        {sub.uploads.length > 0 && (
                          <div className="record-rows">
                            {sub.uploads.map((u) => (
                              <div className="record-row-item" key={u.uploadId}>
                                <button className="mini-action" type="button" onClick={() => void downloadFile(sub.id, u.uploadId, u.fileName)} data-testid={`intake-file-${u.uploadId}`}>
                                  {u.fileName}
                                </button>
                                <span className="record-row-spacer" />
                                <span className="record-row-meta">{Math.ceil(u.sizeBytes / 1024)} KB</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {sub.status === 'Promoted' && sub.promotedApprovalId && (
                          <Link className="mini-action" to={`/approvals/${sub.promotedApprovalId}`}>Open approval {sub.promotedApprovalId} →</Link>
                        )}
                        {sub.status === 'Promoted' && sub.uploads.length > 0 && (
                          <div className="message-actions">
                            <button className="secondary-action" type="button" onClick={() => void attachFiles(sub)} data-testid={`intake-attach-${sub.id}`}>
                              Attach {sub.uploads.length} file(s) to the person
                            </button>
                            <span className="record-row-meta">(after the request is approved + executed)</span>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="mono">{sub.submittedAt.slice(0, 10)}</td>
                  <td><StatusBadge variant={subVariant(sub.status)}>{sub.status}</StatusBadge></td>
                  <td>
                    <div className="message-actions">
                      <button className="quiet-action" type="button" onClick={() => { setOpenId(open ? null : sub.id); setNote(''); }} data-testid={`intake-open-${sub.id}`}>
                        {open ? 'Hide' : 'View'}
                      </button>
                      {sub.status === 'Pending' && (
                        <>
                          <GovernedAction
                            triggerLabel="Promote…"
                            triggerTestId={`intake-promote-${sub.id}`}
                            triggerAppearance="primary"
                            title={`Promote ${name}?`}
                            description="This submits an AddPerson request for an owner to approve — the person is created only after they execute it. The submitter of record is you."
                            extra={
                              <Field label="Note (optional)">
                                <Textarea value={note} onChange={(e) => setNote(e.target.value)} data-testid={`intake-promote-note-${sub.id}`} />
                              </Field>
                            }
                            confirmLabel="Promote to approval"
                            onConfirm={() => promote(sub)}
                          />
                          <GovernedAction
                            triggerLabel="Reject…"
                            triggerTestId={`intake-reject-${sub.id}`}
                            triggerAppearance="secondary"
                            title={`Reject ${name}?`}
                            description="The submission is marked rejected and its details (and any files) are wiped. This cannot be undone."
                            extra={
                              <Field label="Reason (optional)">
                                <Textarea value={note} onChange={(e) => setNote(e.target.value)} data-testid={`intake-reject-note-${sub.id}`} />
                              </Field>
                            }
                            confirmLabel="Reject and wipe"
                            onConfirm={() => reject(sub)}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ComparisonTable>
      )}
    </CollectionFrame>
  );
}
