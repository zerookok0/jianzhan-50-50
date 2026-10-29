/* ==========================================================================
 * 0004 — Orders and payments
 *
 * An order is an immutable snapshot. `order_items` copies the name, SKU,
 * variant label, unit price and line total at purchase time, so re-pricing
 * the catalogue later cannot rewrite what a customer was charged.
 *
 * `public_reference` is the only credential the confirmation page accepts.
 * It is unguessable and deliberately unrelated to any internal id.
 * ========================================================================== */

CREATE TABLE IF NOT EXISTS orders (
  id                    TEXT PRIMARY KEY,
  public_reference      TEXT NOT NULL UNIQUE,
  cart_id               TEXT REFERENCES carts(id),
  email                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  fulfilment_status     TEXT NOT NULL DEFAULT 'unfulfilled',

  currency              TEXT NOT NULL DEFAULT 'USD',
  minor_unit            INTEGER NOT NULL DEFAULT 2,

  subtotal              INTEGER NOT NULL DEFAULT 0,
  discount_total        INTEGER NOT NULL DEFAULT 0,
  shipping_total        INTEGER NOT NULL DEFAULT 0,
  tax_total             INTEGER NOT NULL DEFAULT 0,
  grand_total           INTEGER NOT NULL DEFAULT 0,

  shipping_method_id    TEXT,
  shipping_method_name  TEXT NOT NULL DEFAULT '',
  shipping_address_json TEXT NOT NULL DEFAULT '{}',
  billing_address_json  TEXT NOT NULL DEFAULT '{}',
  customer_note         TEXT NOT NULL DEFAULT '',

  idempotency_key       TEXT UNIQUE,
  stock_committed       INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  expires_at            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status, expires_at);

/* ---- Order items --------------------------------------------------------
 * A snapshot, not a join. Nothing here references the product's current
 * price, because the price at purchase is the only correct one.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS order_items (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL,
  variant_id     TEXT,
  name           TEXT NOT NULL,
  variant_label  TEXT NOT NULL DEFAULT '',
  sku            TEXT NOT NULL DEFAULT '',
  quantity       INTEGER NOT NULL,
  unit_price     INTEGER NOT NULL,
  line_total     INTEGER NOT NULL,
  tax_class      TEXT NOT NULL DEFAULT 'standard'
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

/* ---- Payment attempts ---------------------------------------------------
 * One row per attempt at a provider. `provider_reference` is theirs, and
 * the pair (provider, provider_reference) identifies the payment
 * unambiguously when a webhook arrives.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  provider_reference  TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  minor_unit          INTEGER NOT NULL DEFAULT 2,
  status              TEXT NOT NULL DEFAULT 'pending',
  idempotency_key     TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_reference
  ON payment_attempts(provider, provider_reference);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payment_attempts(order_id);

/* ---- Webhook events -----------------------------------------------------
 * Every delivery is logged, including refused ones, so a signature problem
 * is diagnosable after the fact. The hash makes replay a no-op: the same
 * body delivered twice is one row.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS webhook_events (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  event_type     TEXT NOT NULL DEFAULT '',
  signature_ok   INTEGER NOT NULL DEFAULT 0,
  processed      INTEGER NOT NULL DEFAULT 0,
  result         TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_hash ON webhook_events(payload_hash);
