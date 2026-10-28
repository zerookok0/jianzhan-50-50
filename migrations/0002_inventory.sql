-- ============================================================================
-- 0002 — INVENTORY
-- ----------------------------------------------------------------------------
-- Stock levels and the reservations that hold stock during checkout.
--
-- THE OVERSELL PROBLEM
-- Two customers buy the last bowl at the same instant. The fix is NOT a
-- read-then-write in application code — between the SELECT and the UPDATE
-- another request can take the unit. The fix is a single conditional
-- UPDATE that re-checks availability in its own WHERE clause:
--
--   UPDATE inventory
--      SET reserved = reserved + :qty
--    WHERE id = :id AND (on_hand - reserved) >= :qty
--
-- SQLite serialises writes, so exactly one of the two statements matches a
-- row and the loser sees `changes: 0`. That number is how
-- services/inventory.ts knows the reservation failed.
--
-- `sellable` is DENORMALISED on purpose: diagnostics and admin views query
-- "what is nearly sold out" across the whole table, and computing
-- on_hand - reserved per row would prevent an index from helping. Every
-- writer in services/inventory.ts maintains it in the same statement that
-- changes on_hand or reserved, so it cannot drift.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory (
  id              TEXT    PRIMARY KEY,
  product_id      TEXT    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  -- NULL means "the product as a whole"; a value means this specific option.
  variant_id      TEXT    REFERENCES product_variants (id) ON DELETE CASCADE,

  on_hand         INTEGER NOT NULL DEFAULT 0,
  reserved        INTEGER NOT NULL DEFAULT 0,
  sellable        INTEGER NOT NULL DEFAULT 0,

  -- is_tracked = 0 means unlimited (made to order, digital, services).
  is_tracked      INTEGER NOT NULL DEFAULT 1,
  -- allow_backorder = 1 means sell beyond on_hand even when tracked.
  allow_backorder INTEGER NOT NULL DEFAULT 0,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  CHECK (on_hand >= 0),
  CHECK (reserved >= 0),
  CHECK (is_tracked IN (0, 1)),
  CHECK (allow_backorder IN (0, 1))
);

/*
 * One inventory row per product/variant. `IFNULL(variant_id,'')` is required
 * because SQLite treats NULLs as distinct in a UNIQUE index — without it,
 * every INSERT of a variant-less row would be allowed and stock would be
 * split across duplicates, making the oversell guard useless.
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_target
  ON inventory (product_id, IFNULL(variant_id, ''));

/* "What is running out?" — used by the admin diagnostics counter. */
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock
  ON inventory (is_tracked, sellable);

/* ---- Reservations --------------------------------------------------------
 * A reservation is a hold, not a sale. It is created when an order is
 * placed, committed when payment is verified, and released if the order
 * fails or its TTL expires.
 *
 * `holder_type`/`holder_id` are a deliberately loose reference: a hold can
 * belong to a cart (a session that may never check out) or to an order.
 * A foreign key to either table would not type-check, so the pair is
 * indexed and the service layer is responsible for the invariant.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id           TEXT    PRIMARY KEY,
  inventory_id TEXT    NOT NULL REFERENCES inventory (id) ON DELETE CASCADE,
  holder_type  TEXT    NOT NULL,
  holder_id    TEXT    NOT NULL,
  quantity     INTEGER NOT NULL,

  -- active → committed | released | expired. Never goes backwards.
  status       TEXT    NOT NULL DEFAULT 'active',

  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  released_at  INTEGER,

  CHECK (quantity > 0),
  CHECK (holder_type IN ('cart', 'order')),
  CHECK (status IN ('active', 'committed', 'released', 'expired'))
);

/* Release/commit looks up every active hold for one holder. */
CREATE INDEX IF NOT EXISTS idx_reservations_holder
  ON inventory_reservations (holder_type, holder_id, status);

/* The cron sweeper scans for active holds past their TTL. */
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON inventory_reservations (status, expires_at);

/* ---- Adjustments ---------------------------------------------------------
 * An append-only ledger of manual stock changes. Without it, "why does the
 * shelf disagree with the database?" has no answer, and a mis-keyed
 * adjustment cannot be found later.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id           TEXT    PRIMARY KEY,
  inventory_id TEXT    NOT NULL REFERENCES inventory (id) ON DELETE CASCADE,
  delta        INTEGER NOT NULL,
  reason       TEXT    NOT NULL DEFAULT '',
  actor_id     TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adjustments_inventory
  ON inventory_adjustments (inventory_id, created_at DESC);
