/**
 * PROXY CHECK
 * ------------------------------------------------------------------
 * Verifies that the Vite dev server on :5174 forwards /api/* to the API
 * host, exactly as the browser will. This is the one link in local
 * development that neither side can prove on its own: the API can be
 * healthy on its port and the storefront still be unable to reach it,
 * because the proxy is configured with a different port.
 *
 * Usage: node scripts/check-proxy.mjs [vitePort] [apiPort]
 */

const VITE_PORT = process.argv[2] ?? '5174'
const API_PORT = process.argv[3] ?? '8788'

const VITE = `http://localhost:${VITE_PORT}`
const API = `http://localhost:${API_PORT}`

let failed = 0

async function probe(label, url, expect) {
  try {
    const res = await fetch(url)
    const text = await res.text()
    const ok = res.status === expect
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — HTTP ${res.status}`)
    if (!ok) {
      failed++
      console.log(`      expected ${expect}`)
      console.log(`      body: ${text.slice(0, 200)}`)
    }
    return { ok, text, status: res.status }
  } catch (err) {
    console.log(`FAIL  ${label} — ${err.message}`)
    failed++
    return { ok: false, text: '', status: 0 }
  }
}

console.log(`\nVite  ${VITE}`)
console.log(`API   ${API}\n`)

/* 1. The API is alive on its own. */
const direct = await probe('API health (direct)', `${API}/api/health`, 200)
if (direct.ok) console.log(`      ${direct.text.trim()}`)

/* 2. The same endpoint through the Vite proxy — this is the browser's path. */
const viaProxy = await probe('API health (through Vite)', `${VITE}/api/health`, 200)
if (viaProxy.ok && direct.ok) {
  const same = viaProxy.text.trim() === direct.text.trim()
  console.log(`${same ? 'PASS' : 'FAIL'}  proxied response matches the direct one`)
  if (!same) failed++
}

/* 3. A real catalogue read, so routing and query strings are exercised. */
const catalogue = await probe(
  'Catalogue through Vite',
  `${VITE}/api/v1/products?perPage=2`,
  200,
)
if (catalogue.status === 200) {
  try {
    const body = JSON.parse(catalogue.text)
    const n = body.products?.length ?? 0
    const ok = n > 0
    console.log(`${ok ? 'PASS' : 'FAIL'}  catalogue returned ${n} of ${body.total} product(s)`)
    if (!ok) failed++
    const first = body.products?.[0]
    if (first) {
      console.log(
        `      ${first.slug} — ${first.price} ${first.currency} (minorUnit ${first.minorUnit})`,
      )
    }
  } catch {
    console.log('FAIL  catalogue response was not JSON')
    failed++
  }
}

/* 4. The app shell itself. */
await probe('App shell through Vite', `${VITE}/`, 200)

console.log(`\n${'='.repeat(46)}`)
console.log(
  failed === 0
    ? 'Proxy is wired correctly — the browser path reaches the API.'
    : `${failed} check(s) failed.`,
)
process.exitCode = failed === 0 ? 0 : 1
