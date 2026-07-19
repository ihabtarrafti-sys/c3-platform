import { useEffect, useState } from 'react';
import { makeStyles } from '@fluentui/react-components';
import { api } from '../apiClient';

/**
 * PersonAvatar — the person headshot, or initials when there is none.
 *
 * The photo endpoint is bearer-authed, so a raw <img src> would 401. We fetch
 * the bytes with the token, wrap them in an object URL, and revoke it on
 * unmount / change. The fetch only fires when photoUpdatedAt is set (people
 * without a photo never hit the network), and photoUpdatedAt keys the effect so
 * a replace re-fetches. Fails soft: a failed load falls back to initials.
 */

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'var(--c3-surface-elevated, rgba(255,255,255,0.06))',
    border: '1px solid var(--c3-border-subtle, rgba(255,255,255,0.12))',
    color: 'var(--c3-ink-quiet)',
    fontWeight: 600,
    userSelect: 'none',
    lineHeight: 1,
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
});

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export function PersonAvatar({
  personId,
  photoUpdatedAt,
  name,
  size = 40,
  className,
}: {
  personId: string;
  photoUpdatedAt: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const s = useStyles();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoUpdatedAt) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .getPersonPhoto(personId)
      .then(({ blob }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [personId, photoUpdatedAt]);

  return (
    <span
      className={`${s.root}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      data-testid={`person-avatar-${personId}`}
      aria-label={`${name} photo`}
      role="img"
    >
      {url ? <img className={s.img} src={url} alt={`${name} photo`} /> : <span aria-hidden="true">{initialsOf(name)}</span>}
    </span>
  );
}
