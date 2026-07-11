import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option, Textarea, makeStyles } from '@fluentui/react-components';
import type { IntakeLinkDto, IntakeSubmissionDto } from '@c3web/api-contracts';
import { useIntakeLinks, useIntakeSandbox } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { GovernedAction } from '../components/GovernedAction';
import { useRegisterStyles } from '../components/registerStyles';

/**
 * Guest intake (Track B6) — the staff side. Mint a single-purpose, expiring
 * link and send it to a new joiner; they fill an onboarding form (no account)
 * and it lands in the SANDBOX below. Reviewing a submission PROMOTES it through
 * the AddPerson approval pipeline (under your identity) or REJECTS it (the
 * details are wiped). Owner/operations only. Nothing a guest types reaches live
 * data without a governed promotion.
 */

const EXPIRY_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-mid)', maxWidth: '680px', marginBottom: '16px' },
  section: { marginTop: '28px' },
  sectionTitle: { fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c3-ink-muted)', fontFamily: 'var(--c3-font-mono)', marginBottom: '12px' },
  mintRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px', marginBottom: '18px' },
  tokenBox: {
    marginBottom: '18px',
    padding: '12px 14px',
    border: '1px solid var(--c3-brand)',
    borderRadius: 'var(--c3-radius-md, 14px)',
    backgroundColor: 'var(--c3-hover)',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '8px',
  },
  tokenNote: { fontSize: '12.5px', color: 'var(--c3-ink-mid)' },
  tokenUrl: { fontFamily: 'var(--c3-font-mono)', fontSize: '12px', color: 'var(--c3-ink)', wordBreak: 'break-all' },
  meta: { fontSize: '12.5px', color: 'var(--c3-ink-mid)' },
  metaMono: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-muted)' },
  detail: { display: 'flex', flexDirection: 'column', rowGap: '10px', minWidth: '320px' },
  kv: { display: 'grid', gridTemplateColumns: '130px 1fr', columnGap: '10px', rowGap: '4px', fontSize: '13px' },
  kvKey: { color: 'var(--c3-ink-muted)' },
  kvVal: { color: 'var(--c3-ink)' },
  files: { display: 'flex', flexDirection: 'column', rowGap: '6px', marginTop: '4px' },
  fileRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px', minWidth: '300px' },
  actions: { display: 'flex', gap: '8px' },
});

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
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageIntake ?? false;

  const links = useIntakeLinks(canManage);
  const sandbox = useIntakeSandbox(canManage);

  const [label, setLabel] = useState('');
  const [expiryHours, setExpiryHours] = useState(168);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Guest intake" />
        <EmptyState data-testid="intake-denied" message="Guest intake is available to owners and operations." />
      </div>
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
    <div>
      <PageHeader kicker="Retire the manager-as-typist" title="Guest intake" />
      <p className={s.intro}>
        Mint a single-use link and send it to a new joiner. They fill their own details — no account needed — and the
        submission lands in the sandbox below. Reviewing it promotes it through the normal AddPerson approval (under your
        name) or rejects it and wipes the details.
      </p>

      {/* ── mint ── */}
      <div className={s.section}>
        <div className={s.sectionTitle}>New invitation link</div>
        <div className={s.mintRow}>
          <Field label="Label (optional)">
            <Input value={label} placeholder="e.g. LoL support tryout — Ahmad" onChange={(_, d) => setLabel(d.value)} data-testid="intake-label" style={{ minWidth: '260px' }} />
          </Field>
          <Field label="Expires in">
            <Dropdown
              value={EXPIRY_OPTIONS.find((o) => o.hours === expiryHours)?.label ?? '7 days'}
              selectedOptions={[String(expiryHours)]}
              onOptionSelect={(_, d) => setExpiryHours(Number(d.optionValue))}
              data-testid="intake-expiry"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <Option key={o.hours} value={String(o.hours)}>{o.label}</Option>
              ))}
            </Dropdown>
          </Field>
          <Button appearance="primary" onClick={mint} disabled={minting} data-testid="intake-mint">
            {minting ? 'Minting…' : 'Mint link'}
          </Button>
        </div>

        {minted && (
          <div className={s.tokenBox} data-testid="intake-minted">
            <span className={s.tokenNote}>Send this link to the joiner. It is shown only once — copy it now.</span>
            <span className={s.tokenUrl}>{minted}</span>
            <div>
              <Button appearance="secondary" onClick={copyMinted} data-testid="intake-copy">Copy link</Button>
            </div>
          </div>
        )}

        {links.isLoading && <LoadingState label="Loading links…" />}
        {links.isError && <ErrorState message={links.error instanceof ApiError ? links.error.message : 'Could not load links.'} />}
        {links.data && links.data.links.length === 0 && <EmptyState data-testid="intake-links-empty" message="No links yet — mint one above." />}
        {links.data && links.data.links.length > 0 && (
          <table className={r.table} data-testid="intake-links-table" aria-label="Intake links">
            <thead>
              <tr>
                <th className={r.th}>Link</th>
                <th className={r.th}>Status</th>
                <th className={r.th}>Expires</th>
                <th className={r.th}></th>
              </tr>
            </thead>
            <tbody>
              {links.data.links.map((l) => (
                <tr key={l.id} className={r.row} data-testid={`intake-link-${l.id}`}>
                  <td className={r.td}>
                    <div>{l.label ?? 'Onboarding'}</div>
                    <div className={s.metaMono}>{l.createdBy} · {l.createdAt.slice(0, 10)}</div>
                  </td>
                  <td className={r.td}><StatusBadge variant={linkVariant(l.status)}>{l.status}</StatusBadge></td>
                  <td className={r.td}><span className={s.meta}>{l.expiresAt.slice(0, 10)}</span></td>
                  <td className={r.td}>
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
          </table>
        )}
      </div>

      {/* ── sandbox ── */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Sandbox — submissions to review</div>
        {sandbox.isLoading && <LoadingState label="Loading submissions…" />}
        {sandbox.isError && <ErrorState message={sandbox.error instanceof ApiError ? sandbox.error.message : 'Could not load the sandbox.'} />}
        {sandbox.data && sandbox.data.submissions.length === 0 && (
          <EmptyState data-testid="intake-sandbox-empty" message="No submissions yet — nothing to review." />
        )}
        {sandbox.data && sandbox.data.submissions.length > 0 && (
          <table className={r.table} data-testid="intake-sandbox-table" aria-label="Intake sandbox">
            <thead>
              <tr>
                <th className={r.th}>Submission</th>
                <th className={r.th}>Received</th>
                <th className={r.th}>Status</th>
                <th className={r.th}>Review</th>
              </tr>
            </thead>
            <tbody>
              {[...pending, ...reviewed].map((sub) => {
                const name = typeof sub.payload?.fullName === 'string' ? (sub.payload.fullName as string) : '—';
                const open = openId === sub.id;
                return (
                  <tr key={sub.id} className={r.row} data-testid={`intake-sub-${sub.id}`}>
                    <td className={r.td}>
                      <div>{name}</div>
                      <div className={s.metaMono}>{sub.id.slice(0, 8).toUpperCase()} · {sub.uploads.length} file(s)</div>
                      {open && sub.payload && (
                        <div className={s.detail} style={{ marginTop: '10px' }}>
                          <div className={s.kv}>
                            {Object.entries(sub.payload).map(([k, v]) => (
                              <Fragment key={k}>
                                <span className={s.kvKey}>{k}</span>
                                <span className={s.kvVal}>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                              </Fragment>
                            ))}
                          </div>
                          {sub.uploads.length > 0 && (
                            <div className={s.files}>
                              {sub.uploads.map((u) => (
                                <div className={s.fileRow} key={u.uploadId}>
                                  <Button appearance="subtle" size="small" onClick={() => downloadFile(sub.id, u.uploadId, u.fileName)} data-testid={`intake-file-${u.uploadId}`}>
                                    {u.fileName}
                                  </Button>
                                  <span className={s.metaMono}>{Math.ceil(u.sizeBytes / 1024)} KB</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {sub.status === 'Promoted' && sub.promotedApprovalId && (
                            <Link className={s.meta} to={`/approvals/${sub.promotedApprovalId}`}>Open approval {sub.promotedApprovalId} →</Link>
                          )}
                          {sub.status === 'Promoted' && sub.uploads.length > 0 && (
                            <div>
                              <Button appearance="secondary" size="small" onClick={() => attachFiles(sub)} data-testid={`intake-attach-${sub.id}`}>
                                Attach {sub.uploads.length} file(s) to the person
                              </Button>
                              <span className={s.metaMono} style={{ marginLeft: '8px' }}>(after the request is approved + executed)</span>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={r.td}><span className={s.meta}>{sub.submittedAt.slice(0, 10)}</span></td>
                    <td className={r.td}><StatusBadge variant={subVariant(sub.status)}>{sub.status}</StatusBadge></td>
                    <td className={r.td}>
                      <div className={s.actions}>
                        <Button appearance="subtle" size="small" onClick={() => { setOpenId(open ? null : sub.id); setNote(''); }} data-testid={`intake-open-${sub.id}`}>
                          {open ? 'Hide' : 'View'}
                        </Button>
                        {sub.status === 'Pending' && (
                          <>
                            <GovernedAction
                              triggerLabel="Promote…"
                              triggerTestId={`intake-promote-${sub.id}`}
                              triggerAppearance="primary"
                              title={`Promote ${name}?`}
                              description="This submits an AddPerson request for an owner to approve — the person is created only after they execute it. The submitter of record is you."
                              extra={
                                <div className={s.fields}>
                                  <Field label="Note (optional)">
                                    <Textarea value={note} onChange={(_, d) => setNote(d.value)} data-testid={`intake-promote-note-${sub.id}`} />
                                  </Field>
                                </div>
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
                                <div className={s.fields}>
                                  <Field label="Reason (optional)">
                                    <Textarea value={note} onChange={(_, d) => setNote(d.value)} data-testid={`intake-reject-note-${sub.id}`} />
                                  </Field>
                                </div>
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
          </table>
        )}
      </div>
    </div>
  );
}
