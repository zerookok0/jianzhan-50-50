import { outOfStock } from '../lib/errors.ts'

/**
 * INVENTORY
 * ------------------------------------------------------------------
 * Reserving and committing stock without overselling.
 *
 * The hard case: two customers buy the last bowl at the same time. D1 is
 * SQLite, and each statement is atomic, so the guard is a conditional
 * UPDATE whose WHERE clause re-checks availability. If the update affects
 * zero rows, someone else won and we fail cleanly.
 *
 *   UPDATE inventory
 *      SET reserved = reserved + ?
 *    WHERE id = ? AND (is_tracked = 0 OR allow_backorder = 1
 *                      OR on_hand - reserved >= ?)
 *
 * That single statement is the whole concurrency story — no SELECT-then-
 * UPDATE window, no lost update, no table lock needed.
 *
 * IMPORTANT SEQUENCING
 * --------------------
 * The reservation ROW is written only after its stock UPDATE is confirmed
 * to have changed a row. Writing the row unconditionally and rolling back
 * afterwards would decrement `reserved` for lines that never incremented
 * it — silently inflating availability. That exact bug was caught by
 * tests/inventory.test.mjs.
 */

export interface StockLine {
  inventoryId: string
  productId: string
  variantId: string | null
  quantity: number
  /** For error messages. */
  name: string
}

export interface ReservationResult {
  ok: boolean
  /** Lines that could not be reserved. */
  failures: { name: string; requested: number; available: number | null }[]
}

const DEFAULT_TTL_MS = 1000 * 60 * 30

/**
 * Reserve stock for a cart or an order.
 *
 * Returns ok:false with per-line detail instead of throwing, so the caller
 * can decide whether to fail the whole request or report which items are
 * short.
 */
export async function reserveStock(
  db: D1Database,
  lines: StockLine[],
  holder: { type: 'cart' | 'order'; id: string },
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ReservationResult> {
  if (!lines.length) return { ok: true, failures: [] }

  const now = Date.now()
  const expiresAt = now + ttlMs

  /* ---- Phase 1: conditionally increment `reserved` for every line ---- */

  const updateStatements = lines.map((line) =>
    db
      .prepare(
        `UPDATE inventory
            SET reserved = reserved + ?2,
                sellable = on_hand - (reserved + ?2),
                updated_at = ?3
          WHERE id = ?1
            AND (
              is_tracked = 0
              OR allow_backorder = 1
              OR (on_hand - reserved) >= ?2
            )`,
      )
      .bind(line.inventoryId, line.quantity, now),
  )

  const updateResults = await db.batch(updateStatements)

  /* ---- Phase 2: work out which lines actually took the stock ---- */

  const succeeded: StockLine[] = []
  const failures: ReservationResult['failures'] = []

  for (let i = 0; i < lines.length; i++) {
    if ((updateResults[i].meta.changes ?? 0) > 0) {
      succeeded.push(lines[i])
      continue
    }
    const stock = await db
      .prepare('SELECT on_hand, reserved FROM inventory WHERE id = ?1')
      .bind(lines[i].inventoryId)
      .first<{ on_hand: number; reserved: number }>()

    failures.push({
      name: lines[i].name,
      requested: lines[i].quantity,
      available: stock ? Math.max(0, stock.on_hand - stock.reserved) : null,
    })
  }

  /* ---- Phase 3a: partial failure — undo ONLY what succeeded ---- */

  if (failures.length) {
    if (succeeded.length) {
      await db.batch(
        succeeded.map((line) =>
          db
            .prepare(
              `UPDATE inventory
                  SET reserved = MAX(0, reserved - ?2),
                      sellable = on_hand - MAX(0, reserved - ?2),
                      updated_at = ?3
                WHERE id = ?1`,
            )
            .bind(line.inventoryId, line.quantity, now),
        ),
      )
    }
    return { ok: false, failures }
  }

  /* ---- Phase 3b: all succeeded — record the reservation rows ---- */

  await db.batch(
    succeeded.map((line) =>
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
          expiresAt,
          now,
        ),
    ),
  )

  return { ok: true, failures: [] }
}

/** Release held stock (cart abandoned, order cancelled, payment failed). */
export async function releaseReservation(
  db: D1Database,
  holder: { type: 'cart' | 'order'; id: string },
): Promise<void> {
  const now = Date.now()

  const reservations = await db
    .prepare(
      `SELECT id, inventory_id, quantity FROM inventory_reservations
       WHERE holder_type = ?1 AND holder_id = ?2 AND status = 'active'`,
    )
    .bind(holder.type, holder.id)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const rows = reservations.results ?? []
  if (!rows.length) return

  const statements: D1PreparedStatement[] = []

  for (const r of rows) {
    statements.push(
      db
        .prepare(
          `UPDATE inventory
              SET reserved = MAX(0, reserved - ?2),
                  sellable = on_hand - MAX(0, reserved - ?2),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(r.inventory_id, r.quantity, now),
    )

    statements.push(
      db
        .prepare(
          `UPDATE inventory_reservations SET status = 'released', released_at = ?2 WHERE id = ?1`,
        )
        .bind(r.id, now),
    )
  }

  await db.batch(statements)
}

/**
 * Convert an active reservation into a permanent deduction (payment
 * succeeded). `reserved` and `on_hand` both fall.
 */
export async function commitReservation(
  db: D1Database,
  holder: { type: 'order'; id: string },
): Promise<void> {
  const now = Date.now()

  const reservations = await db
    .prepare(
      `SELECT id, inventory_id, quantity FROM inventory_reservations
       WHERE holder_type = 'order' AND holder_id = ?1 AND status = 'active'`,
    )
    .bind(holder.id)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const rows = reservations.results ?? []
  if (!rows.length) return

  const statements: D1PreparedStatement[] = []

  for (const r of rows) {
    statements.push(
      db
        .prepare(
          `UPDATE inventory
              SET on_hand = MAX(0, on_hand - ?2),
                  reserved = MAX(0, reserved - ?2),
                  sellable = MAX(0, on_hand - ?2) - MAX(0, reserved - ?2),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(r.inventory_id, r.quantity, now),
    )

    statements.push(
      db
        .prepare(
          `UPDATE inventory_reservations SET status = 'committed', released_at = ?2 WHERE id = ?1`,
        )
        .bind(r.id, now),
    )
  }

  await db.batch(statements)
}

/**
 * Release reservations whose TTL has passed.
 * Called from a cron trigger so a crashed checkout cannot hold stock
 * forever.
 */
export async function expireReservations(db: D1Database): Promise<number> {
  const now = Date.now()

  const expired = await db
    .prepare(
      `SELECT id, inventory_id, quantity FROM inventory_reservations
       WHERE status = 'active' AND expires_at < ?1
       LIMIT 500`,
    )
    .bind(now)
    .all<{ id: string; inventory_id: string; quantity: number }>()

  const rows = expired.results ?? []
  if (!rows.length) return 0

  const statements: D1PreparedStatement[] = []

  for (const r of rows) {
    statements.push(
      db
        .prepare(
          `UPDATE inventory
              SET reserved = MAX(0, reserved - ?2),
                  sellable = on_hand - MAX(0, reserved - ?2),
                  updated_at = ?3
            WHERE id = ?1`,
        )
        .bind(r.inventory_id, r.quantity, now),
    )
    statements.push(
      db
        .prepare(
          `UPDATE inventory_reservations SET status = 'expired', released_at = ?2 WHERE id = ?1`,
        )
        .bind(r.id, now),
    )
  }

  await db.batch(statements)
  return rows.length
}

/** Read current availability for a set of inventory ids. */
export async function getAvailability(
  db: D1Database,
  inventoryIds: string[],
): Promise<Map<string, { onHand: number; reserved: number; available: number; tracked: boolean }>> {
  const out = new Map<
    string,
    { onHand: number; reserved: number; available: number; tracked: boolean }
  >()
  if (!inventoryIds.length) return out

  const placeholders = inventoryIds.map((_, i) => `?${i + 1}`).join(',')
  const res = await db
    .prepare(
      `SELECT id, on_hand, reserved, is_tracked, allow_backorder FROM inventory
       WHERE id IN (${placeholders})`,
    )
    .bind(...inventoryIds)
    .all<{
      id: string
      on_hand: number
      reserved: number
      is_tracked: number
      allow_backorder: number
    }>()

  for (const r of res.results ?? []) {
    const tracked = r.is_tracked === 1
    out.set(r.id, {
      onHand: r.on_hand,
      reserved: r.reserved,
      available: tracked ? Math.max(0, r.on_hand - r.reserved) : Number.MAX_SAFE_INTEGER,
      tracked,
    })
  }
  return out
}

/** Throw a consistent out-of-stock error from reservation failures. */
export function stockError(failures: ReservationResult['failures']) {
  const detail = failures.map((f) => ({
    name: f.name,
    requested: f.requested,
    available: f.available,
  }))
  const first = failures[0]
  const message =
    first.available === null
      ? `“${first.name}” is no longer available.`
      : first.available === 0
        ? `“${first.name}” is sold out.`
        : `Only ${first.available} of “${first.name}” remain.`
  return outOfStock(message, { items: detail })
}
