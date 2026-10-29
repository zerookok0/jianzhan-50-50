/* ==========================================================================
 * 0001 — Catalogue
 *
 * Products, variants, images and categories.
 *
 * MONEY RULE, established here and never broken afterwards:
 *   every amount is INTEGER minor units, with an explicit `currency` and
 *   `minor_unit` alongside it. There is no REAL, FLOAT, NUMERIC or DECIMAL
 *   column anywhere in this schema — `scripts/check-migrations.mjs` fails
 *   the build if one appears.
 *
 * All statements are idempotent so a re-run is a no-op.
 * ========================================================================== */

/* ---- Categories ---------------------------------------------------------
 * A flat taxonomy. Depth would buy nothing: the store has three kinds of
 * object and pretending otherwise would be architecture for its own sake.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

/* ---- Products -----------------------------------------------------------
 * `availability` is the shop's intent, not stock:
 *   active | made-to-order | sold-out | enquire | archived
 * Real stock lives in `inventory`, which is the only authority the buy
 * path consults.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  subtitle          TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  price             INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  minor_unit        INTEGER NOT NULL DEFAULT 2,
  sku               TEXT NOT NULL DEFAULT '',
  category_id       TEXT REFERENCES categories(id),
  glaze             TEXT,
  year              TEXT,
  weight_g          INTEGER NOT NULL DEFAULT 0,
  requires_shipping INTEGER NOT NULL DEFAULT 1,
  tax_class         TEXT NOT NULL DEFAULT 'standard',
  status            TEXT NOT NULL DEFAULT 'active',
  availability      TEXT NOT NULL DEFAULT 'available',
  is_featured       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured);

/* ---- Variants -----------------------------------------------------------
 * Only when an option is stocked separately. A product with no variant rows
 * is bought by product id alone.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS product_variants (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL DEFAULT '',
  option_name  TEXT NOT NULL DEFAULT 'Size',
  option_value TEXT NOT NULL,
  price        INTEGER NOT NULL,
  weight_g     INTEGER,
  position     INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

/* ---- Images -------------------------------------------------------------
 * `url` points at the Pexels CDN for seeded pieces; `r2_key` is set when a
 * photograph is uploaded to the private bucket and served through the
 * Worker. Exactly one of them is expected to be populated.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key     TEXT,
  url        TEXT,
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position);
