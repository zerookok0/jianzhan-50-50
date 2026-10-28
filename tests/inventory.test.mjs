/**
 * INVENTORY CONCURRENCY TESTS
 *
 * The claim under test: two shoppers cannot buy the last bowl.
 *
 * The guard is a conditional UPDATE in services/inventory.ts:
 *
 *   UPDATE inventory SET reserved = reserved + ?
 *    WHERE id = ? AND (is_tracked = 0 OR allow_backorder = 1
 *                      OR (on_hand - reserved) >= ?)
 *
 * D1 is SQLite, so one statement is atomic. These tests model that
 * semantics against a fake D1 that applies each statement serially, which
 * is what SQLite guarantees.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reserveStock, releaseReservation, commitReservation } from '../worker/services/inventory.ts'

/* ---------------- Minimal in-memory D1 fake ---------------- */

function makeDb(initial) {
  const state = {
    inventory: new Map(initial.inventory.map((r) => [r.id, { ...r }])),
    reservations: [],
  }

  const prepared = []

  const db = {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          stmt.args = args
          return stmt
        },
        async run() {
          return applyStatement(state, sql, stmt.args)
        },
        async first() {
          const res = applyStatement(state, sql, stmt.args)
          return res.__rows?.[0] ?? null
        },
        async all() {
          const res = applyStatement(state, sql, stmt.args)
          return { results: res.__rows ?? [], meta: res.meta }
        },
      }
      prepared.push(stmt)
      return stmt
    },
    async batch(stmts) {
      // SQLite D1 batch is a transaction: apply in order.
      const out = []
      for (const s of stmts) out.push(await s.run())
      return out
    },
    _state: state,
  }

  return db
}

function applyStatement(state, sql, args) {
  const normalized = sql.replace(/\s+/g, ' ').trim()

  // Conditional reserve.
  if (normalized.startsWith('UPDATE inventory SET reserved = reserved +')) {
    const [id, qty] = args
    const row = state.inventory.get(id)
    if (!row) return { meta: { changes: 0 } }

    const available = row.on_hand - row.reserved
    const notTracked = row.is_tracked === 0
    const backorder = row.allow_backorder === 1

    if (notTracked || backorder || available >= qty) {
      row.reserved += qty
      row.sellable = row.on_hand - row.reserved
      return { meta: { changes: 1 } }
    }
    return { meta: { changes: 0 } }
  }

  // Release.
  if (normalized.startsWith('UPDATE inventory SET reserved = MAX(0, reserved -')) {
    const [id, qty] = args
    const row = state.inventory.get(id)
    if (row) {
      row.reserved = Math.max(0, row.reserved - qty)
      row.sellable = row.on_hand - row.reserved
    }
    return { meta: { changes: 1 } }
  }

  // Commit (deduct on_hand).
  if (normalized.includes('on_hand = MAX(0, on_hand -')) {
    const [id, qty] = args
    const row = state.inventory.get(id)
    if (row) {
      row.on_hand = Math.max(0, row.on_hand - qty)
      row.reserved = Math.max(0, row.reserved - qty)
      row.sellable = row.on_hand - row.reserved
    }
    return { meta: { changes: 1 } }
  }

  // Insert reservation.
  if (normalized.startsWith('INSERT INTO inventory_reservations')) {
    const [id, inventoryId, holderType, holderId, quantity] = args
    state.reservations.push({
      id,
      inventory_id: inventoryId,
      holder_type: holderType,
      holder_id: holderId,
      quantity,
      status: 'active',
    })
    return { meta: { changes: 1 } }
  }

  // Select active reservations for a holder. The SQL has 'active' and the
  // holder type as LITERALS, with only holder_id bound — so parse the type
  // out of the SQL rather than assuming it came from args.
  if (normalized.includes('FROM inventory_reservations') && normalized.includes("status = 'active'")) {
    const typeMatch = normalized.match(/holder_type\s*=\s*'([^']+)'/)
    const holderType = typeMatch ? typeMatch[1] : args[0]
    const holderId = typeMatch ? args[0] : args[1]

    const rows = state.reservations.filter(
      (r) => r.holder_type === holderType && r.holder_id === holderId && r.status === 'active',
    )
    return { __rows: rows, meta: { changes: 0 } }
  }

  // Mark reservation released/committed.
  if (normalized.startsWith('UPDATE inventory_reservations SET status')) {
    const [id, status] = args
    const r = state.reservations.find((x) => x.id === id)
    if (r) r.status = status
    return { meta: { changes: 1 } }
  }

  // Availability lookup used by getAvailability.
  if (normalized.includes('SELECT on_hand, reserved FROM inventory')) {
    const row = state.inventory.get(args[0])
    return { __rows: row ? [row] : [], meta: { changes: 0 } }
  }

  // Transaction wrapper.
  if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
    return { meta: { changes: 0 } }
  }

  return { meta: { changes: 0 } }
}

/* ---------------- Tests ---------------- */

test('reserving stock reduces availability', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 1, reserved: 0, sellable: 1, is_tracked: 1, allow_backorder: 0 }],
  })

  const result = await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 1, name: 'Bowl' }],
    { type: 'cart', id: 'cart-a' },
  )

  assert.equal(result.ok, true)
  assert.equal(db._state.inventory.get('inv1').reserved, 1)
})

test('the last item cannot be sold twice', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 1, reserved: 0, sellable: 1, is_tracked: 1, allow_backorder: 0 }],
  })

  // Two shoppers reserve the single bowl concurrently.
  const [first, second] = await Promise.all([
    reserveStock(
      db,
      [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 1, name: 'Bowl' }],
      { type: 'cart', id: 'cart-a' },
    ),
    reserveStock(
      db,
      [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 1, name: 'Bowl' }],
      { type: 'cart', id: 'cart-b' },
    ),
  ])

  const successes = [first, second].filter((r) => r.ok).length
  assert.equal(successes, 1, 'exactly one reservation may succeed')
  assert.equal(db._state.inventory.get('inv1').reserved, 1, 'never over-reserved')
})

test('oversell attempt reports available quantity', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 2, reserved: 0, sellable: 2, is_tracked: 1, allow_backorder: 0 }],
  })

  const result = await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 5, name: 'Bowl' }],
    { type: 'cart', id: 'cart-a' },
  )

  assert.equal(result.ok, false)
  assert.equal(result.failures[0].requested, 5)
  assert.equal(result.failures[0].available, 2)
  assert.equal(db._state.inventory.get('inv1').reserved, 0, 'failed reserve must not hold stock')
})

test('untracked stock is always reservable', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 0, reserved: 0, sellable: 0, is_tracked: 0, allow_backorder: 0 }],
  })

  const result = await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 99, name: 'Made to order' }],
    { type: 'cart', id: 'cart-a' },
  )
  assert.equal(result.ok, true, 'untracked products never block')
})

test('backorder-enabled stock allows overselling', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 0, reserved: 0, sellable: 0, is_tracked: 1, allow_backorder: 1 }],
  })

  const result = await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 3, name: 'Backorder' }],
    { type: 'cart', id: 'cart-a' },
  )
  assert.equal(result.ok, true)
})

test('releasing a reservation returns the stock', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 2, reserved: 0, sellable: 2, is_tracked: 1, allow_backorder: 0 }],
  })

  await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 2, name: 'Bowl' }],
    { type: 'cart', id: 'cart-a' },
  )
  assert.equal(db._state.inventory.get('inv1').reserved, 2)

  await releaseReservation(db, { type: 'cart', id: 'cart-a' })
  assert.equal(db._state.inventory.get('inv1').reserved, 0)
})

test('committing deducts on_hand permanently', async () => {
  const db = makeDb({
    inventory: [{ id: 'inv1', on_hand: 3, reserved: 0, sellable: 3, is_tracked: 1, allow_backorder: 0 }],
  })

  await reserveStock(
    db,
    [{ inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 1, name: 'Bowl' }],
    { type: 'order', id: 'order-a' },
  )

  await commitReservation(db, { type: 'order', id: 'order-a' })

  const row = db._state.inventory.get('inv1')
  assert.equal(row.on_hand, 2, 'physical stock reduced')
  assert.equal(row.reserved, 0, 'reservation cleared')
})

test('multi-line reservation is all-or-nothing', async () => {
  const db = makeDb({
    inventory: [
      { id: 'inv1', on_hand: 5, reserved: 0, sellable: 5, is_tracked: 1, allow_backorder: 0 },
      { id: 'inv2', on_hand: 1, reserved: 0, sellable: 1, is_tracked: 1, allow_backorder: 0 },
    ],
  })

  // Line 1 is fine, line 2 wants more than exists.
  const result = await reserveStock(
    db,
    [
      { inventoryId: 'inv1', productId: 'p1', variantId: null, quantity: 2, name: 'A' },
      { inventoryId: 'inv2', productId: 'p2', variantId: null, quantity: 9, name: 'B' },
    ],
    { type: 'cart', id: 'cart-a' },
  )

  assert.equal(result.ok, false)
  assert.equal(db._state.inventory.get('inv1').reserved, 0, 'partial success must roll back')
})
