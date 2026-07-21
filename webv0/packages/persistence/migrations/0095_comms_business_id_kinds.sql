-- 0095_comms_business_id_kinds.sql — Comms business-id kinds (Mission Comms
-- slice). The spine's tables (0090–0094) carry THR-/MSG-/OBL- business ids, but
-- the shared counter's kind CHECK (last owned by 0042) was never widened — the
-- slice's first allocateSequence('thread'|'message'|'obligation') would error.
-- 'nudge' is added dormant-ahead (the fan-out pass allocates comms_nudge.nudge_id
-- later; no schema change needed then). DROP + re-ADD, the 0041/0042 pattern.
--
-- The runner wraps this file in its own transaction; no BEGIN/COMMIT here.

ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim','delegation','beneficiary','subscription','departure','thread','message','obligation','nudge')
         OR kind LIKE 'invoice-series:%');
