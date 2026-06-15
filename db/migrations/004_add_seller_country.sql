-- Migration 004: pays réel du vendeur (depuis son profil Vinted), pour le filtre pays.
-- country_code stockait le domaine scrapé (fr) et non le pays du vendeur : une annonce
-- d'un vendeur ES/DE/IT visible sur vinted.fr se retrouvait taguée 'fr'.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS seller_country VARCHAR(5);
CREATE INDEX IF NOT EXISTS idx_listings_seller_country ON listings(seller_country);
