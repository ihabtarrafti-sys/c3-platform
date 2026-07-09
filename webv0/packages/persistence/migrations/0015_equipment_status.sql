-- 0015_equipment_status.sql - D-7 (2026-07-09): the Kit & Apparel fulfillment
-- status lifecycle. A direct-audited state machine DISTINCT from is_active
-- (which retires the record): an item moves Received → InProgress →
-- ReadyForShipment → InTransit → Delivered → Done, may pause OnHold, or be
-- Rejected. New and existing rows default to 'Received'. State-machine legality
-- is enforced in the domain/use-case; the CHECK guards the value set only.

ALTER TABLE kit ADD COLUMN status text NOT NULL DEFAULT 'Received';
ALTER TABLE kit ADD CONSTRAINT kit_status_check
  CHECK (status IN ('Received','InProgress','OnHold','ReadyForShipment','InTransit','Delivered','Done','Rejected'));

ALTER TABLE apparel ADD COLUMN status text NOT NULL DEFAULT 'Received';
ALTER TABLE apparel ADD CONSTRAINT apparel_status_check
  CHECK (status IN ('Received','InProgress','OnHold','ReadyForShipment','InTransit','Delivered','Done','Rejected'));
