-- ============================================================================
-- 0001 — CATALOGUE
-- ----------------------------------------------------------------------------
-- Categories, products, variants and images.
--
-- MONEY IS STORED AS INTEGER MINOR UNITS. Never REAL. A float price is the
-- single most expensive mistake in a commerce schema: 0.1 + 0.2 does not
-- equal 0.3, and the error compounds through tax, shipping and discounts
-- until a customer is charged a cent that cannot be reconciled.
--
--   price        2100  → $21.00 with minor_unit = 2
--   price         210  → ¥210 with minor_unit = 0
--
-- Every product carries `currency` and `minor_unit` alongside the amount,
-- so a row is self-describing: nothing has to infer which hundredth it is
-- looking at. `scripts/check-migrations.mjs` asserts both.
--
-- All statements are idempotent (`IF NOT EXISTS`) so re-running a migration
-- against a partially built database cannot half-succeed.
-- ============================================================================

/* ---- Categories ---------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT    PRIMARY KEY,
  slug          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_position
  ON categories (position, name);

/* ---- Products ------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS products (
  id                TEXT    PRIMARY KEY,
  slug              TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  subtitle          TEXT    NOT NULL DEFAULT '',
  description       TEXT    NOT NULL DEFAULT '',

  -- Money: minor units, plus the context needed to render them.
  price             INTEGER NOT NULL,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  minor_unit        INTEGER NOT NULL DEFAULT 2,

  sku               TEXT,
  category_id       TEXT    REFERENCES categories (id) ON DELETE SET NULL,

  -- Editorial attributes used by the storefront filters.
  glaze             TEXT,
  year              TEXT,

  -- Fulfilment attributes.
  weight_g          INTEGER NOT NULL DEFAULT 0,
  requires_shipping INTEGER NOT NULL DEFAULT 1,
  tax_class         TEXT    NOT NULL DEFAULT 'standard',

  -- Lifecycle. 'active' is the only status the storefront sells.
  status            TEXT    NOT NULL DEFAULT 'draft',
  availability      TEXT    NOT NULL DEFAULT 'available',
  is_featured       INTEGER NOT NULL DEFAULT 0,

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  CHECK (price >= 0),
  CHECK (minor_unit >= 0 AND minor_unit <= 4),
  CHECK (weight_g >= 0),
  CHECK (requires_shipping IN (0, 1)),
  CHECK (is_featured IN (0, 1)),
  CHECK (status IN ('draft', 'active', 'archived')),
  CHECK (availability IN ('available', 'made-to-order', 'sold-out', 'enquire'))
);

-- The storefront lists by status, orders by featured/newness.
CREATE INDEX IF NOT EXISTS idx_products_status_created
  ON products (status, is_featured DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category_id, status);

CREATE INDEX IF NOT EXISTS idx_products_slug
  ON products (slug);

/* ---- Variants ------------------------------------------------------------
 * A size or option that changes the price, weight or SKU. `price` is NULL
 * when the variant costs the same as its parent — copying the parent price
 * into every variant would make a price change require a fan-out update and
 * silently go stale in between.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS product_variants (
  id           TEXT    PRIMARY KEY,
  product_id   TEXT    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sku          TEXT,
  option_name  TEXT    NOT NULL DEFAULT 'Size',
  option_value TEXT    NOT NULL,
  price        INTEGER,
  weight_g     INTEGER,
  position     INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,

  CHECK (price IS NULL OR price >= 0),
  CHECK (weight_g IS NULL OR weight_g >= 0),
  CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_variants_product
  ON product_variants (product_id, position);

/* ---- Images --------------------------------------------------------------
 * `url` is the resolved public URL; `r2_key` is set when the file lives in
 * the R2 bucket instead. Exactly one is the source of truth, and `url` is
 * what the API returns either way.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS product_images (
  id         TEXT    PRIMARY KEY,
  product_id TEXT    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  r2_key     TEXT,
  url        TEXT    NOT NULL,
  alt        TEXT    NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_product
  ON product_images (product_id, position);
