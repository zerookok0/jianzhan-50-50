/**
 * SQL BRANCHES for the fake D1.
 *
 * Each handler below corresponds to a statement the checkout / payment
 * path actually issues. Nothing here is speculative: every branch was
 * added because a real handler sent that SQL and the fake threw.
 *
 * The two invariants worth restating:
 *
 *   1. SELECT returns the whole row. Handlers read only the columns they
 *      asked for, so returning extra ones is harmless and removes a whole
 *      class of "wrong projection" bugs from the fake.
 *   2. An UPDATE evaluates its SET expressions against the OLD row, then
 *      reports `changes: 0` when the WHERE clause matched nothing.
 */

export function installBranches(api) {
  const { state, matchWhere, applyUpdate, updateHandlers, selectHandlers, fail } = api

  /* ------------------------------------------------------------------ */
  /* SELECT                                                              */
  /* ------------------------------------------------------------------ */

  const TABLES = [
    'orders',
    'order_items',
    'payment_attempts',
    'webhook_events',
    'inventory',
    'inventory_reservations',
    'coupon_redemptions',
    'audit_logs',
  ]

  for (const table of TABLES) {
    selectHandlers[`select:${table}`] = (sql, args) => {
      if (!new RegExp(`\\bFROM ${table}\\b`).test(sql)) return null

      let rows = state[table].filter((row) => matchWhere(sql, row, args))

      if (/ORDER BY created_at DESC/i.test(sql)) {
        rows = [...rows].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      } else if (/ORDER BY created_at/i.test(sql)) {
        rows = [...rows].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
      }

      const limit = sql.match(/LIMIT (\d+)/i)
      if (limit) rows = rows.slice(0, Number(limit[1]))

      // Return copies: callers must not mutate the store through a read.
      return { rows: rows.map((r) => ({ ...r })), changes: 0 }
    }
  }

  /* ------------------------------------------------------------------ */
  /* UPDATE                                                              */
  /* ------------------------------------------------------------------ */

  const update = (table, test) => (sql, args) => {
    if (!test(sql)) return null
    return applyUpdate(
      table,
      (row) => matchWhere(sql, row, args),
      sql,
      args,
    )
  }

  const branches = [
    /* -- inventory: conditional reserve (the oversell guard) -- */
    update('inventory', (s) => /^UPDATE inventory SET reserved = reserved \+/i.test(s)),

    /* -- inventory: release / expire -- */
    update('inventory', (s) => /^UPDATE inventory SET reserved = MAX\(0, reserved -/i.test(s)),

    /* -- inventory: commit (on_hand and reserved both fall) -- */
    update('inventory', (s) => /^UPDATE inventory SET on_hand = MAX\(0, on_hand -/i.test(s)),

    /* -- inventory reservations: any status transition -- */
    update('inventory_reservations', (s) => /^UPDATE inventory_reservations SET status =/i.test(s)),

    /* -- orders: paid (guarded by status != 'paid') -- */
    update('orders', (s) => /^UPDATE orders SET status = 'paid'/i.test(s)),

    /* -- orders: failed -- */
    update('orders', (s) => /^UPDATE orders SET status = 'failed'/i.test(s)),

    /* -- payment attempts: captured / failed -- */
    update('payment_attempts', (s) => /^UPDATE payment_attempts SET/i.test(s)),
  ]

  branches.forEach((fn, i) => {
    updateHandlers[`update:${i}`] = fn
  })

  /* -- rate limiting is not exercised here; make the gap explicit -- */
  updateHandlers['update:rate_limits'] = (sql) => {
    if (!/^UPDATE rate_limits/i.test(sql)) return null
    fail(sql)
  }
}

/**
 * `UPDATE t SET ...` → the text from SET to the end. `setAssignments`
 * finds SET itself and stops at WHERE, so passing the whole statement is
 * enough; this helper exists for readability at call sites.
 */
export function setClauseOf(sql) {
  const idx = sql.search(/\bSET\b/i)
  return idx === -1 ? sql : sql.slice(idx)
}
