/**
 * D1 SHIM OVER SQL.JS (WASM SQLITE)
 * ------------------------------------------------------------------
 * WHY THIS EXISTS
 * The Worker is written against Cloudflare's D1 binding (`env.DB`), which
 * in production is SQLite behind Cloudflare's runtime. Two things rule out
 * the obvious local options in this sandbox:
 *
 *   • `wrangler dev` needs `workerd`, a native binary that fails to exec
 *     here ("can't open input file").
 *   • `node:sqlite` ships as a decoy in this environment: the constructor
 *     exists, the prototype has no methods, and `prepare()` is undefined.
 *
 * `sql.js` is SQLite compiled to WebAssembly, so it runs anywhere
 * JavaScript runs — including here. This module maps the slice of the D1
 * interface the Worker actually uses onto it. The Worker itself is
 * unmodified: same SQL, same control flow, same error handling.
 *
 * THE SURFACE MODELLED
 *   prepare(sql).bind(...).first() / .all() / .run()
 *   batch([statements])   → one transaction, results in order
 *   meta.changes          → affected-row count. `reserveStock` reads this
 *                           to decide whether a conditional UPDATE won the
 *                           race against another shopper.
 *
 * WHAT IS NOT MODELLED
 *   Replication, D1's row limits, and true isolation between concurrent
 *   writers. sql.js is single-threaded, so concurrency here is cooperative
 *   rather than parallel — which is why the oversell tests live in
 *   tests/inventory.test.mjs against a serial fake, not against this.
 *   The SQL is identical, so a wrong query is wrong in both places.
 *
 * PERSISTENCE
 * sql.js keeps the database in memory. `save()` writes it to disk and
 * `load()` reads it back, so a restart keeps the catalogue and any orders
 * placed during testing.
 */

import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** D1 tolerates `undefined` as a bind value; SQLite does not. */
function bindValue(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

export async function openDatabase(filePath) {
  const SQL = await initSqlJs()

  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = existsSync(filePath)
    ? new SQL.Database(readFileSync(filePath))
    : new SQL.Database()

  // Foreign keys are OFF by default in SQLite. The schema relies on them:
  // without this a cart line could outlive the product it points at.
  db.run('PRAGMA foreign_keys = ON')

  /**
   * Are we inside a `batch()` transaction?
   *
   * This flag is the whole reason order creation used to 500. `save()`
   * calls `db.export()`, and sql.js refuses to export while a write
   * transaction is open ("SQLite is busy or locked"). `batch()` calls
   * `run()` per statement, so the first INSERT tried to export mid-
   * transaction, threw, and took the entire batch — and with it the
   * order — down with it.
   *
   * D1 persists once the batch commits, so the shim now does the same:
   * writes inside a transaction are recorded and a single save happens
   * after COMMIT.
   */
  let inTransaction = false

  /** Persist to disk. A no-op mid-transaction; `batch()` saves on commit. */
  function save() {
    if (inTransaction) return
    writeFileSync(filePath, Buffer.from(db.export()))
  }

  /**
   * Execute and return rows. `db.exec` gives [{columns, values}], which is
   * awkward to map; `prepare` + `step` yields objects directly.
   */
  function query(sql, args) {
    const stmt = db.prepare(sql)
    try {
      if (args.length) stmt.bind(args.map(bindValue))
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  function runStatement(sql, args) {
    const stmt = db.prepare(sql)
    try {
      if (args.length) stmt.bind(args.map(bindValue))
      stmt.step()
      return db.getRowsModified()
    } finally {
      stmt.free()
    }
  }

  /**
   * D1's bind() returns a NEW statement, so an unbound statement can be
   * reused with different values. Mutating a shared handle would corrupt
   * callers that bind twice, so each bind produces a fresh handle.
   */
  function makeStatement(sql, args) {
    return {
      __sql: sql,
      bind: (...next) => makeStatement(sql, next),

      async first() {
        const rows = query(sql, args)
        return rows.length ? rows[0] : null
      },

      async all() {
        return { results: query(sql, args), meta: { changes: 0 } }
      },

      async run() {
        const changes = runStatement(sql, args)
        save()
        return { meta: { changes: Number(changes ?? 0) } }
      },
    }
  }

  const d1 = {
    prepare: (sql) => makeStatement(sql, []),

    /**
     * D1 runs a batch as one transaction. Ordering matters beyond
     * atomicity: `reserveStock` inspects each result in sequence to decide
     * which lines took stock and which lost the race.
     */
    async batch(statements) {
      db.run('BEGIN')
      inTransaction = true
      try {
        const out = []
        for (const st of statements) out.push(await st.run())
        db.run('COMMIT')
        inTransaction = false
        save()
        return out
      } catch (err) {
        try {
          db.run('ROLLBACK')
        } catch {
          /* a failed transaction may already be unwound */
        }
        inTransaction = false
        throw err
      }
    },

    /** DDL and multi-statement migration files. */
    exec(sql) {
      db.run(sql)
      save()
    },

    /** Raw row access, for diagnostics and migration bookkeeping. */
    select(sql, args = []) {
      return query(sql, args)
    },

    save,
    close() {
      save()
      db.close()
    },
  }

  return d1
}
