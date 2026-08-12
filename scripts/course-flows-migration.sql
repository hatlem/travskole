-- Delprosjekt A: kurs-anker på flow_enrollments (additiv).
-- Kjøres FØR koden deployes, via /api/admin/deploy-migration (SEED_SECRET) —
-- DB-en er brannmurslåst utenfra, så vi kjører migreringen fra app-en selv,
-- ikke via ekstern SQL-tilgang. Idempotent-vennlig.

ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS course_id INT NULL;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS registration_id INT NULL;

ALTER TABLE flow_enrollments DROP CONSTRAINT IF EXISTS flow_enrollments_course_id_fkey;
ALTER TABLE flow_enrollments
  ADD CONSTRAINT flow_enrollments_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE flow_enrollments DROP CONSTRAINT IF EXISTS flow_enrollments_registration_id_fkey;
ALTER TABLE flow_enrollments
  ADD CONSTRAINT flow_enrollments_registration_id_fkey
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS flow_enrollments_registration_id_idx ON flow_enrollments (registration_id);
CREATE INDEX IF NOT EXISTS flow_enrollments_course_id_idx ON flow_enrollments (course_id);

-- Maks-én-aktiv: markedsføring (uendret semantikk) scopes nå til registration_id IS NULL.
DROP INDEX IF EXISTS flow_enrollments_one_active;
CREATE UNIQUE INDEX flow_enrollments_one_active
  ON flow_enrollments (flow_id, contact_id)
  WHERE registration_id IS NULL AND status = 'active';

-- Maks-én-aktiv per registrering (kurs-flyter).
CREATE UNIQUE INDEX IF NOT EXISTS flow_enrollments_one_active_reg
  ON flow_enrollments (flow_id, registration_id)
  WHERE registration_id IS NOT NULL AND status = 'active';
