/**
 * Message.tsx — the Thread's message row (Dawn's message-group verbatim).
 *
 * ObjectLink chips NAVIGATE, NEVER EXECUTE (owner-ruled): a chip is a <Link>
 * to the record (or an in-page anchor) — no chip has an action handler, and
 * ApprovalLinkReference renders identity + Open, NOTHING else. Attachments
 * download through the bearer-authed document route (never a raw href).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommsMessageAttachmentDto, CommsMessageDto, CommsMessageLinkDto } from '@c3web/api-contracts';
import { api } from '../apiClient';
import { ApiError } from '../api';

export function initialsOf(label: string | null): string {
  if (!label) return '·';
  return label
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** target type → the record's real route; null = an identity chip (no route). */
function linkHref(link: CommsMessageLinkDto): string | null {
  switch (link.targetType) {
    case 'Approval':
      return `/approvals/${link.targetId}`;
    case 'Mission':
      return `/missions/${link.targetId}`;
    case 'Person':
      return `/people/${link.targetId}`;
    case 'Journey':
      return '/journeys';
    case 'Credential':
      return '/credentials';
    default:
      // Document rides the attachment card; Message/Obligation are in-Room anchors.
      return null;
  }
}

function ObjectLinkChip({ link }: { link: CommsMessageLinkDto }) {
  const href = linkHref(link);
  if (link.targetType === 'Approval') {
    // The approval reference card: identity + Open. Conversation cannot
    // approve, reject, or execute — no other affordance exists here.
    return (
      <article className="approval-reference" data-tablework="ApprovalLinkReference">
        <span>
          <strong>{link.targetId}</strong>
          <small>Approval record · opens in Approvals</small>
        </span>
        <Link className="mini-action" to={href!}>
          Open
        </Link>
      </article>
    );
  }
  if (href === null) {
    if (link.targetType === 'Obligation' || link.targetType === 'Message') {
      return (
        <a className="mini-action" data-tablework="ObjectLink" href={`#${link.targetType === 'Obligation' ? 'obl' : 'msg'}-${link.targetId}`}>
          {link.targetId}
        </a>
      );
    }
    // No route exists for this record kind — a plain identity reference,
    // never dressed as an interactive chip.
    return (
      <span className="object-ref" data-tablework="ObjectLink">
        {link.targetId}
      </span>
    );
  }
  return (
    <Link className="mini-action" data-tablework="ObjectLink" to={href}>
      {link.targetId}
    </Link>
  );
}

function AttachmentRow({ attachment }: { attachment: CommsMessageAttachmentDto }) {
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    try {
      setError(null);
      const { blob, fileName } = await api.downloadDocument(attachment.documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || attachment.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The download failed.');
    }
  };
  const kb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
  return (
    <article className="attachment-card" data-tablework="AttachmentRow">
      <span>
        <strong>{attachment.fileName}</strong>
        <small>
          Attached to the conversation · {kb} KB · {attachment.documentId}
        </small>
        {error ? (
          <small role="alert" className="attachment-error">
            {error}
          </small>
        ) : null}
      </span>
      <button className="mini-action" type="button" onClick={() => void download()}>
        Download
      </button>
    </article>
  );
}

export function Message({ message }: { message: CommsMessageDto }) {
  const time = new Date(message.createdAt);
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  return (
    <article className="message-group" data-tablework="Message" id={`msg-${message.messageId}`}>
      <span className="avatar-dot actor-avatar" aria-hidden="true">
        {initialsOf(message.authorLabel)}
      </span>
      <div className="message-copy">
        <header>
          <strong>{message.authorLabel ?? 'Member'}</strong>
          <time dateTime={message.createdAt}>{hhmm}</time>
        </header>
        <p>{message.body}</p>
        {message.attachments.map((attachment) => (
          <AttachmentRow key={attachment.documentId} attachment={attachment} />
        ))}
        {message.links.length > 0 ? (
          <div className="message-actions" data-tablework="ObjectLinks">
            {message.links.map((link) => (
              <ObjectLinkChip key={`${link.targetType}:${link.targetId}`} link={link} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
