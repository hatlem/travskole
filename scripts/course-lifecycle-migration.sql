-- Delprosjekt B: anchor_mode på flows (additiv). Basefarm, FØR kode-deploy.
ALTER TABLE flows ADD COLUMN IF NOT EXISTS anchor_mode TEXT NOT NULL DEFAULT 'contact';
