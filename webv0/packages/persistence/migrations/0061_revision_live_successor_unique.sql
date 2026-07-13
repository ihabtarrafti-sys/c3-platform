-- 0061_revision_live_successor_unique — HARDEN-3.2 Batch B (R3-N03).
--
-- M-06's outbox had one intent per source (0058) but NO DB guard against two live
-- SUCCESSORS: two revision drainers could each probe (find no successor), each dispatch
-- the op's real submit, and both stamp revision_of = source — forking the chain. The
-- app-level probe is a TOCTOU with nothing enforcing the invariant at the DB.
--
-- Enforce it where it cannot be raced: at most ONE non-Withdrawn approval per
-- (tenant, revision_of). A losing drainer's second submit now fails at the DB (23505);
-- it re-probes, finds the winner's successor, and no-ops. Withdrawn successors are
-- excluded so an abandoned/retired earlier attempt never blocks the real one.
CREATE UNIQUE INDEX approval_one_live_successor
  ON approval (tenant_id, revision_of)
  WHERE revision_of IS NOT NULL AND status <> 'Withdrawn';
