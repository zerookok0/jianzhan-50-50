/**
 * RESET THE LOCAL DATABASE
 * ------------------------------------------------------------------
 * Deletes the sql.js database file so the next `npm run api:dev` rebuilds
 * it from the real migrations and reseeds the catalogue.
 *
 * Why this is needed: `scripts/test-purchase.mjs` places a REAL order, so
 * each run commits stock. That is deliberate — the test is only meaningful
 * if it exercises committed writes — but after enough runs the target
 * piece legitimately sells out. Resetting restores a known catalogue so
 * the suite can run again.
 *
 * The server must be stopped first: sql.js keeps the database in memory
 * and writes it back on close, which would otherwise recreate the file
 * from the state it loaded.
 *
 * Usage:
 *   npm run db:reset          # delete and let the next start reseed
 *   npm run db:reset -- --keep  # leave the file, just report
 */

import { existsSync, unlinkSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB_FILE = join(ROOT, '.local-state', 'jianzhan.sqlite')

const keep = process.argv.includes('--keep')

/**
 * Is anything still serving the API?
 *
 * Deleting the file while the host is running does not reset anything: the
 * database lives in memory, and closing the process writes that same state
 * straight back. The reset would appear to work and change nothing, which is
 * the worst possible outcome — so refuse instead, and say why.
 */
async function apiIsRunning() {
  const port = process.env.PORT ?? process.env.API_PORT ?? '8787'
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

if (await apiIsRunning()) {
  console.error('The API is still running, so the database is still in memory.')
  console.error('Stopping it first is required: it rewrites the file on shutdown,')
  console.error('which would restore the very catalogue this is meant to clear.')
  console.error('')
  console.error('  stop `npm run api:dev`, then run this again')
  process.exit(1)
}

if (!existsSync(DB_FILE)) {
  console.log(`No local database at ${DB_FILE} — nothing to reset.`)
  console.log('The next `npm run api:dev` will create and seed one.')
  process.exit(0)
}

const { size } = statSync(DB_FILE)
const kib = Math.round(size / 1024)

if (keep) {
  console.log(`Kept ${DB_FILE} (${kib} KiB).`)
  process.exit(0)
}

try {
  unlinkSync(DB_FILE)
  console.log(`Removed ${DB_FILE} (${kib} KiB).`)
  console.log('Start the API again to rebuild it from migrations and seed data:')
  console.log('  npm run api:dev')
} catch (err) {
  console.error(`Could not remove ${DB_FILE}: ${err.message}`)
  console.error('If the API is running, stop it first — it rewrites the file on shutdown.')
  process.exitCode = 1
}
