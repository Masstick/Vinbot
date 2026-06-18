CREATE TABLE IF NOT EXISTS keywords (
  id                    SERIAL PRIMARY KEY,
  label                 VARCHAR(255) NOT NULL,
  search_text           VARCHAR(500) NOT NULL,
  min_price             DECIMAL(10,2),
  max_price             DECIMAL(10,2),
  category              VARCHAR(100),
  catalog_id            INTEGER,
  country_codes         TEXT DEFAULT 'fr',
  scan_interval_seconds INTEGER DEFAULT 120,
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id              SERIAL PRIMARY KEY,
  vinted_id       BIGINT UNIQUE NOT NULL,
  title           VARCHAR(500),
  price           DECIMAL(10,2),
  url             TEXT,
  photo_url       TEXT,
  brand           VARCHAR(255),
  size_label      VARCHAR(100),
  condition_label VARCHAR(100),
  seller_name     VARCHAR(255),
  seller_id       BIGINT,
  country_code    VARCHAR(5) DEFAULT 'fr',
  seller_country  VARCHAR(5),
  view_count      INTEGER,
  favourite_count INTEGER,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  vinted_created_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS keyword_listings (
  keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  listing_id        INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  matched_at        TIMESTAMPTZ DEFAULT NOW(),
  seller_item_count INTEGER,
  seller_checked_at TIMESTAMPTZ,
  PRIMARY KEY (keyword_id, listing_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id          SERIAL PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price       DECIMAL(10,2) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications_log (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  keyword_id INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);

-- État runtime du scraper (singleton). Permet de mettre en pause / relancer
-- les scans périodiques de façon persistante (survit aux redémarrages).
-- Note : la table est aussi créée à la volée au démarrage du backend
-- (ScraperService.loadPausedState) pour les bases déjà en place.
CREATE TABLE IF NOT EXISTS scraper_state (
  id         INT PRIMARY KEY DEFAULT 1,
  paused     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scraper_state_singleton CHECK (id = 1)
);
INSERT INTO scraper_state (id, paused) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_listings_vinted_id ON listings(vinted_id);
CREATE INDEX IF NOT EXISTS idx_price_history_listing_id ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_kl_keyword_id ON keyword_listings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_notifications_log ON notifications_log(listing_id, keyword_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_listings_vinted_created_at ON listings(vinted_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kl_seller_item_count ON keyword_listings(seller_item_count);
CREATE INDEX IF NOT EXISTS idx_listings_seller_country ON listings(seller_country);
