# S10 — Notifications (Layer 2): the bell, dedupe-on-first-crossing, email channel

**Status: BUILT + CERTIFIED (this sprint). Migration 0030.**

## The taxonomy this implements (sealed in the plan of record)

| Layer | What | Where it lives |
|---|---|---|
| L1 | Toasts — ephemeral UX confirmation | client only (existed) |
| L2 | **THIS** — per-user, ack-able attention rows | `notification` table |
| L3 | Record activity | projection of L4 (existed) |
| L4 | Audit stream | sacred, append-only (existed) |
| L5 | Email | **a delivery channel of L2** — never a separate system |

## The law: signals stay derived

"Credential expiring soon" is a **condition becoming true**, not an event. The
situation engine keeps deriving it fresh on every read — S10 stores only
**delivery** (the row) and **acknowledgement** (`read_at`). Nothing else moved
into storage; the cockpit's truth never depends on notification state.

`UNIQUE (tenant_id, user_identity, signal_key)` = **dedupe-on-first-crossing**:
a condition observed a hundred times is one row per recipient, ever. No
notification is ever deleted (no DELETE grant, same as everything else).

## Writers — exactly two

1. **Pipeline fan-out** — inside `appendApprovalEvent`'s transaction (the one
   choke point every governed transition already passes through), atomic with
   the event itself:
   - `Submitted` → every **active owner** except the actor (`member_list()`),
     key `APR-XXXX:Submitted`, "APR-XXXX awaits review".
   - Every later transition → the **submitter**, except when they caused it
     themselves. Key `APR-XXXX:{Status}`.
2. **Crossing sweep** — after the situation engine composes signals on a
   cockpit read: each current signal lands one row per operational recipient
   (active owner + operations). `inMotion` signals are skipped (already being
   handled). Best-effort try/catch — the situation READ stays truthful even if
   delivery fails. No daemon; the sweep rides reads that already happen.

## Email (L5)

- `SMTP_HOST/PORT/USER/PASS/FROM` — **all-or-none**; partial config refuses to
  boot; none → `smtp: null` → rows-only, honestly.
- Dispatch is **post-commit, fire-and-forget** (route layer, after the
  transaction that wrote the row): a mail failure is logged, never breaks the
  operation it narrates.
- **V1 scope: transition emails to the requester only** ("your request moved
  to X"). Submission alerts stay in-app (cockpit + bell) — owners live in the
  cockpit; flooding their mailbox with every submission is noise, not signal.
  **OWNER RATIFIED 2026-07-10: transition-emails-only stays.** Widening remains one small change at the same choke point if ever wanted.

## Read surface

- `GET /api/v1/notifications` → own rows (identity-scoped by construction,
  newest first, cap 100) + `unreadCount`.
- `POST /api/v1/notifications/read` `{signalKey}` / `POST …/read-all` — acks.
- **Bell** in the IdentityBar (all roles): unread badge, matte popover (rows
  are data — data never sits on glass), unread dot, click = acknowledge +
  navigate to the row's link, mark-all-read. 60s poll.

## What S10 deliberately does NOT do

- No new signal kinds — the bell **consumes** the twelve existing checks.
- No per-user notification preferences (Track-B parking lot).
- No websockets/push — 60s polling is honest and sufficient at this scale.
- No submission-alert emails (see V1 scope above — owner decision pending).

## Evidence

- `apps/api/test/notifications.test.ts` — fan-out to owners not actor;
  transitions to submitter not self; sole-owner-self-submit notifies no one;
  sweep dedupe across repeated situation reads; hr excluded from sweep;
  ack/read-all identity-scoped; 401.
- `apps/api/test/env.test.ts` — SMTP all-or-none fail-closed.
- `apps/web/e2e/notifications.spec.ts` — bell badge, ack-on-click + navigate,
  rows survive acks, mark-all-read, requester sees decision narration.
