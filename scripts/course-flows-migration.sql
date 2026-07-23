-- Delprosjekt A: kurs-anker på flow_enrollments (additiv).
-- Kjøres av Basefarm mot prod FØR koden deployes. Idempotent-vennlig.

ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS course_id INT NULL;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS registration_id INT NULL;

DO $$ BEGIN
  ALTER TABLE flow_enrollments
    ADD CONSTRAINT flow_enrollments_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE flow_enrollments
    ADD CONSTRAINT flow_enrollments_registration_id_fkey
    FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
