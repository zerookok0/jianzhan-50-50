-- ============================================================================
-- 0005 — SHIPPING & TAX
-- ----------------------------------------------------------------------------
-- Two rule tables, both read whole on every cart calculation. They are small
-- (tens of rows) and change rarely, so `SELECT * ... WHERE is_active = 1` is
-- the right shape; a query per destination would be slower and no clearer.
--
-- Multi-value columns (`countries`, `regions`, `postcode_prefixes`) hold JSON
-- arrays. Shipping zones are a small, hand-curated list edited through the
-- admin panel, so normalising them into three join tables would add joins to
-- every quote without making any query possible that is not possible now.
-- The trade-off is explicit: these columns are read whole, never filtered in
-- SQL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipping_zones (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,

  -- JSON array. '*' matches every country.
  countries         TEXT    NOT NULL DEFAULT '["*"]',
  -- JSON array. Empty means "any region in those countries".
  regions           TEXT    NOT NULL DEFAULT '[]',
  -- JSON array of uppercase prefixes, e.g. ["SW","SE"].
  postcode_prefixes TEXT    NOT NULL DEFAULT '[]',

  position          INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_zones_active
  ON shipping_zones (is_active, position);

/* ---- Methods -------------------------------------------------------------
 * `rate` is interpreted according to `rate_type`:
 *   flat     → minor units per shipment
 *   weight   → minor units per kilogram, rounded up
 *   subtotal → basis points of the discounted subtotal (800 = 8%)
 *
 * Storing one column for three meanings is safe only because rate_type is
 * right beside it and the pricing function switches on it explicitly.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS shipping_methods (
  id            TEXT    PRIMARY KEY,
  zone_id       TEXT    NOT NULL REFERENCES shipping_zones (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,

  rate_type     TEXT    NOT NULL,
  rate          INTEGER NOT NULL DEFAULT 0,

  -- Waive the cost above this subtotal (minor units). NULL = never free.
  free_over     INTEGER,
  -- Hide this method below this subtotal (minor units).
  min_subtotal  INTEGER NOT NULL DEFAULT 0,

  delivery_time TEXT    NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  CHECK (rate_type IN ('flat', 'weight', 'subtotal')),
  CHECK (rate >= 0),
  CHECK (free_over IS NULL OR free_over >= 0),
  CHECK (min_subtotal >= 0),
  CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_methods_zone
  ON shipping_methods (zone_id, is_active, position);

/* ---- Tax rules -----------------------------------------------------------
 * A rule matches on destination (country list, optional region) and tax
 * class. `rate_bp` is basis points — 2000 = 20% — because integer basis
 * points keep the arithmetic exact. A REAL percentage would reintroduce
 * exactly the rounding error the rest of the schema avoids.
 *
 * `position` resolves overlaps: the lowest position whose countries match
 * the destination wins, so a country-specific rule can sit above a
 * continent-wide fallback.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS tax_rules (
  id                 TEXT    PRIMARY KEY,
  name               TEXT    NOT NULL,

  -- JSON array of ISO country codes. '*' matches every destination.
  countries          TEXT    NOT NULL DEFAULT '["*"]',
  -- NULL matches any region within those countries.
  region             TEXT,

  tax_class          TEXT    NOT NULL DEFAULT 'standard',
  rate_bp            INTEGER NOT NULL DEFAULT 0,

  /*
   * True for VAT-style jurisdictions where the listed price already
   * includes tax. The tax is then extracted from the total rather than
   * added to it — adding it would overcharge every EU customer by the
   * VAT rate.
   */
  prices_include_tax INTEGER NOT NULL DEFAULT 0,

  rounding           TEXT    NOT NULL DEFAULT 'round',
  position           INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,

  CHECK (rate_bp >= 0 AND rate_bp <= 10000),
  CHECK (prices_include_tax IN (0, 1)),
  CHECK (rounding IN ('round', 'floor', 'ceil')),
  CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_tax_active
  ON tax_rules (is_active, position);
