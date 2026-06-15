-- Migration 003: cache du nombre d'annonces actives du vendeur correspondant au mot-clé.
-- Rempli en arrière-plan par le scraper (vérification du profil Vinted du vendeur).
-- Sert au filtre "Vendeur unique" : seller_item_count <= 1 = vendeur occasionnel.
ALTER TABLE keyword_listings ADD COLUMN IF NOT EXISTS seller_item_count INTEGER;
ALTER TABLE keyword_listings ADD COLUMN IF NOT EXISTS seller_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_kl_seller_item_count ON keyword_listings(seller_item_count);
