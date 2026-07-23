/**
 * Avatar.tsx — the person headshot on the Tablework frame (pivot W1-1; the
 * Fluent PersonAvatar's logic + testid verbatim).
 *
 * The photo endpoint is bearer-authed, so a raw <img src> would 401. We fetch
 * the bytes with the token, wrap them in an object URL, and revoke it on
 * unmount / change. The fetch only fires when photoUpdatedAt is set, and
 * photoUpdatedAt keys the effect so a replace re-fetches. Fails soft: a
 * failed load falls back to initials.
 */
import { useEffect, useState } from 'react';
import { api } from '../apiClient';

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
      className={`person-avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      data-testid={`person-avatar-${personId}`}
      aria-label={`${name} photo`}
      role="img"
    >
      {url ? <img src={url} alt={`${name} photo`} /> : <span aria-hidden="true">{initialsOf(name)}</span>}
    </span>
  );
}
