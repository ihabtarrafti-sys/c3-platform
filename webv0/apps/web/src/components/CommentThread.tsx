import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Tag, TagPicker, TagPickerControl, TagPickerGroup, TagPickerInput, TagPickerList, TagPickerOption, Textarea, makeStyles } from '@fluentui/react-components';
import type { CommentSubjectType } from '@c3web/domain';
import { useComments, useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';

/**
 * CommentThread (Track B4) — contextual discussion + @mentions on a record.
 * Drop <CommentThread subjectType subjectId /> on any detail page. Comments
 * are append-only; @mentions are picked from the member list (when the
 * viewer can read it) and notify those members via the S10 bell. You can
 * comment wherever you can read the record (the API enforces it).
 */

const useStyles = makeStyles({
  section: { marginTop: '32px', maxWidth: '720px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-ink-default)', margin: '0 0 12px' },
  list: { display: 'flex', flexDirection: 'column', rowGap: '2px', marginBottom: '16px' },
  empty: { fontSize: '13px', color: 'var(--c3-ink-quiet)', padding: '8px 0 16px' },
  item: { padding: '10px 0', borderBottom: '1px solid var(--c3-border-subtle)' },
  head: { display: 'flex', alignItems: 'baseline', columnGap: '8px', marginBottom: '3px' },
  author: { fontSize: '13px', fontWeight: 600, color: 'var(--c3-ink-default)' },
  when: { fontFamily: 'var(--c3-font-mono)', fontSize: '11px', color: 'var(--c3-ink-quiet)' },
  body: { fontSize: '13.5px', lineHeight: '19px', color: 'var(--c3-ink-default)', whiteSpace: 'pre-wrap' },
  mentions: { marginTop: '4px', fontSize: '11.5px', color: 'var(--c3-action-primary)', fontFamily: 'var(--c3-font-mono)' },
  composer: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  composerRow: { display: 'flex', columnGap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' },
  mentionLabel: { fontSize: '12px', color: 'var(--c3-ink-muted)', marginBottom: '2px' },
});

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CommentThread({ subjectType, subjectId }: { subjectType: CommentSubjectType; subjectId: string }) {
  const s = useStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useComments(subjectType, subjectId);
  // The member list drives the @mention picker — fetched only when the viewer
  // can read members (owner/ops). Other roles still comment, just without the
  // mention picker (no 403 noise).
  const members = useMembers(me?.capabilities.canReadMembers ?? false);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const memberOptions = (members.data?.members ?? []).map((m) => ({ value: m.email, label: `${m.displayName} (${m.email})` }));
  const comments = data?.comments ?? [];

  async function post() {
    if (body.trim() === '') return;
    setBusy(true);
    try {
      await api.postComment(subjectType, subjectId, body.trim(), mentions);
      setBody('');
      setMentions([]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['comments', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      notify('success', mentions.length > 0 ? `Comment posted — ${mentions.length} member(s) notified.` : 'Comment posted.');
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not post the comment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.section} data-testid="comment-thread">
      <h2 className={s.h2}>Discussion</h2>

      <div className={s.list}>
        {isLoading && <span className={s.empty}>Loading discussion…</span>}
        {!isLoading && comments.length === 0 && <span className={s.empty} data-testid="comments-empty">No comments yet. Start the thread.</span>}
        {comments.map((c) => (
          <div key={c.id} className={s.item} data-testid={`comment-${c.id}`}>
            <div className={s.head}>
              <span className={s.author}>{c.author}</span>
              <span className={s.when}>{fmt(c.createdAt)}</span>
            </div>
            <div className={s.body}>{c.body}</div>
            {c.mentions.length > 0 && <div className={s.mentions}>@ {c.mentions.join(', ')}</div>}
          </div>
        ))}
      </div>

      <div className={s.composer}>
        <Textarea
          value={body}
          onChange={(_, d) => setBody(d.value)}
          placeholder="Add a comment…"
          data-testid="comment-body"
          resize="vertical"
        />
        {memberOptions.length > 0 && (
          <div>
            <div className={s.mentionLabel}>Mention members (they’ll be notified)</div>
            <TagPicker
              selectedOptions={mentions}
              onOptionSelect={(_, d) => setMentions(d.selectedOptions)}
              data-testid="comment-mentions"
            >
              <TagPickerControl>
                <TagPickerGroup>
                  {mentions.map((m) => (
                    <Tag key={m} value={m} shape="rounded">
                      {m}
                    </Tag>
                  ))}
                </TagPickerGroup>
                <TagPickerInput aria-label="Mention members" />
              </TagPickerControl>
              <TagPickerList>
                {memberOptions
                  .filter((o) => !mentions.includes(o.value))
                  .map((o) => (
                    <TagPickerOption key={o.value} value={o.value}>
                      {o.label}
                    </TagPickerOption>
                  ))}
              </TagPickerList>
            </TagPicker>
          </div>
        )}
        <div className={s.composerRow}>
          <Button appearance="primary" disabled={busy || body.trim() === ''} onClick={post} data-testid="comment-submit">
            {busy ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
