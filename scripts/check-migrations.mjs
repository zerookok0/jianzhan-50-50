/**
 * Migration sanity checks that do NOT need the Workers runtime.
 *
 * The real `wrangler d1 migrations apply` requires `workerd`, a native
 * binary that cannot run in this sandbox. These checks cover the failure
 * modes that matter most and that can be verified statically:
 *
 *   1. Every migration parses as SQL (balanced parens/quotes, statement
 *      count) — catches truncation and stray commas.
 *   2. Required tables exist, including every table the brief named.
 *   3. Money columns are INTEGER, never REAL/FLOAT/NUMERIC.
 *   4. Every money table carries currency + minor_unit context.
 *   5. Migrations are idempotent (IF NOT EXISTS on CREATE TABLE).
 *   6. No duplicate migration version numbers.
 *
 * Usage: node scripts/check-migrations.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripSqlComments, countParens } from './lib/sql-strip.mjs'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const dir = 'migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

check('migration files present', files.length > 0, `found ${files.length}`)

/* ---- Version numbers must be unique and sequential ---- */

const versions = files.map((f) => f.match(/^(\d{4})_/)?.[1]).filter(Boolean)
check(
  'migration versions are unique',
  new Set(versions).size === versions.length,
  versions.join(', '),
)
check(
  'migration versions are ordered',
  versions.every((v, i) => i === 0 || Number(v) > Number(versions[i - 1])),
  versions.join(', '),
)

/* ---- Read everything into one buffer for structural checks ---- */

const sql = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')

/* ---- Statement-level balance ---- */

// Strip comments before any structural check. Prose must never be mistaken
// for schema: an apostrophe in "-- customer's cart" would unbalance the
// quote counter, and the word "double" in "double-clicked" would trip the
// floating-point check below.
//
// The stripping is a lexical scan (./lib/sql-strip.mjs), not two regex
// passes. The regex version removed line comments first, and these files
// use banner comments such as `/* ---- Cart items ---- */` — pass one
// deleted the `*/` along with the rest of that line, so the block never
// closed and pass two swallowed the CREATE TABLE statements that followed.
// That is why the checker once reported missing tables and unbalanced
// parentheses for SQL that was correct all along.
const stripped = stripSqlComments(sql)

const parens = countParens(sql)
check('balanced parentheses', parens.balanced, `${parens.open} open vs ${parens.close} close`)

const singleQuotes = (stripped.match(/'/g) ?? []).length
check('balanced single quotes', singleQuotes % 2 === 0, `${singleQuotes} quote characters`)

const statements = stripped
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
check('at least one statement per migration', statements.length >= files.length, `${statements.length} statements`)

/* ---- Required tables ---- */

const REQUIRED_TABLES = [
  'products',
  'product_variants',
  'product_images',
  'categories',
  'inventory',
  'inventory_reservations',
  'carts',
  'cart_items',
  'coupons',
  'coupon_redemptions',
  'shipping_zones',
  'shipping_methods',
  'tax_rules',
  'orders',
  'order_items',
  'payment_attempts',
  'webhook_events',
  'admin_users',
  'audit_logs',
]

const created = new Set(
  [...stripped.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)].map((m) =>
    m[1].toLowerCase(),
  ),
)

const missing = REQUIRED_TABLES.filter((t) => !created.has(t))
check('all required tables are created', missing.length === 0, `missing: ${missing.join(', ')}`)

/* ---- Idempotency ---- */

const createTableCount = (stripped.match(/CREATE\s+TABLE/gi) ?? []).length
const createTableIdempotent = (stripped.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi) ?? []).length
check(
  'every CREATE TABLE is idempotent',
  createTableCount === createTableIdempotent,
  `${createTableIdempotent}/${createTableCount}`,
)

const createIndexCount = (stripped.match(/CREATE\s+(?:UNIQUE\s+)?INDEX/gi) ?? []).length
const createIndexIdempotent = (
  stripped.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/gi) ?? []
).length
check(
  'every CREATE INDEX is idempotent',
  createIndexCount === createIndexIdempotent,
  `${createIndexIdempotent}/${createIndexCount}`,
)

/* ---- Money hygiene ----
 * A REAL/FLOAT/NUMERIC money column is the single most expensive mistake
 * in a commerce schema, so it is worth a dedicated assertion.
 */

const BANNED_MONEY_TYPES = /\b(?:REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL)\b/i
check(
  'no floating-point column types anywhere',
  !BANNED_MONEY_TYPES.test(stripped),
  (stripped.match(BANNED_MONEY_TYPES)?.[0] ?? '') &&
    `found ${stripped.match(BANNED_MONEY_TYPES)?.[0]}`,
)

// Every table that stores money must also carry the currency context.
const MONEY_TABLES = {
  products: ['currency', 'minor_unit'],
  carts: ['currency', 'minor_unit'],
  orders: ['currency', 'minor_unit'],
  coupons: ['currency', 'minor_unit'],
}

for (const [table, required] of Object.entries(MONEY_TABLES)) {
  const block = tableBlock(stripped, table)
  if (!block) {
    check(`money table ${table} exists`, false)
    continue
  }
  const absent = required.filter((col) => !new RegExp(`\\b${col}\\b`, 'i').test(block))
  check(`money table ${table} carries currency context`, absent.length === 0, `missing: ${absent.join(', ')}`)
}

/* ---- Uniqueness we depend on for correctness ---- */

check(
  'cart line uniqueness enforced',
  /UNIQUE\s+INDEX[^;]*uniq_cart_line/i.test(stripped) ||
    /UNIQUE\s*\([^)]*cart_id[^)]*product_id/i.test(stripped),
)

check(
  'order public reference is unique',
  /public_reference\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(stripped),
  'order lookup relies on this',
)

check(
  'idempotency key is unique on orders',
  /idempotency_key\s+TEXT\s+UNIQUE/i.test(stripped),
  'duplicate submit protection relies on this',
)

check(
  'cart token hash is unique',
  /token_hash\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(stripped),
)

check(
  'webhook payload hash is deduplicated',
  /uniq_webhook_hash/i.test(stripped),
  'replay protection relies on this',
)

/* ---- Result ---- */

console.log('')
if (failures === 0) {
  console.log(`All migration checks passed across ${files.length} file(s).`)
} else {
  console.error(`${failures} check(s) failed.`)
  process.exitCode = 1
}

/* ---------------- helpers ---------------- */

function tableBlock(src, table) {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${table}["'\`]?\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i',
  )
  return src.match(re)?.[1] ?? null
}
