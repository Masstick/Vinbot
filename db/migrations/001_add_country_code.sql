-- Migration 001: Add country_code to listings and country_codes to keywords
-- Safe to run multiple times (IF NOT EXISTS / idempotent checks)

ALTER TABLE listings ADD COLUMN IF NOT EXISTS country_code VARCHAR(5) DEFAULT 'fr';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS country_codes TEXT DEFAULT 'fr';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS catalog_id INTEGER;
