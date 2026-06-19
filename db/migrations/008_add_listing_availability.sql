-- 008_add_listing_availability.sql
-- Masquage des annonces vendues/supprimées : on vérifie périodiquement chaque
-- annonce via l'item API Vinted (404 = supprimée, fermée = vendue) et on la masque.
-- Idempotent — aussi appliqué au démarrage par ScraperService.ensureListingSchema().

ALTER TABLE listings ADD COLUMN IF NOT EXISTS unavailable_at TIMESTAMPTZ;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS unavailable_reason VARCHAR(10);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_listings_availability
  ON listings (unavailable_at, availability_checked_at);
