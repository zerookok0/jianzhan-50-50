/* ==========================================================================
 * 0003 — Carts, lines, coupons
 *
 * A cart is identified by a token held in the browser. Only the SHA-256
 * hash of that token is stored, so a leaked database dump does not let
 * anyone resume someone else's cart.
 *
 * Every price on a cart line is a SNAPSHOT taken when the line was added.
 * The cart total is recomputed from the catalogue on every read, so a stale
 * snapshot can never become a stale charge.
 * ========================================================================== */

CREATE TABLE IF NOT EXISTS carts (
  id             TEXT PRIMARY KEY,
  token_hash     TEXT NOT NULL UNIQUE,
  currency       TEXT NOT NULL DEFAULT 'USD',
  minor_unit     INTEGER NOT NULL DEFAULT 2,
  email          TEXT,
  country        TEXT,
  region         TEXT,
  postcode       TEXT,
  /* Applied discount codes, as a JSON array. A cart holds at most a
   * couple, so a join table would be schema for its own sake. */
  coupons_json   TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'active',
  converted_order_id TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carts_expiry ON carts(status, expires_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id               TEXT PRIMARY KEY,
  cart_id          TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id),
  variant_id       TEXT REFERENCES product_variants(id),
  quantity         INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL,
  unit_price_currency TEXT NOT NULL DEFAULT 'USD',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

/* One line per product+variant. Without this, adding the same bowl twice
 * creates two lines and the quantity guard checks the wrong number. */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_line
  ON cart_items(cart_id, product_id, IFNULL(variant_id, ''));

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

/* ---- Coupons ------------------------------------------------------------
 * `amount` is basis points for percentage coupons and minor units for
 * fixed ones — `discount_type` says which. Money columns still carry a
 * currency, because a fixed discount is meaningless without one.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS coupons (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  discount_type        TEXT NOT NULL DEFAULT 'percent',
  amount               INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  minor_unit           INTEGER NOT NULL DEFAULT 2,
  min_subtotal         INTEGER NOT NULL DEFAULT 0,
  starts_at            INTEGER,
  ends_at              INTEGER,
  max_redemptions      INTEGER,
  max_per_customer     INTEGER,
  include_product_ids  TEXT NOT NULL DEFAULT '[]',
  include_category_ids TEXT NOT NULL DEFAULT '[]',
  stacking             TEXT NOT NULL DEFAULT 'stackable',
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

/* ---- Redemptions --------------------------------------------------------
 * Written when an order is paid, not when a code is typed — otherwise
 * abandoning a cart would burn a single-use code.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          TEXT PRIMARY KEY,
  coupon_id   TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id    TEXT NOT NULL,
  customer_key TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  minor_unit  INTEGER NOT NULL DEFAULT 2,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_customer ON coupon_redemptions(coupon_id, customer_key);
