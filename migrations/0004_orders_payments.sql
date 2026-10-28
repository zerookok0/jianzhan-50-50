-- ============================================================================
-- 0004 — ORDERS, PAYMENTS & WEBHOOKS
-- ----------------------------------------------------------------------------
-- The three tables that make up the money path. Read the notes on each
-- unique index before changing them: they are load-bearing, not decoration.
--
-- ORDER STATE MACHINE
--
--   pending ──► paid ──► refunded
--      │
--      ├──────► failed
--      └──────► cancelled
--
-- Only a verified webhook (or an explicit admin action) may move an order
-- into `paid`. A browser redirect back from a provider proves nothing and
-- is never consulted. See worker/routes/webhooks.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT    PRIMARY KEY,

  /*
   * The public handle: JZ-XXXX-XXXX-XXXX. This is the ONLY identifier the
   * storefront ever exposes, and it is unguessable rather than sequential,
   * so orders cannot be enumerated by trying 1, 2, 3.
   *
   * UNIQUE is enforced here because lookup-by-reference is the entire
   * access-control story for the order confirmation page: if two orders
   * could share a reference, that page could show the wrong one.
   */
  public_reference   TEXT    NOT NULL UNIQUE,

  cart_id            TEXT    REFERENCES carts (id) ON DELETE SET NULL,

  email              TEXT    NOT NULL,
  phone              TEXT    NOT NULL DEFAULT '',

  -- Money in minor units, with the currency context needed to render it.
  currency           TEXT    NOT NULL DEFAULT 'USD',
  minor_unit         INTEGER NOT NULL DEFAULT 2,
  subtotal           INTEGER NOT NULL DEFAULT 0,
  discount_total     INTEGER NOT NULL DEFAULT 0,
  shipping_total     INTEGER NOT NULL DEFAULT 0,
  tax_total          INTEGER NOT NULL DEFAULT 0,
  grand_total        INTEGER NOT NULL DEFAULT 0,

  status             TEXT    NOT NULL DEFAULT 'pending',
  fulfilment_status  TEXT    NOT NULL DEFAULT 'unfulfilled',

  -- Addresses are JSON snapshots, not foreign keys. An order must keep the
  -- address it was shipped to even if the customer later edits their saved
  -- address — a mutable reference would silently rewrite history.
  billing_address    TEXT    NOT NULL DEFAULT '{}',
  shipping_address   TEXT    NOT NULL DEFAULT '{}',

  shipping_method_id  TEXT,
  shipping_method_name TEXT   NOT NULL DEFAULT '',

  customer_note      TEXT    NOT NULL DEFAULT '',

  /*
   * Protects against a double-clicked "Place order" creating two orders.
   * UNIQUE, so the second insert fails rather than charging twice, and
   * services/orders.ts returns the first order instead.
   */
  idempotency_key    TEXT    UNIQUE,

  /*
   * 0 while stock is only reserved, 1 once payment is confirmed and the
   * reservation has been converted into a real deduction. The column exists
   * so committing reservations is idempotent: a retried webhook must not
   * decrement on_hand a second time.
   */
  stock_committed    INTEGER NOT NULL DEFAULT 0,

  /*
   * When an unpaid order stops holding its stock. NULL once the order is
   * paid or otherwise terminal. The cron sweeper reads this to release
   * reservations from checkouts that were abandoned mid-payment.
   */
  expires_at         INTEGER,

  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,

  CHECK (subtotal >= 0),
  CHECK (discount_total >= 0),
  CHECK (shipping_total >= 0),
  CHECK (tax_total >= 0),
  CHECK (grand_total >= 0),
  CHECK (minor_unit >= 0 AND minor_unit <= 4),
  CHECK (stock_committed IN (0, 1)),
  CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  CHECK (fulfilment_status IN ('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled'))
);

/* Admin order list: newest first, optionally filtered by status. */
CREATE INDEX IF NOT EXISTS idx_orders_created
  ON orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

/* Order confirmation lookup by the public reference. */
CREATE INDEX IF NOT EXISTS idx_orders_reference
  ON orders (public_reference);

/* The cron sweeper: pending orders holding stock past their deadline. */
CREATE INDEX IF NOT EXISTS idx_orders_expiry
  ON orders (status, expires_at);

/* ---- Order items ---------------------------------------------------------
 * An immutable snapshot taken at purchase time. Names, SKUs and prices are
 * COPIED, not joined: renaming a product or changing its price must never
 * alter what a customer was charged last month.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS order_items (
  id             TEXT    PRIMARY KEY,
  order_id       TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

  -- Kept for analytics and reordering, with ON DELETE SET NULL so purging a
  -- product does not delete the record of having sold it.
  product_id     TEXT    REFERENCES products (id) ON DELETE SET NULL,
  variant_id     TEXT    REFERENCES product_variants (id) ON DELETE SET NULL,

  name           TEXT    NOT NULL,
  variant_label  TEXT    NOT NULL DEFAULT '',
  sku            TEXT    NOT NULL DEFAULT '',

  unit_price     INTEGER NOT NULL,
  quantity       INTEGER NOT NULL,
  line_subtotal  INTEGER NOT NULL,
  line_discount  INTEGER NOT NULL DEFAULT 0,
  line_tax       INTEGER NOT NULL DEFAULT 0,
  line_total     INTEGER NOT NULL,

  -- Tax is recorded per line, at the rate actually applied. Recomputing tax
  -- for a historic order from today's rules would produce a different
  -- number every time a rate changed.
  tax_class      TEXT    NOT NULL DEFAULT 'standard',
  tax_rate_bp    INTEGER NOT NULL DEFAULT 0,

  weight_g       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,

  CHECK (unit_price >= 0),
  CHECK (quantity > 0),
  CHECK (line_subtotal >= 0),
  CHECK (line_discount >= 0),
  CHECK (line_tax >= 0),
  CHECK (line_total >= 0),
  CHECK (tax_rate_bp >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id, created_at);

/* ---- Payment attempts ----------------------------------------------------
 * Every attempt to collect money, one row each. Kept separate from orders so
 * a retried payment (first card declined, second succeeded) leaves a
 * complete trail instead of overwriting the failure.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                 TEXT    PRIMARY KEY,
  order_id           TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

  provider           TEXT    NOT NULL,
  -- The provider's own id for this payment. Never our order id.
  provider_reference TEXT    NOT NULL,

  amount             INTEGER NOT NULL,
  currency           TEXT    NOT NULL DEFAULT 'USD',

  -- created → pending → authorised → captured | failed | cancelled | refunded
  status             TEXT    NOT NULL DEFAULT 'created',

  /*
   * Sent to the provider so a retried request cannot create a second
   * charge. UNIQUE because the whole point is that the same key maps to
   * one attempt.
   */
  idempotency_key    TEXT    UNIQUE,

  /*
   * Provider metadata safe to persist — redirect URLs, session ids. Card
   * data must NEVER appear here: this column is read by admin endpoints and
   * included in support exports.
   */
  metadata           TEXT    NOT NULL DEFAULT '{}',

  error_code         TEXT,
  error_message      TEXT,

  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,

  CHECK (amount >= 0),
  CHECK (status IN (
    'created', 'pending', 'authorised', 'captured',
    'failed', 'cancelled', 'refunded', 'partially_refunded'
  ))
);

/* "What is the latest attempt for this order?" — read on every webhook. */
CREATE INDEX IF NOT EXISTS idx_attempts_order
  ON payment_attempts (order_id, created_at DESC);

/* Provider reconciliation: find our record from their reference. */
CREATE INDEX IF NOT EXISTS idx_attempts_provider_ref
  ON payment_attempts (provider, provider_reference);

/* ---- Webhook events ------------------------------------------------------
 * An append-only log of every delivery, including rejected ones. It is both
 * the replay guard and the audit trail for "the provider says it paid, we
 * say it did not".
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS webhook_events (
  id             TEXT    PRIMARY KEY,
  provider       TEXT    NOT NULL,

  -- The provider's event id, when it sends one. Not relied on for dedupe:
  -- not every provider includes it, and it may repeat.
  provider_event TEXT,
  event_type     TEXT    NOT NULL DEFAULT '',

  /*
   * SHA-256 of the exact request body. This is the replay guard.
   *
   * UNIQUE(provider, payload_hash) means a redelivered identical payload
   * collapses onto one row. Without it, every provider retry after a
   * timeout would run markOrderPaid again; that happens to be idempotent,
   * but any future side effect on this path (sending a receipt email, for
   * instance) would not be.
   */
  payload_hash   TEXT    NOT NULL,

  -- Recorded even when verification FAILS, because a stream of bad
  -- signatures is exactly what an operator needs to see.
  signature_ok   INTEGER NOT NULL DEFAULT 0,

  -- 0 means "received but not applied" — a mismatch, an unknown order, or
  -- a transient failure the provider should retry.
  processed      INTEGER NOT NULL DEFAULT 0,
  error          TEXT,

  received_at    INTEGER NOT NULL,
  processed_at   INTEGER,

  CHECK (signature_ok IN (0, 1)),
  CHECK (processed IN (0, 1))
);

/*
 * The replay guard. Named so `scripts/check-migrations.mjs` can assert its
 * presence: webhook replay protection depends on this exact constraint.
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_hash
  ON webhook_events (provider, payload_hash);

/* Operator view: recent failures. */
CREATE INDEX IF NOT EXISTS idx_webhook_received
  ON webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_unprocessed
  ON webhook_events (processed, received_at);
