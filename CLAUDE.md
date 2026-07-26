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

### ⚠️ THE GATE BASELINE — and why the old one was wrong

**⛔ THERE IS NO HEALTHY BASELINE RIGHT NOW. Do not quote one.** (Ruled 2026-07-26.) What
exists is an **observed range** and a list of **unseparated candidates**:

| Observation | Test phase | Conditions |
|---|---|---|
| Lane C (was called "the baseline") | 488.26s · 483.48s | one run, conditions unrecorded |
| F01/F09/F10 | 482.16s · 512.98s | — |
| Tier 1 | 585.83s · 543.92s | **34 PG orphans resident** |
| Tier 2 | 554.68s · 533.98s | **0 orphans at start** (paired measurement) |
| B1 | 524.91s · **482.86s** | same machine, same day |
| Tier 3 · cluster A | **451.41s** · **448.41s** | same machine, same day |

**The orphan hypothesis is FALSIFIED**: sweeping to zero produced 554.68s, *inside* the
contaminated range. The leak is a real defect and **not** this cause.

**⚑ AND THE SPREAD ITSELF IS THE ANSWER.** Runs in one day on one machine span
**451.41s → 585.83s**, with no orphan correlation — and **486s, the figure once called "the
baseline," sits in the MIDDLE of that spread, not at its floor.** It was never a healthy
state that later degraded; it was one draw from a wide distribution, and later runs went
*faster* than it. A single run cannot distinguish "fast machine" from "lucky draw," which is
exactly why one run cannot set a standard. **Judge a gate against the RANGE, and treat any
single number — high or low — as one sample.**

> **⚠️ Each new run goes in the table, especially a new extreme.** A range recorded once and
> never extended becomes the same false standard by a slower route — 451.41s would have read
> as "suspiciously fast" against a table that stopped at 482.

> **⚠️ THE 486s FIGURE WAS DEMOTED FROM BASELINE TO A SINGLE OBSERVATION**, because it was
> exactly the mistake it replaced. The 1,038s baseline was suspect for being *one run someone
> recorded and called healthy* — and its replacement was **one Lane C run recorded and called
> healthy.** The correction was right; the replacement repeated the error one level over.
>
> **A BASELINE REQUIRES MULTIPLE RUNS UNDER STATED CONDITIONS — never the best number seen.**
> A single favourable observation promoted to "standard" pre-silences the alarm for every
> comparison made against it. **Do not accept a single-run number as a standard, from anyone,
> including a lane lead who hands you one.**

**Record machine conditions with every verdict**, in this form — never a CPU percentage:

    credentialsV2 11.91s [healthy 12.7 | slow 33.4] · CPU bench 316ms · 0 postgres · 0 orphans

**An aggregate system metric is WEAK evidence; a known workload against its own known
baseline is STRONG evidence.** `Win32_Processor.LoadPercentage` reported 65% while
per-process measurement showed 3% of 32 cores; a `head -8` process count was the truncation
limit, not a measurement. **Run the strong measurement FIRST** — it was available the whole
time and got run last.

### Route relocations: verify with `matchRoutes`, never by reasoning

Moving a route out of the `AppShell` children is not obviously safe. `/missions/finance`
sits AFTER `/missions/:missionId` in the array — if react-router matched by ORDER rather
than specificity, finance would silently render **the mission detail page**: a real page,
with real data, at a real-looking URL. **Nothing goes red and a human smoke test very likely
passes it.** Ten seconds with `matchRoutes` converts the assumption into a fact.

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

**The mechanism keeps succeeding while quietly doing less. Green never wavers.** None of
these *fail*. They succeed at less than they claim — tests green, exit code 0, diff looks
right.

**The habit that catches it: ask what the mechanism DOES, not whether it FAILS.** Then look
at the destination — the rendered element, the live URL, the built artifact, the actual file
— because the only reliable evidence is the effect, never the report of the effect.

**⚑ When you assert a guarantee, LIST THE CONSUMERS YOU CHECKED.** Naming a guarantee is
not verifying it: identify every consumer that must honour it, then check each one and say
which. **An empty list means the check did not happen** — without the artifact, skipping
the verification produces a report identical to performing it, which makes it decoration.
*(Worked example: the `RecordLink` fix listed computed font-family, colour and weight on the
rendered anchor, plus the body font as a negative control proving the rule applied rather
than was inherited.)*

### A marker records the gap you HIT, not the divergence you INTRODUCED

**Marker discipline is load-bearing and structurally blind to workaround divergence.** Seven
sites recorded "the kit has no row-action class." **Not one recorded "and I picked an
alignment."** Four hand-rolled flex-start; three borrowed `.message-actions` for its missing
margin and silently inherited `justify-content: flex-end`. The same actions column shipped
left-aligned on some registers and right-aligned on others — **an inconsistency no marker
mentioned, because each lane wrote down the gap it noticed and not the one it created.**

> **So a gap sweep must DIFF THE WORKAROUNDS AGAINST EACH OTHER, not just count the markers.**
> Counting markers finds the gaps; comparing the workarounds finds the divergence — and the
> divergence is what actually shipped to users.

**Corollary: closing a gap means CONVERGING the existing answers, never adding a third.**
Where two live workarounds disagree, pick one, state why, and migrate both — leaving a
"correct" new primitive beside two surviving divergent workarounds makes it three.

### Bulk text surgery: match exactly, or don't do it

**Never edit source by scanning for a start marker and deleting to the next landmark.** A
span defined by "from here to the next `options={`" is unbounded when the landmark is far
away, and a sanity guard *inside* that span (`if 'Selector' not in segment: break`) passes
vacuously precisely because the span grew too wide to be wrong about. That deleted **321
lines** of `AgreementsPage.tsx` in one pass on 2026-07-26. Use exact-match replacement of a
literal block, assert it applies **exactly once**, and let ambiguity be an error.

**⚑ And the part worth keeping: what caught it was an EXPECTED COUNT, not an absence check.**
The script reported `markers left: 0`, which reads as complete success — the damage was
visible only because the correct answer was **2** (that file had two non-Selector markers
that had to survive). *A "0 remaining" is indistinguishable from over-deletion.* So when
removing a subset of anything, state the expected survivor count BEFORE the edit and check
against that number — never against zero, and never against "did it error".

> **The running tally of instances lives in `C:\Projects\C3-LANE-BOARD.md`, and NOWHERE
> else — including here.** Full law set: **`C:\Projects\C3-APEX-LAWS.md`** (grouped by when
> each law fires).
>
> A count is VOLATILE; a law is STABLE. Embedding the first in the second rots the document
> while it still reads as authoritative — this file once said "five instances" while the
> board said ten, from identical evidence, hours apart. **Stable text may live in several
> places; volatile state lives in exactly one.**

## Laws specific to THIS repo

> The general Apex laws — verify-at-destination, absence-needs-a-companion, a guard that
> cries wolf, corrections-in-place, the send rules — live in **`C:\Projects\C3-APEX-LAWS.md`**,
> grouped by when they fire. They are not duplicated here. What follows is only what is
> true of `c3-fable` specifically and would be lost as a pointer.

- **Behavior-frozen:** testids and pinned copy byte-identical. The e2e suite is the ORACLE.
  A spec addition routes through Neural under the spec-freeze law.
- **Gate ×2 + e2e on the exact pushed tree.** Owner runs every deploy. Migrations immutable
  from 0087.
- **Money:** a parser may be replaced only when the replacement's zero-policy AND output
  order are identical; otherwise leave it and comment why. Per-row guards belong at the CALL
  SITE — `orgBps` legitimately accepts 0 while each share row must be `> 0`.
- **⚖️ THE MONEY LAYERING RULE (Neural, 2026-07-26): the DOMAIN parses; the KIT names the
  policy; the CALL SITE chooses.** `parseDecimalToMinor` makes no policy choice — it answers
  *"can this string become minor units?"* and returns `null` for malformed. **Zero is a valid
  parse RESULT there, not a policy decision**, so it is deliberately NOT named
  `…AllowingZero`: naming it so would make the machinery lie about what it decides. **A KIT
  export, by contrast, must state its zero policy in its name** — that is the layer whose job
  is to be explicit at the call site. Do not push policy vocabulary down into machinery.
- **Undefined CSS `var()` fails silently.** Verify a token is defined before using it.
- **`.mono` styles the CELL** (`td.mono` / `dd.mono`), never an anchor. Use the kit
  `RecordLink`; a hand-rolled `<Link className="mono">` renders in the body font.
- **Deploy runbooks: verify every command in the shell the OWNER runs it in.** PowerShell
  5.1 aliases `curl`/`wget`/`ls`/`rm` over the real binaries; PowerShell 7 does not. Prefer
  the unambiguous form (`curl.exe`). A ceremony has no battery behind it — the reader is the
  gate.

## ⚠️ A TEST COMPLETES BEFORE ITS WORK DOES — open, not a "flake"

`webv0/apps/backup/test/censusSnapshot.test.ts` intermittently emits an unhandled `57014`
(`canceling statement due to user request`) **after its test has returned**, failing the
gate while **all 1011 tests pass**.

**Do not file this as flakiness.** `57014` is Postgres `query_canceled`, so a query was
**still in flight when the test finished** and was cancelled during teardown. That means a
test returns before its own work is done: **the green comes first, the work is still
running after.** It is the same failure mode as everything else in the register — the
mechanism succeeding while quietly doing less — except located in the instrument that
certifies all the others.

- **NEVER silence it with a stray `.catch`.** That would hide a missing `await` and make
  "all 1011 pass" mean even less than it currently does.
- **Do not** drain the pool harder, extend a timeout, or swallow the rejection. Each
  converts a loud correctness signal into a quiet one.
- **Fix the await**: find which query outlives which test.
- If the gate reds here with **zero test failures**, rerun once and report — but report it
  as *"a test completes before its work does, cause not yet localized"*, never as "a flake."

**Known and separate** — `censusSnapshot:155-158` races `pauseOpened` against a
`setTimeout` that **rejects**. `Promise.race` does not cancel the loser, so that timeout
fires after the test returns with nothing attached. Bounded search: every other
`Promise.race` loser in the suite *resolves* (the safe idiom), so this leak is isolated to
this one site. It throws an `Error`, not `57014`, so it is **not** the cause of the above.
