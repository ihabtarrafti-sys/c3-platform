# C3 HARDEN 3.7 — Escalation

## J — Post-finalize erasure janitor (`0078`)

### Wall

Batch J cannot satisfy its own bounded-lifetime acceptance under the premise the work order requires us to preserve.

The accepted provider model has no maximum post-abort publication latency (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:9-11`). Batch J nevertheless requires the erasure authority to retire after `sweep_until` (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:57-60,71`) while claiming that a standing janitor detects and destroys every later publication (`C:\Projects\C3-HARDEN-3.7-TRIAGE.md:19-21`). These requirements are incompatible: after retirement, a provider publication permitted by the no-maximum-latency premise has neither a retained prefix record nor a live-tenant route through which the janitor can discover it.

The owner-authored residual register makes the incompatible claim explicit: it says byte lifetime is bounded by cadence plus `JANITOR_WINDOW`, never by provider latency (`C:\Projects\C3-RESIDUAL-RISK-REGISTER.md:34-38`), and that the janitor bounds byte lifetime to the configured window (`C:\Projects\C3-RESIDUAL-RISK-REGISTER.md:58-60`). A legal publication after that window falsifies both statements.

There is a second independent wall: the current repo has no bounded standing invocation cadence for this work. Tenant exit is explicitly owner-run and never automated (`webv0/docs/runbooks/B5-exit-tenant-ceremony.md:4`); the API's production process refuses `DATABASE_ADMIN_URL` (`webv0/apps/api/src/env.ts:130-133`); and the deployed cron is the backup service, whose environment refuses `DATABASE_ADMIN_URL` (`webv0/apps/backup/test/env.test.ts:34-35`). Extending an owner-invocable drain or a deployment drill does not create a time-bounded scheduler.

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
