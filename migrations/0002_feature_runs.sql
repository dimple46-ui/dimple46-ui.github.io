-- Additive Feature Engine storage. It does not rewrite or delete market_observations.
-- One immutable row is allowed for each observation slot and feature-engine version.
CREATE TABLE IF NOT EXISTS feature_runs (
  slot_ms INTEGER NOT NULL,
  feature_version INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  trading_day TEXT NOT NULL,
  engine_git_sha TEXT NOT NULL,
  engine_source_sha256 TEXT NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  input_cutoff_ms INTEGER NOT NULL,
  quality_ceiling TEXT NOT NULL,
  generation_status TEXT NOT NULL,
  compact_features_json TEXT NOT NULL CHECK(json_valid(compact_features_json)),
  validation_json TEXT NOT NULL CHECK(json_valid(validation_json)),
  PRIMARY KEY (slot_ms, feature_version),
  FOREIGN KEY (slot_ms) REFERENCES market_observations(slot_ms) ON DELETE RESTRICT,
  CHECK(feature_version > 0),
  CHECK(observed_at_ms >= slot_ms AND observed_at_ms < slot_ms + 120000),
  CHECK(input_cutoff_ms = observed_at_ms),
  CHECK(generated_at_ms >= input_cutoff_ms),
  CHECK(length(engine_git_sha) BETWEEN 7 AND 64),
  CHECK(length(engine_source_sha256) = 64),
  CHECK(quality_ceiling IN (
    'VERIFIED', 'UNVERIFIED_TIME', 'STALE_INPUT', 'MISSING_INPUT',
    'UNUSABLE_INPUT', 'UNKNOWN'
  )),
  CHECK(generation_status IN ('SUCCESS', 'PARTIAL'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_feature_runs_version_day_slot
  ON feature_runs(feature_version, trading_day, slot_ms DESC);
