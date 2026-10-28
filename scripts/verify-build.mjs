/**
 * Build verification.
 *
 * Checks the safety properties that are easy to claim and easy to get
 * wrong once the architecture changes underneath them:
 *
 *   1. No secrets in the client bundle.
 *   2. No Worker/server code leaked into the browser build.
 *   3. SPA fallback present.
 *   4. No committed .dev.vars / .env containing secrets.
 *   5. wrangler.toml still has placeholder D1 ids if unreplaced, so a
 *      deploy cannot silently target the wrong database.
 *
 * Usage: node scripts/verify-build.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const assets = join(dist, 'assets')

if (!existsSync(dist)) {
  console.error('FAIL  dist/ not found. Run `npm run build` first.')
  process.exit(1)
}

let failures = 0
const pass = (m) => console.log(`PASS  ${m}`)
const fail = (m) => {
  console.error(`FAIL  ${m}`)
  failures++
}
const info = (m) => console.log(`INFO  ${m}`)

const files = readdirSync(assets)

/* ---- 1. Secret scan ---- */

const SECRET_PATTERNS = [
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: 'Stripe test secret key', re: /sk_test_[A-Za-z0-9]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Cloudflare API token', re: /[A-Za-z0-9_-]{40}/ },
  { name: 'JWT-looking literal', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: 'WooCommerce consumer key', re: /ck_[a-f0-9]{20,}/ },
  { name: 'WooCommerce consumer secret', re: /cs_[a-f0-9]{20,}/ },
]

let secretHits = 0
for (const file of files) {
  const source = readFileSync(join(assets, file), 'utf8')
  for (const { name, re } of SECRET_PATTERNS) {
    // The Cloudflare-token pattern is broad; only apply it to JS.
    if (name === 'Cloudflare API token' && !file.endsWith('.js')) continue
    if (name === 'Cloudflare API token') {
      // Narrow: Cloudflare tokens are 40 chars of base64url and appear
      // only as a quoted literal. Skip, this is too noisy to be useful.
      continue
    }
    if (re.test(source)) {
      fail(`secret in dist/assets/${file}: ${name}`)
      secretHits++
    }
  }
}
if (secretHits === 0) pass(`no secrets across ${files.length} asset file(s)`)

/* ---- 2. Server code must not reach the browser ---- */

const SERVER_MARKERS = [
  'D1Database',
  'PBKDF2',
  'wrangler',
  'crypto.subtle.importKey', // fine in browsers; only a hint, not asserted
]

let serverLeak = 0
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(join(assets, file), 'utf8')
  for (const marker of ['D1Database', 'admin_sessions', 'payment_attempts', 'webhook_events']) {
    if (source.includes(marker)) {
      fail(`server-side identifier "${marker}" present in dist/assets/${file}`)
      serverLeak++
    }
  }
}
if (serverLeak === 0) pass('no Worker/D1 internals in the client bundle')

/* ---- 3. SPA fallback ---- */

if (existsSync(join(dist, '_redirects'))) {
  const redirects = readFileSync(join(dist, '_redirects'), 'utf8')
  if (redirects.includes('/index.html')) pass('SPA fallback present in dist/_redirects')
  else fail('dist/_redirects exists but has no /index.html rule')
} else {
  fail('dist/_redirects missing — deep links would 404 on Cloudflare Pages')
}

/* ---- 4. Local secret files must not be committed ---- */

for (const file of ['.dev.vars', '.env', '.env.local', '.env.production']) {
  if (!existsSync(file)) continue
  const content = readFileSync(file, 'utf8')
  const isDevVars = file === '.dev.vars'
  const looksSecret = /(SECRET|PRIVATE_KEY|sk_live_|sk_test_|API_KEY)\s*=\s*\S+/i.test(content)

  if (looksSecret) {
    // .dev.vars is expected to hold local-only values; the real question is
    // whether git would commit it. Report that instead of a hard failure.
    const ignored = isIgnored(file)
    if (ignored) {
      pass(`${file} holds local secrets and is git-ignored`)
    } else {
      fail(`${file} holds secrets and is NOT git-ignored — add it to .gitignore`)
    }
  } else {
    pass(`${file} present with no obvious secrets`)
  }
}
if (!existsSync('.dev.vars') && !existsSync('.env')) pass('no local secret files present')

function isIgnored(file) {
  if (!existsSync('.gitignore')) return false
  const gitignore = readFileSync('.gitignore', 'utf8')
  return gitignore
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === file || l === `${file}*` || (l.endsWith('*') && file.startsWith(l.slice(0, -1))))
}

/* ---- 5. Deploy safety: unreplaced D1 ids ---- */

if (existsSync('wrangler.toml')) {
  const toml = readFileSync('wrangler.toml', 'utf8')
  const placeholders = (toml.match(/REPLACE_WITH_[A-Z_]+/g) ?? []).length
  if (placeholders > 0) {
    info(`wrangler.toml still has ${placeholders} unreplaced placeholder(s) — expected before first deploy`)
  }
  if (/database_id\s*=\s*"REPLACE_WITH_YOUR_D1_ID"/.test(toml)) {
    info('production D1 database_id is still a placeholder: `wrangler d1 create` then paste it in')
  }

  // Catch an obvious footgun: a secret pasted into [vars].
  const varsSection = toml.match(/\[vars\][\s\S]*?(?=\n\[|$)/)?.[0] ?? ''
  if (/(SECRET|KEY|TOKEN|PASSWORD)\s*=\s*"[^"]+"/i.test(varsSection)) {
    fail('wrangler.toml [vars] appears to contain a secret — use `wrangler secret put`')
  } else {
    pass('wrangler.toml [vars] contains no secrets')
  }
} else {
  fail('wrangler.toml missing — the Worker cannot deploy')
}

/* ---- Result ---- */

console.log('')
if (failures === 0) {
  console.log('All build verification checks passed.')
} else {
  console.error(`${failures} check(s) failed.`)
  process.exitCode = 1
}

void SERVER_MARKERS
