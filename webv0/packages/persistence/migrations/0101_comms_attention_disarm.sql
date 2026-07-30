-- 0101 — C4: DISARM THE LATENCY SHAPE BEFORE IT EVER HAS A WRITER.
--
-- 0093 shipped `comms_attention` dormant, and it carries BOTH operands of a
-- forbidden derivation: `emitted_at` (when the system spoke) and `read_at`
-- (when the person answered). `read_at - emitted_at` IS a per-person response
-- interval — the exact pattern Guardrail Zero's latency law forbids: no
-- average, ranking, streak, or "usually replies in…" may EVER be derivable.
--
-- ⚠️ AND THE SCHEMA WAS TUNED FOR IT. `comms_attention_inbox` indexed
-- (tenant_id, recipient_user_id, read_at, emitted_at DESC, id) — the forbidden
-- join was not merely possible, it was OPTIMISED. **An index is the schema
-- stating what it expects to be asked; the index is the confession.** So the
-- index is dropped WITH the column: dropping the column alone would leave the
-- intent standing in the schema.
--
-- THE RULING (Neural, 2026-07-30) — the timestamp goes, the read FACT stays:
--   · `read_at` is REPLACED by `read` (boolean). The badge must know IF you
--     read, never WHEN. Attention rows are discrete SIGNALS, so a per-row fact
--     is the right shape; for anything richer, 0094's receipts precedent
--     governs (a cursor + watermark, never per-item times).
--   · `emitted_at` SURVIVES — it is a fact about the SYSTEM's act, not the
--     person's. Latency needs both operands; removing one makes the join
--     IMPOSSIBLE rather than merely unwritten.
--
-- Authored NOW rather than deferred to activation, because the layer is
-- dormant-but-armed and this register has already been bitten once by exactly
-- that shape (instance 7: a table fully armored and never loaded).
--
-- The staging APPLY is the OWNER's, at the next deploy window.
DROP INDEX IF EXISTS comms_attention_inbox;

ALTER TABLE comms_attention DROP COLUMN read_at;
ALTER TABLE comms_attention ADD COLUMN read boolean NOT NULL DEFAULT false;

-- The inbox index, re-created WITHOUT the forbidden operand: it serves the
-- bell's own question ("what is unread for me, newest first") and cannot serve
-- "how fast does this person answer".
CREATE INDEX comms_attention_inbox ON comms_attention (tenant_id, recipient_user_id, read, emitted_at DESC, id);
