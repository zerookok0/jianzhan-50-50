/**
 * FAKE D1 — an in-memory stand-in for the SQL the checkout and payment
 * path actually issues.
 *
 * WHY THIS EXISTS
 * ---------------
 * This environment cannot run `wrangler dev` (no native workerd) and
 * `node:sqlite` ships without a usable prototype here, so there is no real
 * SQL engine to point the handlers at. Testing a re-implementation of a
 * handler instead of the handler proves nothing.
 *
 * So this file drives the ACTUAL handlers in worker/ against a database
 * that understands only the statements they send.
 *
 * THE RULE THAT KEEPS THIS HONEST
 * -------------------------------
 * An unrecognised statement THROWS. It never quietly returns zero rows. A
 * fake that answers everything with "nothing found" makes tests pass while
 * hiding broken code, so every gap surfaces as a loud failure naming the
 * SQL it could not model.
 *
 * SQLITE SEMANTICS THAT MATTER
 * ----------------------------
 * In an UPDATE, every expression right of `SET` is evaluated against the
 * OLD row, not against values assigned earlier in the same statement.
 * `commitReservation` depends on exactly that:
 *
 *   SET on_hand = MAX(0, on_hand - q), reserved = MAX(0, reserved - q),
 *       sellable = MAX(0, on_hand - q) - MAX(0, reserved - q)
 *
 * Computing `sellable` from the already-decremented `on_hand` would make
 * the fake disagree with SQLite, and the test would then be measuring the
 * fake. Every branch below works from a snapshot of the old row.
 *
 * A WHERE clause that matches nothing reports `changes: 0`, exactly as
 * SQLite does, because `reserveStock` reads that number to decide whether
 * a line succeeded.
 */

export function makeFakeD1(seed = {}) {
  const state = {
    orders: [],
    order_items: [],
    payment_attempts: [],
    webhook_events: [],
    inventory: [],
    inventory_reservations: [],
    coupon_redemptions: [],
    audit_logs: [],
  }

  for (const [table, rows] of Object.entries(seed)) {
    if (!(table in state)) failUnknownTable(table)
    state[table].push(...rows.map((r) => ({ ...r })))
  }

  const log = []

  function prepare(sql) {
    const text = String(sql)
    const stmt = {
      __sql: text,
      __args: [],
      bind(...args) {
        stmt.__args = args
        return stmt
      },
      async first() {
        const res = exec(text, stmt.__args)
        return res.rows.length ? { ...res.rows[0] } : null
      },
      async all() {
        const res = exec(text, stmt.__args)
        return { results: res.rows.map((r) => ({ ...r })), meta: { changes: 0 } }
      },
      async run() {
        const res = exec(text, stmt.__args)
        return { meta: { changes: res.changes ?? 0 } }
      },
    }
    return stmt
  }

  const db = {
    prepare,
    // D1 runs a batch as one transaction, in statement order.
    async batch(statements) {
      const out = []
      for (const st of statements) out.push(await st.run())
      return out
    },
    get state() {
      return state
    },
    get log() {
      return log
    },
    /** Every normalised statement this database has seen. */
    get sqlSeen() {
      return log.map((l) => l.sql)
    },
  }

  function exec(rawSql, args) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim()
    log.push({ sql, args })

    if (sql.startsWith('INSERT INTO')) return insert(sql, args)
    if (sql.startsWith('UPDATE ')) return update(sql, args)
    if (sql.startsWith('SELECT ')) return select(sql, args)
    if (sql.startsWith('DELETE FROM ')) return remove(sql, args)

    return fail(rawSql)
  }

  /* ---------------- DELETE ---------------- */

  function remove(sql, args) {
    const table = sql.match(/^DELETE FROM (\w+)/)[1]
    if (!(table in state)) failUnknownTable(table)

    const before = state[table].length
    state[table] = state[table].filter((row) => !matchWhere(sql, row, args))
    return { rows: [], changes: before - state[table].length }
  }

  /* ---------------- INSERT ---------------- */

  function insert(sql, args) {
    const table = sql.match(/^INSERT INTO (\w+)/)[1]
    if (!(table in state)) failUnknownTable(table)

    const cols = columnsOf(sql)
    const row = {}

    // Literals in the VALUES list (e.g. 'active') consume no bind slot,
    // so map positional placeholders to args explicitly.
    const values = valuesOf(sql)
    let argIndex = 0
    values.forEach((token, i) => {
      if (isPlaceholder(token)) row[cols[i]] = args[argIndex++]
      else row[cols[i]] = literal(token)
    })

    applyInsertDefaults(table, row, sql)

    // ON CONFLICT(provider, payload_hash) DO UPDATE — the webhook log is
    // the only upsert in the codebase.
    if (/ON CONFLICT/i.test(sql)) {
      const conflictCols = sql
        .match(/ON CONFLICT\s*\(([^)]+)\)/i)[1]
        .split(',')
        .map((c) => c.trim())
      const existing = state[table].find((r) =>
        conflictCols.every((c) => r[c] === row[c]),
      )
      if (existing) {
        const setClause = sql.slice(sql.search(/DO UPDATE SET/i))
        for (const [col, expr] of setAssignments(setClause)) {
          existing[col] = resolveExpr(expr, row, [row])
        }
        return { rows: [], changes: 1 }
      }
    }

    state[table].push(row)
    return { rows: [], changes: 1 }
  }

  function applyInsertDefaults(table, row, sql) {
    if (table === 'orders') {
      // Status and fulfilment are literals in the INSERT statement; if the
      // statement ever stops sending them this keeps the row coherent.
      if (!('status' in row)) row.status = 'pending'
      if (!('fulfilment_status' in row)) row.fulfilment_status = 'unfulfilled'
      if (!('stock_committed' in row)) row.stock_committed = 0
      row.id ??= crypto.randomUUID()
      void sql
    }
  }

  /* ---------------- UPDATE ---------------- */

  const updateHandlers = {}
  const selectHandlers = {}

  function update(sql, args) {
    for (const handler of Object.values(updateHandlers)) {
      const res = handler(sql, args)
      if (res) return res
    }
    return fail(sql)
  }

  /* ---------------- SELECT ---------------- */

  function select(sql, args) {
    for (const handler of Object.values(selectHandlers)) {
      const res = handler(sql, args)
      if (res) return res
    }
    return fail(sql)
  }

  /* ---------------- Internals exposed for the branch modules ---------------- */

  const api = {
    /**
     * The D1 face. Handlers receive this object as `env.DB`, and the test
     * reads `api.state` off the same object, so there is exactly one
     * database and no adapter between them.
     */
    prepare,
    async batch(statements) {
      // D1 runs a batch as one transaction, in statement order.
      const out = []
      for (const st of statements) out.push(await st.run())
      return out
    },
    state,
    exec,
    fail,
    insert,
    update,
    select,
    updateHandlers,
    selectHandlers,
    columnsOf,
    valuesOf,
    setAssignments,
    resolveExpr,
    isPlaceholder,
    literal,
    applyUpdate,
    matchWhere,
    rowsOf,
    get sqlSeen() {
      return log.map((l) => l.sql)
    },
  }

  /**
   * Apply a SET list to rows selected by a predicate. Expressions are
   * evaluated against a snapshot of the OLD row, matching SQLite.
   */
  function applyUpdate(table, predicate, setClause, extraRows = []) {
    let changes = 0
    for (const row of state[table]) {
      if (!predicate(row)) continue
      const old = { ...row }
      for (const [col, expr] of setAssignments(setClause)) {
        row[col] = resolveExpr(expr, old, extraRows)
      }
      changes++
    }
    return { rows: [], changes }
  }

  function rowsOf(table) {
    return state[table]
  }

  function failUnknownTable(table) {
    throw new Error(
      `fake-d1: unknown table "${table}". Add it to the state object in ` +
        `tests/helpers/fake-d1.mjs.`,
    )
  }

  return api
}

/* ------------------------------------------------------------------ */
/* SQL text helpers                                                    */
/* ------------------------------------------------------------------ */

function fail(sql) {
  throw new Error(
    `fake-d1: unmodelled SQL\n\n  ${String(sql).replace(/\s+/g, ' ').trim()}\n\n` +
      'Add a branch for it in tests/helpers/fake-d1.mjs, or the handler is ' +
      'sending SQL this test does not cover.',
  )
}

/** Column names from `INSERT INTO t (a, b, c)` or `... SET a = ?, b = ?`. */
function columnsOf(sql) {
  const open = sql.indexOf('(')
  const close = sql.indexOf(')', open)
  const inner = sql.slice(open + 1, close)
  return inner.split(',').map((c) => c.trim().replace(/"/g, ''))
}

/** The token list inside `VALUES (...)`. */
function valuesOf(sql) {
  const idx = sql.search(/VALUES\s*\(/i)
  const open = sql.indexOf('(', idx)
  let depth = 0
  let end = open
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    if (sql[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  return splitTopLevel(sql.slice(open + 1, end)).map((v) => v.trim())
}

function splitTopLevel(input) {
  const out = []
  let depth = 0
  let current = ''
  let inString = false
  for (const ch of input) {
    if (ch === "'") inString = !inString
    if (!inString) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }
  if (current.trim()) out.push(current)
  return out
}

function isPlaceholder(token) {
  return /^\?\d*$/.test(token.trim())
}

function literal(token) {
  const t = token.trim()
  if (t === 'NULL') return null
  if (/^-?\d+$/.test(t)) return Number(t)
  if (/^'.*'$/.test(t)) return t.slice(1, -1)
  return t
}

/** `SET a = ?, b = MAX(0, b - ?)` → [['a', '?'], ['b', 'MAX(0, b - ?)']] */
function setAssignments(setClause) {
  const idx = setClause.search(/SET\s/i)
  const body = setClause.slice(idx + 3)
  // Stop at a trailing WHERE / RETURNING.
  const tail = body.search(/\sWHERE\s|\sRETURNING\s/i)
  const exprText = tail === -1 ? body : body.slice(0, tail)

  const parts = splitTopLevel(exprText).map((p) => p.trim()).filter(Boolean)
  return parts.map((part) => {
    const eq = part.indexOf('=')
    const col = part.slice(0, eq).trim()
    const expr = part.slice(eq + 1).trim()
    return [col, expr]
  })
}

/**
 * Evaluate one SET expression against the old row.
 * Supports the shapes the codebase actually uses:
 *   ?N            bound value
 *   excluded.col  new value from the upsert payload
 *   MAX(0, x - ?N)
 *   x - ?N
 *   on_hand - (reserved + ?N)
 *   ?N - ?N
 *   plain column reference
 */
function resolveExpr(expr, oldRow, extraRows = []) {
  let text = expr.trim()

  // `excluded.col` refers to the incoming row (upsert payload).
  text = text.replace(/excluded\.(\w+)/g, (_, col) => {
    const value = extraRows[0]?.[col]
    if (value === null || value === undefined) return 'NULL'
    return typeof value === 'number'
      ? String(value)
      : `'${String(value).replace(/'/g, "''")}'`
  })

  // Substitute `?N` bind slots before evaluating. Every SET expression the
  // handlers send is parameterised:
  //   reserved = reserved + ?2, sellable = MAX(0, reserved - ?2), ...
  text = text.replace(/\?(\d+)/g, (_, n) => {
    const value = extraRows[Number(n) - 1]
    if (value === null || value === undefined) return 'NULL'
    return typeof value === 'number'
      ? String(value)
      : `'${String(value).replace(/'/g, "''")}'`
  })

  // A bare literal assigns directly. Running NULL through the numeric
  // evaluator would turn it into 0, which is not what SQLite does.
  const literalText = text.trim()
  if (literalText === 'NULL') return null
  if (/^'[\s\S]*'$/.test(literalText)) {
    return literalText.slice(1, -1).replace(/''/g, "'")
  }

  return evaluateNumeric(literalText, oldRow)
}

function splitSubtract(text) {
  return splitOperator(text, '-')
}

/**
 * Resolve a numeric expression. Placeholders are NOT resolvable here
 * because bind values live with the statement; callers substitute them via
 * `withBindings`. This function handles literals, column refs and +.
 */
function evaluateNumeric(text, row) {
  const t = stripOuterParens(text.trim())

  if (/^-?\d+$/.test(t)) return Number(t)
  if (t === 'NULL') return 0
  if (/^[A-Za-z_]\w*$/.test(t)) {
    const v = row[t]
    return typeof v === 'number' ? v : 0
  }

  // Addition binds loosest, so split there first.
  const addition = splitOperator(t, '+')
  if (addition) {
    const [lhs, rhs] = addition
    return evaluateNumeric(lhs, row) + evaluateNumeric(rhs, row)
  }

  const subtraction = splitOperator(t, '-')
  if (subtraction) {
    const [lhs, rhs] = subtraction
    return evaluateNumeric(lhs, row) - evaluateNumeric(rhs, row)
  }

  // A scoped call such as MAX(0, on_hand - ?2).
  const call = parseCall(t)
  if (call && call.end === t.length - 1) {
    const args = splitTopLevel(call.inner).map((a) => evaluateNumeric(a, row))
    if (call.name === 'MAX') return Math.max(...args)
    if (call.name === 'MIN') return Math.min(...args)
    if (call.name === 'ABS') return Math.abs(args[0])
    throw new Error(`fake-d1: unsupported function ${call.name}() in "${text}"`)
  }

  throw new Error(`fake-d1: cannot evaluate expression "${text}"`)
}

/**
 * Split on a binary operator at the outermost depth, scanning right to
 * left so `a - b - c` groups as `(a - b) - c`.
 */
function splitOperator(text, operator) {
  let depth = 0
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ')') depth++
    if (ch === '(') depth--
    if (depth !== 0 || ch !== operator) continue

    const lhs = text.slice(0, i).trim()
    const rhs = text.slice(i + 1).trim()
    if (!lhs || !rhs) continue
    // A trailing operator on the left means this is a sign, e.g. `-5`.
    if (/[+\-*/]$/.test(lhs)) continue
    return [lhs, rhs]
  }
  return null
}

/**
 * Parse `NAME(arg, arg, ...)` and report where its closing paren sits.
 * This is what tells `MAX(0, a - b)` (one call) apart from
 * `MAX(0, a - b) - MAX(0, c - d)` (two calls subtracted), which a naive
 * startsWith/endsWith test cannot distinguish.
 */
function parseCall(text) {
  const m = text.match(/^([A-Za-z_]\w*)\s*\(/)
  if (!m) return null

  const open = text.indexOf('(', m[1].length)
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return null
  return { name: m[1].toUpperCase(), inner: text.slice(open + 1, end), end }
}

/**
 * Substitute `?N` placeholders in an expression with the statement's bound
 * arguments, then evaluate. Returns a number.
 */
function evaluateWithArgs(expr, row, args) {
  const substituted = expr.replace(/\?(\d+)?/g, (_, n) => {
    const index = n ? Number(n) - 1 : 0
    const v = args[index]
    return String(typeof v === 'number' ? v : Number(v ?? 0))
  })
  return evaluateNumeric(substituted, row)
}

/**
 * Minimal WHERE evaluator. Handles the predicates this codebase sends:
 *   col = ?N | col = 'lit' | col != ?N | col < ?N | col > ?N
 *   IFNULL(col,'') = ?N | (cond OR cond OR cond) | (A - B) >= ?N
 * Anything else throws, so a new shape cannot silently match nothing.
 */
function matchWhere(sql, row, args) {
  const idx = sql.search(/\sWHERE\s/i)
  if (idx === -1) return true
  // `idx` points at the space BEFORE the keyword, so skipping
  // ' WHERE '.length lands exactly on the first character of the clause.
  let text = sql.slice(idx + ' WHERE '.length)

  // Trim trailing ORDER BY / LIMIT / RETURNING.
  const stop = text.search(/\s(ORDER BY|LIMIT|RETURNING)\s/i)
  if (stop !== -1) text = text.slice(0, stop)

  return evaluateCondition(text.trim(), row, args)
}

function evaluateCondition(text, row, args) {
  const t = stripOuterParens(text.trim())

  // OR groups.
  const orParts = splitLogical(t, 'OR')
  if (orParts.length > 1) return orParts.some((p) => evaluateCondition(p, row, args))

  const andParts = splitLogical(t, 'AND')
  if (andParts.length > 1) return andParts.every((p) => evaluateCondition(p, row, args))

  // IS NULL / IS NOT NULL.
  const isNull = t.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i)
  if (isNull) {
    const v = valueOfOperand(isNull[1].trim(), row, args)
    return isNull[2] ? v !== null && v !== undefined : v === null || v === undefined
  }

  // col IN (?1, ?2, ...).
  const inList = t.match(/^(.+?)\s+IN\s*\((.+)\)$/i)
  if (inList) {
    const lhs = valueOfOperand(inList[1].trim(), row, args)
    const candidates = splitTopLevel(inList[2]).map((c) => valueOfOperand(c.trim(), row, args))
    return candidates.includes(lhs)
  }

  const comparison = t.match(/^(.+?)\s*(>=|<=|!=|<>|=|>|<)\s*(.+)$/)
  if (!comparison) {
    throw new Error(`fake-d1: cannot evaluate WHERE fragment "${text}"`)
  }

  const [, lhsRaw, op, rhsRaw] = comparison
  const lhs = valueOfOperand(lhsRaw.trim(), row, args)
  const rhs = valueOfOperand(rhsRaw.trim(), row, args)
  return compare(lhs, op, rhs)
}

function compare(lhs, op, rhs) {
  switch (op) {
    case '=':
      return lhs === rhs
    case '!=':
    case '<>':
      return lhs !== rhs
    case '>':
      return lhs > rhs
    case '>=':
      return lhs >= rhs
    case '<':
      return lhs < rhs
    case '<=':
      return lhs <= rhs
    default:
      throw new Error(`fake-d1: unsupported operator "${op}"`)
  }
}

function valueOfOperand(operand, row, args) {
  let t = stripOuterParens(operand.trim())

  const ifnull = t.match(/^IFNULL\(\s*(\w+)\s*,\s*(.+)\)$/i)
  if (ifnull) {
    const v = row[ifnull[1]]
    return v === null || v === undefined ? valueOfOperand(ifnull[2], row, args) : v
  }

  // A `?N` / `?` bind slot.
  if (/^\?(\d+)?$/.test(t)) {
    const n = t.match(/^\?(\d+)?$/)
    const index = n[1] ? Number(n[1]) - 1 : 0
    return args[index]
  }

  if (/^'.*'$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+$/.test(t)) return Number(t)
  if (t === 'NULL') return null

  // A bare column name reads the row directly. This case MUST come before
  // the arithmetic branch: `public_reference` is a string, and pushing it
  // through the numeric evaluator would turn it into 0 and match nothing.
  if (/^[A-Za-z_]\w*$/.test(t)) {
    return row[t] ?? null
  }

  // Anything else with an operator is an arithmetic expression over the row.
  if (/[+\-]/.test(t)) {
    return evaluateWithArgs(t, row, args)
  }

  throw new Error(`fake-d1: cannot resolve operand "${operand}"`)
}

function stripOuterParens(text) {
  let t = text.trim()
  while (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0
    let wraps = true
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++
      if (t[i] === ')') depth--
      if (depth === 0 && i !== t.length - 1) {
        wraps = false
        break
      }
    }
    if (!wraps) break
    t = t.slice(1, -1).trim()
  }
  return t
}

function splitLogical(text, keyword) {
  const out = []
  let depth = 0
  let inString = false
  let current = ''
  const upper = text.toUpperCase()

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") inString = !inString
    if (!inString) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (
        depth === 0 &&
        upper.startsWith(keyword, i) &&
        (i === 0 || /[\s)]/.test(text[i - 1])) &&
        (i + keyword.length === text.length || /[\s(]/.test(text[i + keyword.length]))
      ) {
        out.push(current.trim())
        current = ''
        i += keyword.length - 1
        continue
      }
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out.length ? out : [text]
}
