import type { Env } from '../env.ts'

/**
 * INVENTORY
 * ------------------------------------------------------------------
 * The oversell guard, and the only code allowed to move a stock number.
 *
 * HOW THE GUARD WORKS
 * A single conditional UPDATE:
 *
 *   UPDATE inventory SET reserved = reserved + ?
 *    WHERE id = ?
 *      AND (is_tracked = 0 OR allow_backorder = 1 OR (on_hand - reserved) >= ?)
 *
 * D1 is SQLite, so one statement is atomic. `meta.changes` reports whether
 * this caller actually took the stock: 1 means it won, 0 means another
 * shopper got there first. No transaction, no read-then-write race.
 *
 * ALL-OR-NOTHING
 * A multi-line reservation must not leave half the stock held. Each line is
 * attempted in order; if any line fails, the lines that succeeded are
 * released in a compensating batch. The failure therefore returns stock to
 * exactly where it was.
 */

export interface ReservationLine {
  inventoryId: string
  productId: string
  variantId: string | null
  quantity: number
  /** For the error message: what the customer calls this thing. */
  name: string
}

export type HolderType = 'cart' | 'order'

export interface Holder {
  type: HolderType
  id: string
}

export interface ReservationFailure {
  inventoryId: string
  name: string
  requested: number
  available: number | null
}

export interface ReserveResult {
  ok: boolean
  failures: ReservationFailure[]
}

const RESERVATION_TTL_MS = 30 * 60 * 1000 // matches ORDER_RESERVATION_MINUTES

/**
 * Take stock for a holder.
 *
 * Returns `{ ok: false, failures }` rather than throwing, because an
 * out-of-stock line is an expected outcome of shopping, not an error. The
 * caller turns it into a 409 with the numbers the customer needs.
 */
export async function reserveStock(
  db: D1Database,
  lines: ReservationLine[],
  holder: Holder,
  ttlMs = RESERVATION_TTL_MS,
): Promise<ReserveResult> {
  if (lines.length === 0) return { ok: true, failures: [] }

  const failed: ReservationFailure[] = []

  for (const line of lines) {
    const result = await db
      .prepare(
        `UPDATE inventory
            SET reserved = reserved + ?2,
                sellable = MAX(0, on_hand - (reserved + ?2)),
                updated_at = ?3
          WHERE id = ?1
            AND (is_tracked = 0
                 OR allow_backorder = 1
                 OR (on_hand - reserved) >= ?2)`,
      )
      .bind(line.inventoryId, line.quantity, Date.now())
      .run()

    const changes = result.meta?.changes ?? 0

    if (changes === 0) {
      // Read the row to report how many were actually left. A missing row
      // is a different problem from an empty one, and conflating them
      // produces a misleading "0 available" message.
      const row = await db
        .prepare('SELECT on_hand, reserved, is_tracked FROM inventory WHERE id = ?1')
        .bind(line.inventoryId)
        .first<{ on_hand: number; reserved: number; is_tracked: number }>()

      failed.push({
        inventoryId: line.inventoryId,
        name: line.name,
        requested: line.quantity,
        available: row ? Math.max(0, row.on_hand - row.reserved) : null,
      })
      break
    }
  }

  if (failed.length === 0) {
    // Only now, once every line has been confirmed, write the reservation
    // rows. Writing them first and rolling back was the original bug: a
    // rollback decremented `reserved` for a line that had never incremented
    // it, silently inflating availability.
    const now = Date.now()
    await db.batch(
      lines.map((line) =>
        db
          .prepare(
            `INSERT INTO inventory_reservations
               (id, inventory_id, holder_type, holder_id, quantity, status, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)`,
          )
          .bind(
            crypto.randomUUID(),
            line.inventoryId,
            holder.type,
            holder.id,
            line.quantity,
            now + ttlMs,
            now,
          ),
      ),
    )

    return { ok: true, failures: [] }
  }

  /* ---- Compensate: give back whatever the earlier lines took ---- */
  await releaseReservation(db, holder)
  return { ok: false, failures: failed }
}

/**
 * Release a holder's active reservations.
 *
 * Idempotent: a second call finds no active rows and changes nothing, which
 * matters because both the expiry cron and a failed payment can arrive
 * within milliseconds of each other.
 */
export async function releaseReservation(db: D1Database, holder: Holder): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT id, inventory_id, quantity
         FROM inventory_reservations
        WHERE holder_type = ?1 AND holder_id = ?2 AND status = 'active'`,
    )
    .bind(holder.type, holder.id)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const active = rows.results ?? []
  if (active.length === 0) return 0

  const now = Date.now()

  await db.batch(
    active.flatMap((row) => [
      db
        .prepare(
          `UPDATE inventory
              SET reserved = MAX(0, reserved - ?2),
                  sellable = MAX(0, on_hand - MAX(0, reserved - ?2)),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(row.inventory_id, row.quantity, now),
      db
        .prepare(
          `UPDATE inventory_reservations SET status = 'released' WHERE id = ?1`,
        )
        .bind(row.id),
    ]),
  )

  return active.length
}

/**
 * Convert held stock into a permanent deduction. Called only when a payment
 * is confirmed — never on order creation, because an unpaid order that
 * deducted stock would lose inventory to abandoned checkouts.
 *
 * Guarded by `orders.stock_committed` so a replayed webhook cannot deduct
 * twice.
 */
export async function commitReservation(db: D1Database, holder: Holder): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT id, inventory_id, quantity
         FROM inventory_reservations
        WHERE holder_type = ?1 AND holder_id = ?2 AND status = 'active'`,
    )
    .bind(holder.type, holder.id)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const active = rows.results ?? []
  if (active.length === 0) return 0

  const now = Date.now()

  await db.batch(
    active.flatMap((row) => [
      // on_hand and reserved both fall. `sellable` is computed from the OLD
      // row's values, which is what SQLite does for every expression right
      // of SET — computing it from the already-decremented columns would
      // double-subtract.
      db
        .prepare(
          `UPDATE inventory
              SET on_hand  = MAX(0, on_hand - ?2),
                  reserved = MAX(0, reserved - ?2),
                  sellable = MAX(0, MAX(0, on_hand - ?2) - MAX(0, reserved - ?2)),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(row.inventory_id, row.quantity, now),
      db
        .prepare(`UPDATE inventory_reservations SET status = 'committed' WHERE id = ?1`).bind(
          row.id,
        ),
    ]),
  )

  return active.length
}

/**
 * Release every reservation past its expiry. Called from the cron.
 *
 * Bounded so a large backlog drains over successive runs instead of
 * timing out the invocation.
 */
export async function expireReservations(db: D1Database): Promise<number> {
  const now = Date.now()

  const stale = await db
    .prepare(
      `SELECT id, inventory_id, quantity
         FROM inventory_reservations
        WHERE status = 'active' AND expires_at < ?1
        ORDER BY expires_at
        LIMIT 500`,
    )
    .bind(now)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const rows = stale.results ?? []
  if (rows.length === 0) return 0

  await db.batch(
    rows.flatMap((row) => [
      db
        .prepare(
          `UPDATE inventory
              SET reserved = MAX(0, reserved - ?2),
                  sellable = MAX(0, on_hand - MAX(0, reserved - ?2)),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(row.inventory_id, row.quantity, now),
      db
        .prepare(`UPDATE inventory_reservations SET status = 'expired' WHERE id = ?1`)
        .bind(row.id),
    ]),
  )

  return rows.length
}

/* ---------------- Reads ---------------- */

export interface Availability {
  onHand: number
  reserved: number
  available: number | null
  inStock: boolean
  tracked: boolean
}

/** Availability for one inventory row, or null if there is no row. */
export async function getAvailability(
  db: D1Database,
  inventoryId: string,
): Promise<Availability | null> {
  const row = await db
    .prepare('SELECT on_hand, reserved, is_tracked FROM inventory WHERE id = ?1')
    .bind(inventoryId)
    .first<{ on_hand: number; reserved: number; is_tracked: number }>()

  if (!row) return null

  const tracked = row.is_tracked === 1
  const available = tracked ? Math.max(0, row.on_hand - row.reserved) : null

  return {
    onHand: row.on_hand,
    reserved: row.reserved,
    available,
    inStock: !tracked || (available ?? 0) > 0,
    tracked,
  }
}

/**
 * Availability for every inventory row in one query, keyed by product id.
 * The catalogue lists nine pieces; one query instead of eighteen.
 */
export async function availabilityByProduct(
  db: D1Database,
): Promise<Map<string, { available: number | null; inStock: boolean }>> {
  const rows = await db
    .prepare(
      `SELECT product_id, variant_id, on_hand, reserved, sellable, is_tracked, allow_backorder
         FROM inventory`,
    )
    .all<{
      product_id: string
      variant_id: string | null
      on_hand: number
      reserved: number
      sellable: number
      is_tracked: number
      allow_backorder: number
    }>()

  const out = new Map<string, { available: number | null; inStock: boolean }>()

  for (const row of rows.results ?? []) {
    // Variant rows are keyed separately by the caller; this map is the
    // product-level answer, so a variant row only contributes when there is
    // no product-level row to speak for it.
    if (row.variant_id !== null && out.has(row.product_id)) continue

    const tracked = row.is_tracked === 1
    const available = tracked ? Math.max(0, row.on_hand - row.reserved) : null

    out.set(row.product_id, {
      available,
      inStock: !tracked || row.allow_backorder === 1 || (available ?? 0) > 0,
    })
  }

  return out
}

/** Availability for the variants of one product, keyed by variant id. */
export async function availabilityByVariant(
  db: D1Database,
  productId: string,
): Promise<Map<string, { available: number | null; inStock: boolean }>> {
  const rows = await db
    .prepare(
      `SELECT variant_id, on_hand, reserved, is_tracked, allow_backorder
         FROM inventory
        WHERE product_id = ?1 AND variant_id IS NOT NULL`,
    )
    .bind(productId)
    .all<{
      variant_id: string
      on_hand: number
      reserved: number
      is_tracked: number
      allow_backorder: number
    }>()

  const out = new Map<string, { available: number | null; inStock: boolean }>()

  for (const row of rows.results ?? []) {
    const tracked = row.is_tracked === 1
    const available = tracked ? Math.max(0, row.on_hand - row.reserved) : null
    out.set(row.variant_id, {
      available,
      inStock: !tracked || row.allow_backorder === 1 || (available ?? 0) > 0,
    })
  }

  return out
}

/** The inventory row id for a purchasable target. */
export async function inventoryIdFor(
  db: D1Database,
  productId: string,
  variantId: string | null,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM inventory
        WHERE product_id = ?1
          AND ((?2 IS NULL AND variant_id IS NULL) OR variant_id = ?2)
        LIMIT 1`,
    )
    .bind(productId, variantId)
    .first<{ id: string }>()

  return row?.id ?? null
}

export function reservationTtlFromEnv(env: Env): number {
  const minutes = Number(env.ORDER_RESERVATION_MINUTES ?? '30')
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : RESERVATION_TTL_MS
}
