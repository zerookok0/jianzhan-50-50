/* ==========================================================================
 * 0002 — Inventory and reservations
 *
 * The oversell guard lives here. `reserveStock` performs a conditional
 * UPDATE and reads `meta.changes`: one statement, so SQLite's atomicity is
 * the whole concurrency story. Two shoppers racing for the last bowl
 * produce one change and one no-op.
 *
 * Columns:
 *   on_hand        physical units
 *   reserved       units held by unpaid orders
 *   sellable       on_hand - reserved, maintained by the write path
 *   is_tracked     0 for made-to-order pieces, which never block
 *   allow_backorder 1 to permit selling past zero
 * ========================================================================== */

CREATE TABLE IF NOT EXISTS inventory (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id       TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  on_hand          INTEGER NOT NULL DEFAULT 0,
  reserved         INTEGER NOT NULL DEFAULT 0,
  sellable         INTEGER NOT NULL DEFAULT 0,
  is_tracked       INTEGER NOT NULL DEFAULT 1,
  allow_backorder  INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

/* One stock row per product, or per variant when options are stocked
 * separately. IFNULL keeps the two cases in one uniqueness rule, because
 * SQLite treats NULLs as distinct and would otherwise allow duplicates. */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_target
  ON inventory(product_id, IFNULL(variant_id, ''));

CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

/* ---- Reservations -------------------------------------------------------
 * A hold on stock, owned either by a cart (soft) or an order (hard).
 * `status` moves active → committed | released | expired.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id           TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  holder_type  TEXT NOT NULL,
  holder_id    TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_holder
  ON inventory_reservations(holder_type, holder_id, status);

CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON inventory_reservations(status, expires_at);
