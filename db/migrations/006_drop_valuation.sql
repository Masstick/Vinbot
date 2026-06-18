-- SP1 : retrait de la valorisation. DESTRUCTIF — sauvegarder avant (pg_dump).
ALTER TABLE keywords         DROP COLUMN IF EXISTS target_margin;
ALTER TABLE keywords         DROP COLUMN IF EXISTS shipping_estimate;
ALTER TABLE keywords         DROP COLUMN IF EXISTS market_scan_pages;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS deal_score;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS market_avg;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS model_market_avg;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS potential_profit;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS analysis_id;
ALTER TABLE listings         DROP COLUMN IF EXISTS model_label;
ALTER TABLE listings         DROP COLUMN IF EXISTS model_confidence;
DROP TABLE IF EXISTS deal_analyses;
DROP TABLE IF EXISTS model_market_avg;
