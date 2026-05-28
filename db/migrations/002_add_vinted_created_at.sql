-- Migration 002: add Vinted publication date to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vinted_created_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_listings_vinted_created_at ON listings(vinted_created_at DESC);
