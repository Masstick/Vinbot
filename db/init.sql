CREATE TABLE IF NOT EXISTS keywords (
  id                    SERIAL PRIMARY KEY,
  label                 VARCHAR(255) NOT NULL,
  search_text           VARCHAR(500) NOT NULL,
  min_price             DECIMAL(10,2),
  max_price             DECIMAL(10,2),
  target_margin         DECIMAL(10,2) DEFAULT 10,
  shipping_estimate     DECIMAL(10,2) DEFAULT 4,
  category              VARCHAR(100),
  catalog_id            INTEGER,
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
  view_count      INTEGER,
  favourite_count INTEGER,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS keyword_listings (
  keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  listing_id        INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  deal_score        DECIMAL(5,2),
  market_avg        DECIMAL(10,2),
  potential_profit  DECIMAL(10,2),
  matched_at        TIMESTAMPTZ DEFAULT NOW(),
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

CREATE INDEX IF NOT EXISTS idx_listings_vinted_id ON listings(vinted_id);
CREATE INDEX IF NOT EXISTS idx_price_history_listing_id ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_kl_keyword_id ON keyword_listings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_kl_deal_score ON keyword_listings(deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_log ON notifications_log(listing_id, keyword_id, sent_at);

-- ── Mistral Deal Intelligence ─────────────────────────────────────────────

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS model_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS model_confidence DECIMAL(3,2);

ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS market_scan_pages INTEGER DEFAULT 5;

CREATE TABLE IF NOT EXISTS deal_analyses (
  id             SERIAL PRIMARY KEY,
  listing_id     INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  keyword_id     INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  scam_risk      VARCHAR(10) NOT NULL,
  confidence     DECIMAL(3,2),
  recommendation VARCHAR(10) NOT NULL,
  reasoning      TEXT,
  analyzed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_market_avg (
  keyword_id   INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  model_label  VARCHAR(200) NOT NULL,
  avg_price    DECIMAL(10,2),
  item_count   INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (keyword_id, model_label)
);

ALTER TABLE keyword_listings
  ADD COLUMN IF NOT EXISTS model_market_avg DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS analysis_id INTEGER REFERENCES deal_analyses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_da_listing ON deal_analyses(listing_id);
CREATE INDEX IF NOT EXISTS idx_da_recommendation ON deal_analyses(recommendation, scam_risk);
CREATE UNIQUE INDEX IF NOT EXISTS idx_da_unique_listing_keyword ON deal_analyses(listing_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_mma_keyword ON model_market_avg(keyword_id);
