-- ============================================================================
-- 0003 — CARTS & COUPONS
-- ----------------------------------------------------------------------------
-- A cart is an anonymous session identified by a hashed bearer token. The
-- raw token lives only in the customer's browser; the database stores
-- SHA-256 of it. A stolen database dump therefore cannot be used to resume
-- anyone's cart, and the token never appears in logs.
--
-- TOTALS ARE NOT STORED. Subtotal, discount, tax and shipping are derived
-- on every read from live product rows by services/pricing.ts. Persisting
-- them would mean deciding when to invalidate — and the answer would always
-- be "some time later than the price change", which is how a customer gets
-- charged a stale amount.
--
-- `cart_items.unit_price` is a SNAPSHOT, not the price of record: it exists
-- so an admin can see what the customer was shown. Checkout always re-reads
-- the live price, so a price change between add-to-cart and pay is honoured.
-- ============================================================================

CREATE TABLE IF NOT EXISTS carts (
  id          TEXT    PRIMARY KEY,
  -- SHA-256 hex of the bearer token. Never the token itself.
  token_hash  TEXT    NOT NULL UNIQUE,

  currency    TEXT    NOT NULL DEFAULT 'USD',
  minor_unit  INTEGER NOT NULL DEFAULT 2,

  -- Destination, filled in progressively during checkout.
  country     TEXT,
  region      TEXT,
  postcode    TEXT,
  email       TEXT,

  -- open → converted | abandoned | expired
  status      TEXT    NOT NULL DEFAULT 'open',
  expires_at  INTEGER NOT NULL,

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,

  CHECK (minor_unit >= 0 AND minor_unit <= 4),
  CHECK (status IN ('open', 'converted', 'abandoned', 'expired'))
);

/* Session resume: find an open cart by its token. */
CREATE INDEX IF NOT EXISTS idx_carts_token_status
  ON carts (token_hash, status);

/* The cron sweeper finds abandoned carts past their TTL. */
CREATE INDEX IF NOT EXISTS idx_carts_expiry
  ON carts (status, expires_at);

/* ---- Cart items ---------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS cart_items (
  id         TEXT    PRIMARY KEY,
  cart_id    TEXT    NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id TEXT    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id TEXT    REFERENCES product_variants (id) ON DELETE CASCADE,

  quantity   INTEGER NOT NULL,
  -- What the customer was shown when the line was added (minor units).
  unit_price INTEGER NOT NULL,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  CHECK (quantity > 0),
  CHECK (unit_price >= 0)
);

/*
 * One line per product/variant pair, enforced in the database rather than
 * in code. Two concurrent "add to cart" requests would otherwise create two
 * rows for the same bowl and the cart would show it twice; the service
 * re-reads and adds, but only the unique index makes the outcome
 * deterministic.
 *
 * IFNULL is required again: SQLite considers NULLs distinct, so a
 * variant-less line would bypass a plain UNIQUE(cart_id, product_id,
 * variant_id).
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_line
  ON cart_items (cart_id, product_id, IFNULL(variant_id, ''));

CREATE INDEX IF NOT EXISTS idx_cart_items_cart
  ON cart_items (cart_id, created_at);

/* ---- Cart coupons --------------------------------------------------------
 * Which codes the customer has entered. Stored as a JSON array because the
 * set is tiny, ordered and read whole; a join table would add a second
 * round-trip for no query benefit.
 *
 * The codes are re-resolved against `coupons` on every read, so deactivating
 * or expiring a code stops it applying immediately — the cart row cannot
 * hold a stale entitlement.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS cart_coupons (
  cart_id     TEXT NOT NULL PRIMARY KEY REFERENCES carts (id) ON DELETE CASCADE,
  coupon_codes TEXT NOT NULL DEFAULT '[]'
);

/* ---- Coupons -------------------------------------------------------------
 * `amount` is basis points for a percent discount (1250 = 12.5%) and minor
 * units for a fixed one, mirroring the discount_type discriminator.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS coupons (
  id                   TEXT    PRIMARY KEY,
  code                 TEXT    NOT NULL UNIQUE,

  discount_type        TEXT    NOT NULL,
  amount               INTEGER NOT NULL,
  currency             TEXT    NOT NULL DEFAULT 'USD',
  minor_unit           INTEGER NOT NULL DEFAULT 2,

  -- Gate: the cart subtotal must reach this before the code applies.
  min_subtotal         INTEGER NOT NULL DEFAULT 0,

  starts_at            INTEGER,
  ends_at              INTEGER,

  max_redemptions      INTEGER,
  max_per_customer     INTEGER,

  -- JSON arrays of ids. Empty means "applies to the whole cart".
  include_product_ids  TEXT    NOT NULL DEFAULT '[]',
  include_category_ids TEXT    NOT NULL DEFAULT '[]',

  -- 'stackable' combines with other codes; 'exclusive' locks the cart.
  stacking             TEXT    NOT NULL DEFAULT 'stackable',
  is_active            INTEGER NOT NULL DEFAULT 1,

  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,

  CHECK (discount_type IN ('percent', 'fixed')),
  CHECK (amount >= 0),
  CHECK (minor_unit >= 0 AND minor_unit <= 4),
  CHECK (min_subtotal >= 0),
  CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  CHECK (max_per_customer IS NULL OR max_per_customer >= 0),
  CHECK (stacking IN ('stackable', 'exclusive')),
  CHECK (is_active IN (0, 1))
);

/* Codes are matched case-insensitively; the service upper-cases before the
 * lookup, so a unique index on the raw column is enough. */
CREATE INDEX IF NOT EXISTS idx_coupons_active
  ON coupons (is_active, ends_at);

/* ---- Redemptions ---------------------------------------------------------
 * One row per accepted use. The per-customer limit is enforced by counting
 * rows for an email, so this table is the entitlement ledger, not just an
 * analytics log.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id         TEXT    PRIMARY KEY,
  coupon_id  TEXT    NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  order_id   TEXT    NOT NULL,
  -- Lower-cased for the per-customer count.
  email      TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon
  ON coupon_redemptions (coupon_id, email);

CREATE INDEX IF NOT EXISTS idx_redemptions_order
  ON coupon_redemptions (order_id);
