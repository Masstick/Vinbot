-- 010_add_listing_details.sql
-- Description complète + galerie photos, récupérées à la demande (fiche détail).
-- Usage : docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/010_add_listing_details.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS photo_urls TEXT[];
ALTER TABLE listings ADD COLUMN IF NOT EXISTS details_fetched_at TIMESTAMPTZ;
