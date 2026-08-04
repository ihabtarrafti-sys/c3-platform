-- 0105_platform_operation_record.sql — D-015 reattribution.
--
-- The durable record of every PLATFORM operation: who acted, who answers for
-- it, what they exercised. Certification item 2 requires that a successful
-- platform operation WRITES BOTH IDENTITIES — the acting principal (what ran)
-- and the accountable owner (who is answerable) — and a log line is not a
-- record: logs rotate, and the accountability standard was ratified as a
-- property of the OPERATION, not of the day it happened to run.
--
-- ⛔ WHY NOT audit_event: its platform shape (0085) deliberately admits exactly
-- ONE tenant-less row form — the erasure straggler event — and widening that
-- CHECK to admit arbitrary platform actions would weaken the two-valued guard
-- that keeps tenant rows and platform rows from blurring. A separate table
-- keeps both constraints narrow.
--
-- The API writes this via the app pool, so c3_app holds INSERT — and ONLY
-- INSERT. It cannot read the history (who holds and exercises platform
-- authority is reconnaissance, same rule as the registry), cannot rewrite it,
-- cannot delete it. Append-only is enforced by grants here rather than by
-- trigger: there is no UPDATE/DELETE grant for ANY runtime role.

CREATE TABLE platform_operation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                 timestamptz NOT NULL DEFAULT now(),
  -- The acting principal, by its registry key (provider, issuer, subject).
  provider           text NOT NULL CHECK (provider IN ('entra')),
  issuer             text NOT NULL,
  subject            text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('service', 'staff')),
  -- ⛔ WHO IS ANSWERABLE — copied from the registry row AT OPERATION TIME, so a
  -- later change of accountable owner cannot rewrite history. '' names nobody.
  accountable_owner  text NOT NULL CHECK (length(btrim(accountable_owner)) > 0),
  -- The capability exercised. Same closed vocabulary as the registry (0104);
  -- vocabularyDrift.test.ts binds this CHECK to PLATFORM_CAPABILITIES too.
  capability         text NOT NULL CHECK (capability IN (
                       'platform.backup_status.read',
                       'platform.erasure_janitor.execute'
                     )),
  -- Aggregate result detail (counts only — the disclosure guard's law applies
  -- to what is WRITTEN as much as to what is served).
  detail             jsonb
);

CREATE INDEX platform_operation_at ON platform_operation (at);

GRANT INSERT ON platform_operation TO c3_app;
REVOKE SELECT, UPDATE, DELETE ON platform_operation FROM c3_app;
-- The auth role resolves principals; it has no business with the history.
REVOKE ALL ON platform_operation FROM c3_auth;

-- ⛔ c3_backup KEEPS ITS SELECT, DELIBERATELY, and stating why matters because
-- the instinct here is wrong. `0006:33` sets ALTER DEFAULT PRIVILEGES granting
-- c3_backup SELECT on every future table, and every migration since has granted
-- it explicitly — so revoking here would take a deliberate exception to the
-- backup posture.
--
-- ⚖️ The accountability record is EXACTLY what must survive a restore. A
-- platform-wide destructive sweep whose record is the one thing not in the
-- backup would leave the operation unattributable after the recovery that
-- operation might have made necessary. c3_backup is read-only and cannot write,
-- own or grant (0006), so including it costs nothing and excluding it would
-- silently narrow what recovery preserves.
GRANT SELECT ON platform_operation TO c3_backup;
