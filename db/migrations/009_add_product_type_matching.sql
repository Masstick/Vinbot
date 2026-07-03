-- 009_add_product_type_matching.sql
-- Prix moyen par type de produit (mots-clés catégorie-seule).
-- Usage : docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/009_add_product_type_matching.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_key VARCHAR(200);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE keyword_listings ADD COLUMN IF NOT EXISTS deal_score DECIMAL(5,2);

CREATE TABLE IF NOT EXISTS product_type_stats (
  keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  product_type_key  VARCHAR(200) NOT NULL,
  avg_price         DECIMAL(10,2),
  item_count        INTEGER NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword_id, product_type_key)
);

CREATE INDEX IF NOT EXISTS idx_listings_product_type ON listings(product_type_key);
