-- ============================================================================
-- 0001 — Initial schema
-- ============================================================================
-- Rules applied throughout:
--   * Money is INTEGER minor units (cents). No REAL/FLOAT for money, ever.
--     Every money column travels with its currency + minor_unit context,
--     which is denormalised onto orders for immutability.
--   * Timestamps are INTEGER unix epoch **milliseconds** (UTC).
--   * Idempotent: everything uses IF NOT EXISTS so re-running is safe.
--   * Status columns are TEXT with CHECK constraints, not enums, so adding
--     a status is a migration rather than a table rebuild.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  subtitle          TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  -- Base price in minor units. Variants may override.
  price             INTEGER NOT NULL CHECK (price >= 0),
  currency          TEXT NOT NULL DEFAULT 'USD',
  minor_unit        INTEGER NOT NULL DEFAULT 2 CHECK (minor_unit BETWEEN 0 AND 4),
  sku               TEXT UNIQUE,
  category_id       TEXT REFERENCES categories(id) ON DELETE SET NULL,
  -- Presentation only; never used for pricing logic.
  glaze             TEXT,
  -- Weight in grams. Used by weight-based shipping.
  weight_g          INTEGER NOT NULL DEFAULT 0 CHECK (weight_g >= 0),
  requires_shipping INTEGER NOT NULL DEFAULT 1 CHECK (requires_shipping IN (0, 1)),
  tax_class         TEXT NOT NULL DEFAULT 'standard',
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),
  is_featured       INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  -- Editorial fields carried over from the original catalogue.
  year              TEXT,
  availability      TEXT NOT NULL DEFAULT 'available'
                    CHECK (availability IN ('available', 'made-to-order', 'sold-out', 'enquire')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status      ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_featured    ON products(is_featured, status);
CREATE INDEX IF NOT EXISTS idx_products_price       ON products(price);

CREATE TABLE IF NOT EXISTS product_variants (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku            TEXT UNIQUE,
  -- e.g. 'Size'
  option_name    TEXT NOT NULL,
  -- e.g. 'Large'
  option_value   TEXT NOT NULL,
  -- NULL = inherit the product price.
  price          INTEGER CHECK (price IS NULL OR price >= 0),
  weight_g       INTEGER CHECK (weight_g IS NULL OR weight_g >= 0),
  position       INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (product_id, option_name, option_value)
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- R2 object key, or an absolute external URL for legacy/seed rows.
  r2_key      TEXT,
  url         TEXT NOT NULL,
  alt         TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

-- One row per purchasable unit (a product, or a variant when present).
CREATE TABLE IF NOT EXISTS inventory (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  -- on_hand = physically present; reserved = held by open carts/orders.
  -- sellable = on_hand - reserved, computed by services, stored for query speed.
  on_hand        INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved       INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  sellable       INTEGER NOT NULL DEFAULT 0,
  -- FALSE disables purchasing without deleting the row.
  is_tracked     INTEGER NOT NULL DEFAULT 1 CHECK (is_tracked IN (0, 1)),
  allow_backorder INTEGER NOT NULL DEFAULT 0 CHECK (allow_backorder IN (0, 1)),
  updated_at     INTEGER NOT NULL,
  UNIQUE (product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

-- Reservations make stock holds explicit and releasable.
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id           TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  -- What holds the stock: a cart or a just-created order.
  holder_type  TEXT NOT NULL CHECK (holder_type IN ('cart', 'order')),
  holder_id    TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'committed', 'released', 'expired')),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  released_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_res_holder   ON inventory_reservations(holder_type, holder_id);
CREATE INDEX IF NOT EXISTS idx_res_status   ON inventory_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_res_inv      ON inventory_reservations(inventory_id);

-- Manual stock adjustments, for auditability.
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id            TEXT PRIMARY KEY,
  inventory_id  TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  actor_id      TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adj_inventory ON inventory_adjustments(inventory_id, created_at);

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carts (
  id             TEXT PRIMARY KEY,
  -- SHA-256 of the opaque session token. The raw token is never stored.
  token_hash     TEXT NOT NULL UNIQUE,
  currency       TEXT NOT NULL DEFAULT 'USD',
  minor_unit     INTEGER NOT NULL DEFAULT 2,
  -- Snapshot of the last known address, used to price shipping/tax.
  country        TEXT,
  region         TEXT,
  postcode       TEXT,
  email          TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'converted', 'abandoned')),
  expires_at     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carts_expiry ON carts(status, expires_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id            TEXT PRIMARY KEY,
  cart_id       TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id    TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  -- Advisory only. Pricing always re-reads products at request time.
  unit_price    INTEGER NOT NULL CHECK (unit_price >= 0),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_line
  ON cart_items(cart_id, product_id, IFNULL(variant_id, ''));
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS coupons (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description         TEXT NOT NULL DEFAULT '',
  discount_type       TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  -- percent: basis points (1000 = 10.00%). fixed: minor units.
  amount              INTEGER NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'USD',
  minor_unit          INTEGER NOT NULL DEFAULT 2,
  min_subtotal        INTEGER NOT NULL DEFAULT 0,
  starts_at           INTEGER,
  ends_at             INTEGER,
  -- Total redemptions allowed across all customers. NULL = unlimited.
  max_redemptions     INTEGER,
  -- Redemptions allowed per email address. NULL = unlimited.
  max_per_customer    INTEGER,
  -- JSON arrays of product/category ids to scope the discount.
  include_product_ids TEXT NOT NULL DEFAULT '[]',
  include_category_ids TEXT NOT NULL DEFAULT '[]',
  -- 'stackable' | 'exclusive'
  stacking            TEXT NOT NULL DEFAULT 'stackable'
                      CHECK (stacking IN ('stackable', 'exclusive')),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          TEXT PRIMARY KEY,
  coupon_id   TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id    TEXT NOT NULL,
  -- Lowercased email so per-customer limits are enforceable.
  email       TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON coupon_redemptions(coupon_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_redemption_order ON coupon_redemptions(coupon_id, order_id);

-- ---------------------------------------------------------------------------
-- Shipping & tax
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipping_zones (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- JSON array of ISO-3166 alpha-2 codes. ["*"] = rest of world.
  countries   TEXT NOT NULL DEFAULT '[]',
  -- JSON array of region/state codes; empty = whole country.
  regions     TEXT NOT NULL DEFAULT '[]',
  -- JSON array of postcode prefixes; empty = any.
  postcode_prefixes TEXT NOT NULL DEFAULT '[]',
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shipping_methods (
  id             TEXT PRIMARY KEY,
  zone_id        TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- 'flat' | 'weight' | 'subtotal'
  rate_type      TEXT NOT NULL CHECK (rate_type IN ('flat', 'weight', 'subtotal')),
  -- flat: minor units per shipment
  -- weight: minor units per kg
  -- subtotal: basis points of order subtotal
  rate           INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  -- Minor units. Order subtotal at/above this ships free.
  free_over      INTEGER,
  min_subtotal   INTEGER NOT NULL DEFAULT 0,
  -- Delivery estimate shown to the customer.
  delivery_time  TEXT NOT NULL DEFAULT '',
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_methods_zone ON shipping_methods(zone_id);

CREATE TABLE IF NOT EXISTS tax_rules (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- JSON array of ISO-3166 alpha-2 codes.
  countries     TEXT NOT NULL DEFAULT '[]',
  -- '' matches any region.
  region        TEXT NOT NULL DEFAULT '',
  -- Matches products.tax_class; '*' applies to all.
  tax_class     TEXT NOT NULL DEFAULT '*',
  -- Basis points: 2000 = 20.00%.
  rate_bp       INTEGER NOT NULL CHECK (rate_bp >= 0),
  -- TRUE when catalogue prices already include this tax.
  prices_include_tax INTEGER NOT NULL DEFAULT 0 CHECK (prices_include_tax IN (0, 1)),
  -- 'round' | 'floor' | 'ceil', applied per line.
  rounding      TEXT NOT NULL DEFAULT 'round'
                CHECK (rounding IN ('round', 'floor', 'ceil')),
  position      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  -- Unguessable reference shown to the customer. Order lookup uses THIS,
  -- never the sequential id.
  public_reference  TEXT NOT NULL UNIQUE,
  -- Optional short human-friendly number for invoices.
  order_number      INTEGER,
  cart_id           TEXT,
  email             TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',
  -- Immutable money snapshot, all minor units.
  currency          TEXT NOT NULL,
  minor_unit        INTEGER NOT NULL,
  subtotal          INTEGER NOT NULL CHECK (subtotal >= 0),
  discount_total    INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_total    INTEGER NOT NULL DEFAULT 0 CHECK (shipping_total >= 0),
  tax_total         INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total       INTEGER NOT NULL CHECK (grand_total >= 0),
  -- Status machine. Payment and fulfilment are tracked separately.
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  fulfilment_status TEXT NOT NULL DEFAULT 'unfulfilled'
                    CHECK (fulfilment_status IN ('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled')),
  -- Denormalised shipping address, stored as JSON for simplicity.
  billing_address   TEXT NOT NULL DEFAULT '{}',
  shipping_address  TEXT NOT NULL DEFAULT '{}',
  shipping_method_id TEXT,
  shipping_method_name TEXT NOT NULL DEFAULT '',
  customer_note     TEXT NOT NULL DEFAULT '',
  -- Idempotency: a repeated submit with the same key returns the same order.
  idempotency_key   TEXT UNIQUE,
  -- Set when the pending order's reservation lapses.
  stock_committed   INTEGER NOT NULL DEFAULT 0 CHECK (stock_committed IN (0, 1)),
  expires_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiry  ON orders(status, expires_at);

CREATE TABLE IF NOT EXISTS order_items (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        TEXT,
  variant_id        TEXT,
  -- Snapshot fields — never re-read from the catalogue.
  name              TEXT NOT NULL,
  variant_label     TEXT NOT NULL DEFAULT '',
  sku               TEXT NOT NULL DEFAULT '',
  unit_price        INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  line_subtotal     INTEGER NOT NULL,
  line_discount     INTEGER NOT NULL DEFAULT 0,
  line_tax          INTEGER NOT NULL DEFAULT 0,
  line_total        INTEGER NOT NULL,
  weight_g          INTEGER NOT NULL DEFAULT 0,
  tax_class         TEXT NOT NULL DEFAULT 'standard',
  tax_rate_bp       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_coupons (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  -- Provider-side intent/transaction id.
  provider_reference    TEXT,
  amount                INTEGER NOT NULL CHECK (amount >= 0),
  currency              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'pending', 'authorised', 'captured',
                                          'failed', 'cancelled', 'refunded', 'partially_refunded')),
  -- Provider idempotency key so a retry cannot double-charge.
  idempotency_key       TEXT NOT NULL UNIQUE,
  error_code            TEXT,
  error_message         TEXT,
  -- Non-sensitive provider metadata only. Never card data.
  metadata              TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order    ON payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payment_attempts(provider, provider_reference);

-- Raw webhook records for replay/debugging and duplicate suppression.
CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  -- Provider's own event id, when supplied.
  provider_event  TEXT,
  event_type      TEXT NOT NULL DEFAULT '',
  -- SHA-256 of the raw body, so identical retries collapse.
  payload_hash    TEXT NOT NULL,
  signature_ok    INTEGER NOT NULL DEFAULT 0 CHECK (signature_ok IN (0, 1)),
  processed       INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0, 1)),
  error           TEXT,
  received_at     INTEGER NOT NULL,
  processed_at    INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_event
  ON webhook_events(provider, provider_event)
  WHERE provider_event IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_hash
  ON webhook_events(provider, payload_hash);

-- ---------------------------------------------------------------------------
-- Admin & audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- Password hash only: PBKDF2-SHA256, stored as "pbkdf2$iterations$salt$hash".
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  -- Brute-force protection.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER,
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  -- SHA-256 of the session token; raw token lives only in the cookie.
  token_hash  TEXT NOT NULL UNIQUE,
  -- CSRF token, compared with a constant-time helper.
  csrf_token  TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  ip_hash     TEXT NOT NULL DEFAULT '',
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON admin_sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin', 'system', 'customer')),
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  -- JSON diff / context. Must never contain passwords or card data.
  detail      TEXT NOT NULL DEFAULT '{}',
  ip_hash     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, created_at);

-- Rate limiting (D1-backed so it survives Worker isolates).
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ratelimit_expiry ON rate_limits(expires_at);

-- Simple key/value store for one-time setup state and migration bookkeeping.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
