-- Tables côté VENTE (fondation auth + bloc A stock). Idempotent : exécutable
-- aussi bien sur une base neuve (via init.sql qui l'inclut) que sur une base
-- existante (exécution manuelle, voir CLAUDE.md — NE PAS recréer le volume).

CREATE TABLE IF NOT EXISTS vinted_accounts (
  id              SERIAL PRIMARY KEY,
  label           VARCHAR(100) NOT NULL,
  vinted_user_id  BIGINT,
  session_data    TEXT,                 -- JSON chiffré (AES-256-GCM) : cookies + storageState
  status          VARCHAR(20) NOT NULL DEFAULT 'disconnected', -- connected|expired|disconnected
  connected_at    TIMESTAMPTZ,
  last_refresh_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  title           VARCHAR(500),
  brand           VARCHAR(255),
  size_label      VARCHAR(100),
  category        VARCHAR(100),
  condition_label VARCHAR(100),
  purchase_price  DECIMAL(10,2),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_listings (
  id                SERIAL PRIMARY KEY,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  account_id        INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  vinted_id         BIGINT UNIQUE NOT NULL,
  url               TEXT,
  price             DECIMAL(10,2),
  status            VARCHAR(20) NOT NULL DEFAULT 'ONLINE', -- ONLINE|RESERVED|SOLD|DELETED
  view_count        INTEGER,
  favourite_count   INTEGER,
  photo_url         TEXT,
  vinted_created_at TIMESTAMPTZ,
  last_synced_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id                SERIAL PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  seller_listing_id INTEGER REFERENCES seller_listings(id) ON DELETE SET NULL,
  vinted_order_id   BIGINT UNIQUE,
  buyer_name        VARCHAR(255),
  sale_price        DECIMAL(10,2),
  shipping_status   VARCHAR(50),
  sold_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seller_listings_account ON seller_listings(account_id);
CREATE INDEX IF NOT EXISTS idx_seller_listings_status  ON seller_listings(status);
CREATE INDEX IF NOT EXISTS idx_seller_listings_product ON seller_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_products_account        ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_sales_account           ON sales(account_id);
