# C3 HARDEN 3.7 — Escalation

## J — Post-finalize erasure janitor (`0078`)

### Resolution under Neural's ruling (2026-07-15)

Neural conceded both walls and superseded the finite-retirement specification with permanent
authority plus the API as boot/daily/owner scheduler (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:41-75`).
J′ is implemented in commits `b0ae4b9` and `7d09ee0`: migration 0078 has no expiry or
application retirement path, finalize arms it atomically, and the least-privileged API runs the
standing janitor. The original escalation below is retained because its day-8 schedule is the
falsifier that required the ruling; it no longer describes the implementation state.

## J′ cadence-bound claim — CURRENT ESCALATION (2026-07-15)

### Item and stop boundary

The permanent-authority mechanism and the ruling's real day-8 acceptance schedule are built,
RED-discriminated, and GREEN. Only the arithmetic/unqualified lifetime claim is stopped here.
`C3-RESIDUAL-RISK-REGISTER.md` remains Neural-authored and untouched.

### Wall

The amended ruling says that a byte published whenever the provider chooses “cannot survive past
the next janitor pass” and gives the bound as
`max(interval, API downtime) + pass duration`
(`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:65-73`). The protected register repeats that formula and
omits a successful-pass qualifier (`C:\Projects\C3-RESIDUAL-RISK-REGISTER.md:30-43`). No source
defines “API downtime” as anything other than the outage duration.

The formula is false under a legal schedule:

1. Let the configured interval be 24 hours and complete a clean pass at `t=0`.
2. Let the provider publish a byte just after that pass.
3. The API remains up until `t=23h`, then is down for 23 hours—before the `t=24h` timer can fire.
4. Boot catch-up begins around `t=46h` and can destroy the byte only during that pass.

The byte therefore survives about 46 hours plus pass duration, which exceeds
`max(24h, 23h) + pass duration`. Permanent authority prevents expiry, but it cannot erase during
an API outage. The ruling fixes the scheduler to boot + interval + owner in the API process
(`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:55-64`); no in-process change can cover a crash/power-loss
interval while the process is absent.

There are two additional qualifiers the current claim omits. An interval tick overlapping an
active pass is allowed to coalesce with that pass (`webv0/apps/api/src/erasureJanitor.ts:218-228`),
so an object published after its row was visited can wait for a later fresh pass. A caught storage
failure can commit failed telemetry while the transaction remains usable; a storage or database
failure can leave the byte for retry, and the permanent row is never retired
(`webv0/apps/api/src/erasureJanitor.ts:161-178`). Such an unsuccessful pass does not guarantee
destruction. Pass duration itself has no coded numeric ceiling because it depends on row/key
cardinality, pagination, and provider/database response.

### Evidence and required ruling

The day-8 test truthfully proves the accepted concrete schedule: an eight-day-aged object that
exists before a successful owner/boot/interval pass is discovered and destroyed, the catch is
recorded, the authority remains, and live controls are untouched
(`webv0/apps/api/test/erasureJanitor.test.ts:92-224`). It cannot prove the stronger arithmetic
formula or an unqualified next-pass guarantee.

Neural must revise the triage and protected register to an honest conditional envelope (including
the pre-outage interval remainder, outage, active-pass/timer delay, successful-pass duration, and
failed-pass retry), or specify and justify a different definition/enforcement mechanism that makes
the existing formula true. Temper cannot edit the protected register or silently redefine its
terms. Per the charter's escalate-not-improvise law
(`C:\Projects\C3-APEX-TEMPER-CHARTER.md:53-64`), the bound claim stops here while all runnable
focused/gate/e2e verification continues. That verification subsequently completed GREEN and is
recorded without resolving or hiding this wall in `C3-HARDEN-3.7-STATUS.md`.

## Original J finite-retirement escalation — HISTORICAL

### Wall

Batch J cannot satisfy its own bounded-lifetime acceptance under the premise the work order requires us to preserve.

The accepted provider model has no maximum post-abort publication latency (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:9-11`). The superseded Batch J text nevertheless required the authority to retire after `sweep_until` and called that lifetime bounded (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:83-107`) while the reframe required a standing janitor to detect and destroy every later publication (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:19-21`). Those requirements were incompatible: after retirement, a provider publication permitted by the no-maximum-latency premise had neither a retained prefix record nor a live-tenant route through which the janitor could discover it.

That contradiction was present in the superseded triage itself; Neural has since rewritten the
protected residual register for permanent authority, so the current register is not cited as
evidence for this historical finite-window wall.

There was a second independent wall: the repo then had no bounded standing invocation cadence for this work. Tenant exit was explicitly owner-run and never automated (`webv0/docs/runbooks/B5-exit-tenant-ceremony.md:4`); the API's production process refused `DATABASE_ADMIN_URL` (`webv0/apps/api/src/env.ts:135-140`); and the deployed cron was the backup service, whose environment refused `DATABASE_ADMIN_URL` (`webv0/apps/backup/test/env.test.ts:34-35`). Extending an owner-invocable drain or a deployment drill did not create a time-bounded scheduler.

### Discriminating schedule

1. Finalize tenant erasure at `t0`; write the proposed prefix record with `sweep_until = t0 + 7 days`.
2. Run every required janitor pass through `sweep_until`; both prefixes are empty.
3. Retire the record as Batch J requires.
4. At `t0 + 8 days`, let the provider publish a previously accepted PUT. This is legal under the work order's no-maximum-latency premise.
5. The object persists: no `erased_tenant_prefix` row remains, the tenant is erased, and no bounded scheduler is present to enumerate the retired prefix.

No test double can make this schedule green without adding a provider upper bound, retaining authority beyond the configured window, or weakening the claimed lifetime bound.

### Required ruling

Neural must revise at least one side of the contract before J is implementable truthfully:

- retain erasure authority indefinitely (or until a provider-backed maximum publication bound has elapsed) and specify an actually bounded invocation mechanism; or
- keep finite retirement but state the post-window publication residual honestly, removing the claims that byte lifetime is bounded by `JANITOR_WINDOW` and independent of provider latency.

Per the charter, implementation of J and migration `0078` stops here. U1–U8 and the evidence/status work continue; this file does not modify `C3-RESIDUAL-RISK-REGISTER.md`.

**Historical scope:** that stop applied to the superseded finite-retirement work order. Neural's
ruling authorized J′ and resolved this historical escalation without changing the original
analysis. The separate current cadence-arithmetic escalation above is not resolved by that ruling.
