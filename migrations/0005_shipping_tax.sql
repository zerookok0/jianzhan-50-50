/* ==========================================================================
 * 0005 — Shipping and tax
 *
 * Rates are configurable data, not code: a change of carrier price or VAT
 * rate must not require a deploy.
 *
 * Zone matching is most-specific-first — a country rule beats a wildcard,
 * and a postcode prefix beats both. `position` breaks remaining ties.
 *
 * TAX IS ARITHMETIC. This is not legal tax determination. There is no
 * nexus logic, no exemption handling and no reverse-charge rule. Read
 * `docs/payment-provider-integration.md` §8 before selling into a
 * jurisdiction you have not checked.
 * ========================================================================== */

CREATE TABLE IF NOT EXISTS shipping_zones (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  countries         TEXT NOT NULL DEFAULT '[]',
  regions           TEXT NOT NULL DEFAULT '[]',
  postcode_prefixes TEXT NOT NULL DEFAULT '[]',
  position          INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shipping_methods (
  id           TEXT PRIMARY KEY,
  zone_id      TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  /* flat | weight | subtotal */
  rate_type    TEXT NOT NULL DEFAULT 'flat',
  rate         INTEGER NOT NULL DEFAULT 0,
  free_over    INTEGER,
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  delivery_time TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_methods_zone ON shipping_methods(zone_id, position);

/* ---- Tax rules ----------------------------------------------------------
 * `rate_bp` is basis points: 2000 = 20%. `prices_include_tax` decides
 * whether the rate is extracted from the listed price or added to it —
 * getting that backwards inflates every receipt by the tax rate.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS tax_rules (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  countries          TEXT NOT NULL DEFAULT '[]',
  region             TEXT,
  tax_class          TEXT NOT NULL DEFAULT '*',
  rate_bp            INTEGER NOT NULL DEFAULT 0,
  prices_include_tax INTEGER NOT NULL DEFAULT 0,
  /* round | floor | ceil */
  rounding           TEXT NOT NULL DEFAULT 'round',
  position           INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tax_rules_active ON tax_rules(is_active, position);
