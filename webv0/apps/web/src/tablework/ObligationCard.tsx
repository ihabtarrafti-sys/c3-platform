/**
 * ObligationCard.tsx — the durable Obligation (Dawn's screen-4 right column).
 *
 * THE LAW: Delivered / Accepted / Done are THREE INDEPENDENT TRUTHS, derived
 * from the server view — Delivery ⇔ evidence exists; Acceptance ⇔ state ∈
 * {Accepted, Done}; Done ⇔ state = Done. Opening or reading changes none.
 *
 * Every action here is RENDER-gating only — the API's gateway is the
 * authority. The named-authority checks compare me.userId (the caller's OWN
 * id from /me) with the obligation's party ids; an EXTERNAL acceptance
 * requires the attestation note (the form enforces what the API enforces).
 */
import { useRef, useState } from 'react';
import type { CommsObligationDto } from '@c3web/api-contracts';
import type { CommsObligationAction } from '../api';
import { ObligationFact } from './TruthValue';

export interface ObligationActionInput {
  action: CommsObligationAction;
  expectedVersion: number;
  note?: string;
}

interface ObligationCardProps {
  obligation: CommsObligationDto;
  myUserId: string;
  /** owner/operations — mirrors the domain's ops-on-behalf delivery gate. */
  operational: boolean;
  lapsed: boolean;
  busy: boolean;
  /** userId → display label, resolved from what the caller may already see. */
  nameOf: (userId: string) => string;
  /** Resolves true on success — the typed words are kept on failure. */
  onTransition: (input: ObligationActionInput) => Promise<boolean>;
  onDeliverEvidence: (file: File, note: string | null) => Promise<void>;
}

export function ObligationCard({ obligation: o, myUserId, operational, lapsed, busy, nameOf, onTransition, onDeliverEvidence }: ObligationCardProps) {
  const [note, setNote] = useState('');
  const evidenceRef = useRef<HTMLInputElement>(null);

  // The three independent truths — server-derived, never front-end state.
  const deliveryKnown = o.evidence.length > 0;
  const acceptanceKnown = o.state === 'Accepted' || o.state === 'Done';
  const doneKnown = o.state === 'Done';
  const cancelled = o.state === 'Cancelled';

  const externalAcceptance = o.acceptanceKind === 'external';
  const noteRequiredFor = (action: CommsObligationAction): boolean =>
    action === 'cancel' || action === 'reopen' || ((action === 'accept' || action === 'reject') && externalAcceptance);

  // The gateway's table, mirrored for rendering only.
  const may: Record<CommsObligationAction, boolean> = {
    accept: o.state === 'Delivered' && myUserId === o.acceptanceUserId,
    reject: o.state === 'Delivered' && myUserId === o.acceptanceUserId,
    complete: o.state === 'Accepted' && (myUserId === o.accountableUserId || myUserId === o.requesterUserId),
    cancel: (o.state === 'Open' || o.state === 'Delivered' || o.state === 'Accepted') && myUserId === o.requesterUserId,
    reopen: (o.state === 'Accepted' || o.state === 'Done') && myUserId === o.requesterUserId,
  };
  // The gateway's own delivery gate: the accountable owner, or ops on behalf.
  const canDeliver = !cancelled && (o.state === 'Open' || o.state === 'Delivered') && (myUserId === o.accountableUserId || operational);

  const act = (action: CommsObligationAction) => {
    const trimmed = note.trim();
    if (noteRequiredFor(action) && !trimmed) return;
    // The words ride ONLY the actions that need them; kept when the action fails.
    void onTransition({ action, expectedVersion: o.version, note: noteRequiredFor(action) ? trimmed : undefined }).then((ok) => {
      if (ok) setNote('');
    });
  };

  const visibleActions = (Object.keys(may) as CommsObligationAction[]).filter((a) => may[a]);
  const needsNote = visibleActions.some((a) => noteRequiredFor(a));
  const due = new Date(o.dueAt);

  const beneficiary =
    o.beneficiaryKind === 'external' ? (o.beneficiaryLabel ?? 'External party') : nameOf(o.beneficiaryUserId ?? '');
  const acceptance = externalAcceptance
    ? `${o.acceptanceLabel ?? 'External authority'} · recorded by ${nameOf(o.acceptanceUserId)}`
    : nameOf(o.acceptanceUserId);

  return (
    <article className="obligation-card" data-tablework="ObligationCard" id={`obl-${o.obligationId}`} aria-labelledby={`obl-h-${o.obligationId}`}>
      <div>
        <p className="eyebrow">Obligation · {o.obligationId}</p>
        <h3 id={`obl-h-${o.obligationId}`}>{o.description}</h3>
      </div>
      {cancelled ? (
        <p>
          <span className="state-label danger">Cancelled</span> A durable record of the ask remains; its truths stopped accruing.
        </p>
      ) : null}
      <dl className="obligation-meta">
        <div>
          <dt>Accountable owner</dt>
          <dd>{nameOf(o.accountableUserId)}</dd>
        </div>
        <div>
          <dt>Beneficiary / requester</dt>
          <dd>
            {beneficiary} · requested by {nameOf(o.requesterUserId)}
          </dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>
            <time dateTime={o.dueAt}>{due.toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</time>
          </dd>
        </div>
        <div>
          <dt>Evidence requirement</dt>
          <dd>{o.evidenceRequirement}</dd>
        </div>
        <div>
          <dt>Acceptance authority</dt>
          <dd>{acceptance}</dd>
        </div>
      </dl>
      <div className="obligation-facts" role="group" aria-label="Independent Obligation truths">
        <ObligationFact
          label="Delivery"
          state={deliveryKnown ? 'known' : 'unknown'}
          mark={deliveryKnown ? '✓' : '1'}
          detail={deliveryKnown ? `Recorded · ${o.evidence.length === 1 ? 'evidence in Mission Documents' : `${o.evidence.length} evidence records`}` : 'Not recorded · no evidence delivered'}
        />
        <ObligationFact
          label="Acceptance"
          state={acceptanceKnown ? 'known' : 'unknown'}
          mark={acceptanceKnown ? '✓' : '2'}
          detail={acceptanceKnown ? 'Recorded · by the named authority' : 'Not recorded · awaiting named authority'}
        />
        <ObligationFact
          label="Done"
          state={doneKnown ? 'known' : 'unknown'}
          mark={doneKnown ? '✓' : '3'}
          detail={doneKnown ? 'Recorded · the final mechanism claimed' : 'Not recorded · final mechanism unclaimed'}
        />
      </div>
      {o.evidence.length > 0 ? (
        <div className="obligation-stack" data-tablework="EvidenceRequestSlot">
          {o.evidence.map((ev) => (
            <article key={ev.documentId} className="attachment-card">
              <span>
                <strong>{ev.fileName}</strong>
                <small>
                  Requested evidence · delivered by {ev.delivererLabel ?? nameOf(ev.deliveredByUserId)} ·{' '}
                  {new Date(ev.deliveredAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {ev.note ? ` · ${ev.note}` : ''}
                </small>
              </span>
              <span className="state-label warning">Delivered</span>
            </article>
          ))}
        </div>
      ) : null}
      {lapsed || cancelled ? null : (
        <>
          {needsNote ? (
            <label className="tw-field">
              <span>{externalAcceptance && (may.accept || may.reject) ? 'Attestation (required — the external authority’s word)' : 'Reason'}</span>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          ) : null}
          <div className="panel-actions" data-tablework="ObligationActions">
            {canDeliver ? (
              <>
                <input
                  ref={evidenceRef}
                  className="sr-only"
                  type="file"
                  tabIndex={-1}
                  aria-label="Deliver requested evidence"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // The delivery note is its own record field — never the
                    // shared reason/attestation words typed for a transition.
                    if (file && !busy) void onDeliverEvidence(file, null);
                    e.target.value = '';
                  }}
                />
                <button className="secondary-action" type="button" disabled={busy} onClick={() => evidenceRef.current?.click()}>
                  Deliver requested evidence
                </button>
              </>
            ) : null}
            {may.accept ? (
              <button className="primary-action" type="button" disabled={busy || (noteRequiredFor('accept') && !note.trim())} onClick={() => act('accept')}>
                Accept
              </button>
            ) : null}
            {may.reject ? (
              <button className="danger-action" type="button" disabled={busy || (noteRequiredFor('reject') && !note.trim())} onClick={() => act('reject')}>
                Reject
              </button>
            ) : null}
            {may.complete ? (
              <button className="secondary-action" type="button" disabled={busy} onClick={() => act('complete')}>
                Record Done
              </button>
            ) : null}
            {may.cancel ? (
              <button className="quiet-action" type="button" disabled={busy || !note.trim()} onClick={() => act('cancel')}>
                Cancel
              </button>
            ) : null}
            {may.reopen ? (
              <button className="quiet-action" type="button" disabled={busy || !note.trim()} onClick={() => act('reopen')}>
                Reopen
              </button>
            ) : null}
          </div>
        </>
      )}
      <p className="boundary-note">Reading, acknowledging, dismissing, or opening evidence changes none of these truths.</p>
    </article>
  );
}
