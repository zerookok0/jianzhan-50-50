/**
 * LOCAL API SERVER
 * ------------------------------------------------------------------
 * Runs the real Worker on Node so the storefront has something to talk to.
 *
 * WHY NOT `wrangler dev`
 * `workerd` — the native binary wrangler shells out to — cannot start in
 * this sandbox. Wrangler downloads it, then fails with "can't open input
 * file", because the binary is shell-wrapped and never reaches exec.
 *
 * WHAT THIS DOES INSTEAD
 * Imports `worker/index.ts` directly (Node 22 strips the types) and calls
 * its `fetch` handler once per request. The handler is byte-for-byte the
 * one that would deploy to Cloudflare: same router, same services, same
 * validation, same SQL. Only the host changes.
 *
 * The one substitution is `env.DB`, backed by sql.js (SQLite compiled to
 * WebAssembly) through the shim in local-d1.mjs — because `node:sqlite` is
 * a non-functional decoy in this environment. Migrations are the real files
 * from migrations/, applied in filename order.
 *
 * USAGE
 *   npm run api:dev
 */

import { createServer } from 'node:http'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './local-d1.mjs'
import { seed } from './seed-data.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 8787)
const DB_DIR = join(ROOT, '.local-state')
const DB_FILE = join(DB_DIR, 'jianzhan.sqlite')

/* ---------------- Environment ---------------- */

/**
 * Parse .dev.vars into a plain object. It is dotenv-shaped, but reading it
 * directly keeps this script free of a dependency for one small file.
 */
function readDevVars() {
  const path = join(ROOT, '.dev.vars')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const secrets = readDevVars()

/* ---------------- Database ---------------- */

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })

const DB = await openDatabase(DB_FILE)

/* Apply the real migration files, in order. */
const migrations = readdirSync(join(ROOT, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8'))

console.log(`[db] applying ${migrations.length} migration(s) to ${DB_FILE}`)
for (const sql of migrations) DB.exec(sql)

/* Seed once, so a restart does not duplicate the catalogue. */
const existing = await DB.prepare('SELECT COUNT(*) AS n FROM products').first()
if ((existing?.n ?? 0) === 0) {
  const counts = seed(DB)
  console.log(
    `[db] seeded ${counts.products} products, ${counts.categories} categories, ${counts.coupons} coupons`,
  )
} else {
  console.log(`[db] catalogue already populated (${existing.n} products) — not reseeding`)
}

/* ---------------- Worker ---------------- */

const worker = await import(join(ROOT, 'worker', 'index.ts'))

/**
 * The bindings the Worker expects. Everything the code touches is here;
 * `IMAGES` is declared because env.ts types it, but no route reads it, so a
 * stub is honest rather than convenient.
 */
const env = {
  DB,
  IMAGES: {
    async get() {
      return null
    },
    async put() {
      throw new Error('R2 is not available in the local host.')
    },
    async delete() {},
  },
  ENVIRONMENT: 'development',
  APP_ORIGIN: `http://localhost:${PORT}`,
  ALLOWED_ORIGINS: [
    `http://localhost:${PORT}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
  ].join(','),
  DEFAULT_CURRENCY: 'USD',
  ORDER_RESERVATION_MINUTES: '30',
  CART_TTL_DAYS: '30',
  ...secrets,
}

/* ---------------- HTTP bridge ---------------- */

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

    /* Collect the body. Only read when the method can carry one. */
    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      body = chunks.length ? Buffer.concat(chunks) : undefined
    }

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
      else if (value !== undefined) headers.set(key, value)
    }

    // The Worker reads CF-Connecting-IP for rate limiting. Locally every
    // request is one client, so a fixed loopback address is accurate.
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '127.0.0.1')

    const request = new Request(url, {
      method: req.method,
      headers,
      body,
    })

    const response = await worker.default.fetch(request, env, {
      waitUntil() {},
      passThroughOnException() {},
    })

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      // set-cookie must stay as separate headers, so append rather than set.
      if (key.toLowerCase() === 'set-cookie') res.appendHeader(key, value)
      else res.setHeader(key, value)
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    res.end(buffer)
  } catch (err) {
    console.error('[server]', err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error: { code: 'internal', message: err?.message ?? 'Local host error.' },
      }),
    )
  }
})

server.listen(PORT, () => {
  console.log(`\n  API  http://localhost:${PORT}/api/health`)
  console.log(`  Env  ${env.ENVIRONMENT}`)
  console.log(`  Pay  ${env.PAYMENT_MOCK_SECRET ? 'test gateway enabled' : 'NOT configured'}\n`)
})

/* Close the database cleanly so WAL files are checkpointed. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[db] closing')
    DB.close()
    server.close(() => process.exit(0))
  })
}
