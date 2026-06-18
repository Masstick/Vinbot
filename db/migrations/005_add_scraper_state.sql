-- État runtime du scraper (pause/reprise persistante).
-- Appliquée automatiquement au démarrage du backend (ScraperService.loadPausedState) ;
-- fournie ici pour cohérence avec les autres migrations / application manuelle.
CREATE TABLE IF NOT EXISTS scraper_state (
  id         INT PRIMARY KEY DEFAULT 1,
  paused     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scraper_state_singleton CHECK (id = 1)
);
INSERT INTO scraper_state (id, paused) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;
