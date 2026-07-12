-- 0043_person_photo.sql — Person headshot (Track B tail).
--
-- A single CURRENT avatar per person: the metadata rides four nullable columns
-- on the person row; the bytes live in the SAME private object store as
-- documents (tenant-scoped, server-generated key, never public — always served
-- through the API under the person read gate). Direct-but-audited (operations
-- set / replace / clear, audited on the person trail as PersonPhotoUpdated /
-- PersonPhotoRemoved). Deliberately ORTHOGONAL to person.version: a photo swap
-- is not an identity edit and must never collide with an in-flight governed
-- change, so it neither reads nor bumps the optimistic-concurrency token.
--
-- No RLS or grant change: these are columns on an existing tenant-scoped table
-- whose row policy and table grants already cover them. Replacing a photo
-- leaves the prior blob orphaned-but-retained (the no-DELETE data-plane law) —
-- the row simply points at the new key.
ALTER TABLE person ADD COLUMN photo_storage_key text;
ALTER TABLE person ADD COLUMN photo_content_type text;
ALTER TABLE person ADD COLUMN photo_sha256 text;
ALTER TABLE person ADD COLUMN photo_updated_at timestamptz;
