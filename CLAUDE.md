# c3-fable — Apex Zenith working agreement

Zenith is the sole build pen for this repo. Work happens in `webv0/`.

---

## ⚖️ END-OF-RUN REPORTING — standing law (owner-approved 2026-07-25)

**At the end of EVERY run — not every milestone — do both:**

1. **Update the Zenith block in `C:\Projects\C3-LANE-BOARD.md`** (deliberately outside this
   repo, so it never touches the pen).
2. **Message Apex Neural** via `mcp__ccd_session_mgmt__send_message`.

   > ⛔ **NEVER hardcode a session id — resolve it at send time.** Ids are
   > **per-session, not per-lane**: a lane's id dies when that session ends and a new one
   > is minted on restart. Resolve by `list_sessions` → the entry whose title is that
   > lane's name with the most recent `lastActivityAt`, confirmed via `get_session`; or
   > take the `from` id on that lane's most recent message.
   >
   > **If no live session for the lane exists, do not send — write to the board.**
   >
   > *Both failure modes are real, both seen 2026-07-25:* the id
   > `local_08b6c099-…` handed over in an instruction **did not resolve at all**
   > (derived from a path), and a verified working id was then written down as if it were
   > permanent. `SendMessage` is the agent-team tool and does **not** do cross-session
   > delivery — its `to` takes a teammate name.

**The board is STATE, the message is NOTIFICATION.** Messages die with the session and do
not survive compaction; the board does. **Anything that must outlive today goes in the
board**, not only in a message.

### The five fields

| Field | Rule |
|---|---|
| **Tip** | SHA + branch + pushed? |
| **Landed** | what actually changed |
| **Verdicts** | gate/e2e **and which run produced them** |
| **Next** | the immediate next action |
| **BLOCKED ON** | **mandatory, never blank.** `—` means genuinely nothing. Name the party. |

**Field 5 exists because of a real failure:** rulings were sent, this pen parked waiting,
and Neural reported "on Wave 2" — inferred from what it had dispatched, never verified. No
field anywhere said *blocked*. If you are waiting on someone, that must be visible without
either party thinking to ask.

**Verdicts must never merge two runs into one claim.** If gate ×2 came from a re-run and
e2e from an earlier run on an identical tree, say exactly that. The completion signal must
BE the verdict.

### Reading a verdict — TWO facts, never one

**Never grep for `PASSED`.** It matches `✓` test-output lines and reports a verdict that
does not exist *(this produced a false "gate 1 PASSED" in the first packet under this
protocol, 2026-07-25 — same shape as the `&&`-chained gate that reported exit 0 while both
runs failed)*.

But the symmetric error is worse: **absence of a verdict is THREE states in one costume** —
still running · finished and FAILED · **crashed/killed before printing anything.** Treating
absence as "not done yet" means waiting forever on a corpse; a gate that died at minute 3
looks identical to one working at minute 30.

**So always read both:**

1. **Has the process exited?** The authoritative signal is the task-completion
   notification (or an explicit exit code) — not a process count, which cannot tell your
   run from anyone else's.
2. **Which verdict line is present?** Grep the **prefix** `webv0 gate:` so `FAILED` is
   captured in the same read as `PASSED`. Then read the file's **tail** — a crash leaves
   its fingerprint there and leaves nothing in a count.

| Process | Verdict line | Means |
|---|---|---|
| alive | none | running |
| exited | `PASSED` | passed |
| exited | `FAILED` | failed |
| **exited** | **none** | **crashed — a hard finding, not a retry** |

**Do the verdict read at the START of the reporting step**, while it still gets real
attention. This failure isn't ignorance — it's what tired shortcuts look like at the end of
a long run, so the discipline has to survive the moment you're least able to supply it.

**Neural replies only when there is decision content. Silence means "nothing to decide,
proceed"** — do not wait on an acknowledgment. (The asymmetry is deliberate: two agents
that each wake the other on every message ping-pong forever with the owner out of the loop.)

**If this reporting ever starts distorting the work** — padding turns, or tempting an early
stop just to report — say so and retune it. A protocol that changes the work to serve the
protocol is worse than the gap it closes.

---

## ⚖️ THE DOMINANT FAILURE MODE — read this one first

**The mechanism keeps succeeding while quietly doing less. Green never wavers.**

Five instances in one arc, every one invisible to every signal we normally trust:

1. An `&&`-chained gate reported **exit 0 while both runs failed**.
2. A ceremony clean-tree guard would have **printed nothing while checking nothing**.
3. The CI Frozen-SharePoint guard **passed against a deleted pathspec** — unmatched
   pathspec, no diff, exit 0, guarding two fewer paths than it claimed.
4. A `testId` → `data-testid` prop rename would have **compiled cleanly while silently
   renaming three oracle-pinned testids**.
5. `grep -c 'PASSED|passed'` **reported a verdict that did not exist**.

None of these fail. They succeed at less than they claim. Tests stay green, exit codes stay
0, the diff looks right.

**The habit that catches it: ask what the mechanism DOES, not whether it FAILS.** Then go
look at the destination — the rendered element, the live URL, the built artifact, the actual
file — because the only reliable evidence is the effect, never the report of the effect.

## The standing laws this repo is built on

- **Verify the effect at its destination, never the action's own report.** Deploy → probe
  the live URL. Build → inspect the artifact. A DOM/CSS prop → read the *rendered* element's
  computed style. A test or guard → RED-verify it fails when its guard is broken.
  Cross-session state → transition in-app, never via reload (a reload remounts the tree and
  makes a broken build look fixed).
- **A check whose passing state is an ABSENCE needs a companion proving the observation
  happened at all.** "The term isn't in the logs" is satisfied equally by a working mask and
  by a request that never arrived.
- **A guard that cries wolf gets rationalized.** Encode a known-benign recurring condition
  INTO the guard — enumerated and bounded — never leave it for a reader to adjudicate.
- **Commands in a runbook must be verified, not recalled — and verified in the shell the
  OWNER will run them in.** PowerShell 5.1 aliases `curl`/`wget`/`ls`/`rm` over the real
  binaries; PowerShell 7 does not. Prefer the unambiguous form (`curl.exe`).
- **Behavior-frozen:** testids and pinned copy byte-identical. The e2e suite is the ORACLE.
  A spec addition routes through Neural under the spec-freeze law.
- **Gate ×2 + e2e on the exact pushed tree.** Owner runs every deploy. Migrations immutable
  from 0087.
- **Money:** a parser may be replaced only when the replacement's zero-policy AND output
  order are identical; otherwise leave it and comment why. Per-row guards belong at the CALL
  SITE.
- **Undefined CSS `var()` fails silently.** Verify a token is defined before using it.

## Known intermittent

`webv0/apps/backup/test/censusSnapshot.test.ts` can emit an unhandled `57014`
(`canceling statement due to user request`) *after* its test completes, failing the gate
while **all tests pass**. If the gate reds there with zero test failures, that is the flake
— rerun once and report it. **Never silence it with a stray `.catch`**: muting an
intermittent failure in the instrument every verdict depends on is strictly worse than
leaving it visible.
