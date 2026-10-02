-- Additive migration. Apply once to the dedicated market-history database.
CREATE TABLE IF NOT EXISTS market_observations (
  slot_ms INTEGER PRIMARY KEY,
  observed_at_ms INTEGER NOT NULL,
  available_at_ms INTEGER NOT NULL,
  trading_day TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  quality_version TEXT,
  pipeline_status TEXT,
  metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
  quality_json TEXT NOT NULL CHECK(json_valid(quality_json)),
  features_json TEXT CHECK(features_json IS NULL OR json_valid(features_json)),
  CHECK(observed_at_ms >= slot_ms AND observed_at_ms < slot_ms + 120000)
);
CREATE INDEX IF NOT EXISTS idx_history_day_slot
  ON market_observations(trading_day, slot_ms);
