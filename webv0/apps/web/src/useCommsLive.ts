/**
 * useCommsLive — Phase B-LIVE (client): the live channel as a React resource.
 *
 * Composes with Phase A rather than fighting it: the connection's health is a
 * FACT the region's witness state must account for. This hook exposes that
 * fact; the pages fold it into `truthStateOf` so a dropped stream renders
 * `stale` with its last-confirmed time instead of presenting old rows as
 * current (instance 21 with a socket attached is still instance 21).
 *
 * ⛔ LAW 5: a toast is not a receipt. This hook never advances a cursor, never
 * marks attention, and never reports back that something was seen — it only
 * invalidates the queries that then RE-READ through the ordinary gated paths.
 * ⛔ LAW 2: nothing here is timed or recorded, so no delivery→read interval
 * exists for anyone to rank later.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openCommsLive, type CommsLivePush, type CommsLiveState } from './commsLiveClient';
import { authClient } from './auth';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';

export interface LiveArrival extends CommsLivePush {
  /** Client-local id for the toast list; never sent anywhere. */
  readonly key: string;
}

export interface CommsLiveResource {
  readonly state: CommsLiveState;
  readonly arrivals: LiveArrival[];
  readonly dismiss: (key: string) => void;
  readonly clear: () => void;
}

export function useCommsLive(enabled: boolean): CommsLiveResource {
  const qc = useQueryClient();
  const [state, setState] = useState<CommsLiveState>({ healthy: false, lastConfirmedAt: null });
  const [arrivals, setArrivals] = useState<LiveArrival[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const stop = openCommsLive(API_BASE, () => authClient.getAccessToken(), {
      onPush: (push) => {
        // Idempotent by messageId: a reconnect that replays must not double a
        // toast, and the record is the source of truth either way.
        if (seen.current.has(push.messageId)) return;
        seen.current.add(push.messageId);
        setArrivals((prev) => [...prev, { ...push, key: push.messageId }].slice(-4));
        // The push is a SIGNAL, not the content: the region re-reads through
        // the ordinary gated query rather than trusting the frame.
        void qc.invalidateQueries({ queryKey: ['commsRoom', push.threadId] });
        void qc.invalidateQueries({ queryKey: ['commsThread'] });
        void qc.invalidateQueries({ queryKey: ['commsLedger'] });
      },
      onReconnect: () => {
        // RE-WITNESS: a resumed stream proves the connection, not the content.
        void qc.invalidateQueries({ queryKey: ['commsRoom'] });
        void qc.invalidateQueries({ queryKey: ['commsThread'] });
        void qc.invalidateQueries({ queryKey: ['commsLedger'] });
      },
      onState: setState,
    });
    return stop;
  }, [enabled, qc]);

  return useMemo(
    () => ({
      state,
      arrivals,
      dismiss: (key: string) => setArrivals((prev) => prev.filter((a) => a.key !== key)),
      clear: () => setArrivals([]),
    }),
    [state, arrivals],
  );
}

/**
 * Play the arrival sound, honestly. Browsers block audio before a user
 * gesture, so a rejected play is REPORTED rather than swallowed: a preference
 * that claims to be on while nothing sounds is exactly the lie Phase A
 * forbids. Returns whether the browser actually permitted it.
 */
export async function playArrivalSound(): Promise<boolean> {
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!Ctx) return false;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') {
      // Not yet permitted by a gesture — say so instead of pretending.
      await ctx.close().catch(() => {});
      return false;
    }
    // A short, quiet two-tone chime built in-place: no asset to ship, no
    // network fetch, nothing to fail silently at load time.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => void ctx.close().catch(() => {}), 400);
    return true;
  } catch {
    return false;
  }
}
