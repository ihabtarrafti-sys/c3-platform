# The demo-isolation standard (ruled in the Battle-#2 verdict; every future demo inherits it)

A demo is an argument about the product, and its isolation is part of the argument's
truthfulness: a demo that can accidentally touch a shared database can accidentally lie
about where its data came from — or worse, write where it must not.

**Every demo harness (battle demos, exploration sandboxes, seeded walkthroughs) MUST:**

1. **Own its database**: a disposable embedded PostgreSQL, per-run, torn down on exit —
   never a connection string to anything shared (`@c3web/test-support`'s
   `startTestDatabase()` is the house primitive).
2. **REMOVE inherited database env before boot** — do not merely override:
   `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DATABASE_AUTH_URL`, and any `PG*` variables are
   DELETED from the child environment so a mis-ordered override can never fall through to
   an inherited shared target.
3. **Pass an explicit env ALLOWLIST** — the demo process receives the variables it needs
   by name, constructed in the boot script; it never inherits the parent shell wholesale.
4. **Seed through the REAL routes** wherever a route exists; direct spine writes are
   marked `SPINE-DIRECT` in the seed with the reason, and the walkthrough states the
   real/seeded/slate boundary plainly (Law 3b).
5. **Prove renders against ARTIFACTS** (instance 48): capture scripts and demo assertions
   target `data-truth` / `data-testid` / emitted attributes — never prose, which is what a
   feature and its absence have in common.

*(Provenance: pattern from Apex Intel's Battle-#2 demo — adopted as standard in the
verdict; items 4–5 from Zenith's packet and the instance-47/48 lessons.)*
