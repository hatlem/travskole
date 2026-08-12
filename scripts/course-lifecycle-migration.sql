-- Delprosjekt B: anchor_mode på flows (additiv). Kjøres via
-- /api/admin/deploy-migration (SEED_SECRET), FØR kode-deploy.
ALTER TABLE flows ADD COLUMN IF NOT EXISTS anchor_mode TEXT NOT NULL DEFAULT 'contact';
