/**
 * END-TO-END PURCHASE TEST
 * ------------------------------------------------------------------
 * Drives the real API the way a browser would, and asserts the money and
 * stock at every step. Nothing here re-implements the handlers: it makes
 * HTTP requests to the running host in scripts/serve-api.mjs.
 *
 * The loop:
 *   catalogue → add to cart → price for a destination → place order
 *   → test gateway emits a signed webhook → order becomes paid
 *   → stock is committed (not just reserved)
 *
 * Usage: node scripts/test-purchase.mjs
 *
 *   API_BASE=http://localhost:8788 node scripts/test-purchase.mjs
 *
 * The default base is :8787, which is what `npm run api:dev` listens on.
 */

const BASE = process.env.API_BASE ?? 'http://localhost:8787'

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}`)
    console.log(`      actual   ${JSON.stringify(actual)}`)
    failed++
  } else {
    passed++
  }
}

function checkTruthy(label, value) {
  const ok = Boolean(value)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(value)}`}`)
  if (ok) passed++
  else failed++
}

/**
 * Stop the run when a prerequisite fails.
 *
 * Every assertion after the catalogue depends on the catalogue. Letting the
 * script continue turned the real problem into "Cannot read properties of
 * undefined (reading 'reference')" — a stack trace about this file, which is
 * the one place the bug was not. The server's own error message is the
 * diagnosis, so print that and exit.
 */
function abort(label, detail) {
  console.error(`\nFAIL  ${label}`)
  if (detail) console.error(`      ${detail}`)
  console.error(`\nAborted — later checks would only repeat this cause.`)
  console.error(`Base: ${BASE}`)
  console.error(`      Is the API this test targeted the one actually running?`)
  console.error(`      Start it with:  npm run api:dev\n`)
  process.exit(1)
}

/** Pull a human message out of the API's error envelope, if there is one. */
function serverMessage(body) {
  const message = body?.error?.message
  const code = body?.error?.code
  if (!message) return null
  return code ? `${code}: ${message}` : message
}

/**
 * The server mints the cart token on the first request and returns it in
 * `X-Cart-Token`. Inventing one here would silently create a NEW cart on
 * every call, so the token is captured from the response and reused.
 *
 * The capture lives inside this single helper: an earlier draft declared
 * `api` twice, and the second declaration silently shadowed the first —
 * so the token was never stored and every request got a fresh cart.
 *
 * STATE IS NOT ASSUMED. This test buys real stock, so every run leaves the
 * database one bowl lighter. Hard-coding "subtotal is 42000" or "stock
 * fell from 3 to 2" meant the suite passed exactly once and then lied.
 * Figures are now read from the catalogue at the start of the run and
 * asserted against what the order actually did.
 *
 * Reset the local database between runs with:  npm run db:reset
 */
let cartToken = null

async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, init)
  const issued = res.headers.get('x-cart-token')
  if (issued) cartToken = issued
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, headers: res.headers }
}

const auth = {
  get 'X-Cart-Token'() {
    return cartToken
  },
}

console.log('\n=== 1. Catalogue ===')

const list = await api('/products?perPage=20')
check('catalogue responds 200', list.status, 200)
if (list.status !== 200 || !Array.isArray(list.body?.products)) {
  abort('catalogue unreachable', serverMessage(list.body) ?? JSON.stringify(list.body))
}
check('nine products seeded', list.body.total, 9)
checkTruthy('prices are integer minor units', Number.isInteger(list.body.products[0].price))
check('price includes currency', list.body.products[0].currency, 'USD')
check('price includes minorUnit', list.body.products[0].minorUnit, 2)

const soldOut = list.body.products.find((p) => p.slug === 'deep-iridescence-bowl')
check('sold-out piece reports inStock false', soldOut.inStock, false)

const irid = list.body.products.find((p) => p.slug === 'iridescent-blue-bowl')
const large = irid.variants.find((v) => v.optionValue.startsWith('Large'))
const small = irid.variants.find((v) => v.optionValue.startsWith('Small'))
check('Large variant is out of stock', large.inStock, false)
check('Large variant available is 0', large.available, 0)
check('Small variant is in stock', small.inStock, true)
check('Small variant available is 1', small.available, 1)

/**
 * Baseline captured BEFORE anything is bought.
 *
 * `midnight-oil-spot-bowl` is the piece this run purchases, so its
 * availability and price are recorded now and compared against themselves
 * later. The expected stock after a successful order is always
 * `stockBefore - 1`, whatever the database happened to hold at the start.
 */
const TARGET_SLUG = 'midnight-oil-spot-bowl'
const TARGET_ID = 'jz-01'

const beforeTarget = await api(`/products/${TARGET_SLUG}`)
if (beforeTarget.status !== 200 || !beforeTarget.body?.product) {
  abort(
    `cannot read the target piece (${TARGET_SLUG})`,
    serverMessage(beforeTarget.body) ?? JSON.stringify(beforeTarget.body),
  )
}
const stockBefore = beforeTarget.body.product.available
const unitPrice = beforeTarget.body.product.price

checkTruthy('target piece has stock to buy', stockBefore !== null && stockBefore > 0)
checkTruthy('target price is a positive integer', Number.isInteger(unitPrice) && unitPrice > 0)

// Repeated runs genuinely consume stock, so an empty target is an
// environment problem, not a storefront one. Say which — and how to fix it.
if (!(stockBefore > 0)) {
  abort(
    'the target piece has no stock left',
    'Earlier runs of this test bought it. Stop the API, then reset the catalogue:\n' +
      '      npm run db:reset',
  )
}

console.log('\n=== 2. Cart ===')

const added = await api('/cart/items', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: TARGET_ID, quantity: 1 }),
})
check('add to cart returns 200', added.status, 200)
check('one line in cart', added.body.cart.items.length, 1)
check('subtotal equals the catalogue price', added.body.cart.totals.subtotal, unitPrice)
checkTruthy('cart token issued in header', added.headers.get('x-cart-token'))

// Same token must resume the same cart.
const resumed = await api('/cart', { headers: auth })
check('same token resumes the cart', resumed.body.cart.items.length, 1)

// Adding more than exist must be refused.
const over = await api('/cart/items', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 'jz-02', quantity: 99 }),
})
check('over-ordering is refused', over.status, 409)
check('refusal names the shortfall', over.body.error.code, 'out_of_stock')

// Sold out piece cannot be added.
const dead = await api('/cart/items', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 'jz-08', quantity: 1 }),
})
check('sold-out piece cannot be added', dead.status, 409)

// Sold-out VARIANT cannot be added — this is the bug that was fixed.
const badVariant = await api('/cart/items', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 'jz-03', variantId: large.id, quantity: 1 }),
})
check('sold-out Large variant cannot be added', badVariant.status, 409)

console.log('\n=== 3. Coupon ===')

const coupon = await api('/cart/coupons', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'WELCOME10' }),
})
check('coupon applies', coupon.status, 200)
check(
  'discount is 10% of the subtotal',
  coupon.body.cart.totals.discountTotal,
  Math.round(unitPrice * 0.1),
)

console.log('\n=== 4. Quote for a destination ===')

const quote = await api('/checkout/quote', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ country: 'US', postcode: '10001' }),
})
check('quote returns 200', quote.status, 200)
check('shipping offered for US', quote.body.quote.shipping.available, true)
checkTruthy('shipping options priced', quote.body.quote.shipping.options.length > 0)

const gbQuote = await api('/checkout/quote', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ country: 'GB', postcode: 'SW1A 1AA' }),
})
checkTruthy('UK quote adds VAT', gbQuote.body.quote.totals.taxTotal > 0)

console.log('\n=== 5. Place the order ===')

const address = {
  firstName: 'Test',
  lastName: 'Buyer',
  company: '',
  line1: '1 Kiln Road',
  line2: '',
  city: 'New York',
  region: 'NY',
  postcode: '10001',
  country: 'US',
  phone: '',
}

const idempotencyKey = `test-${Date.now()}`
const placed = await api('/checkout', {
  method: 'POST',
  headers: {
    ...auth,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify({
    email: 'test@example.com',
    billingAddress: address,
    shippingSameAsBilling: true,
    shippingMethodId: quote.body.quote.shipping.selected?.methodId,
  }),
})

check('order created (201)', placed.status, 201)
if (placed.status !== 201) {
  abort(
    'order was not created',
    serverMessage(placed.body) ?? JSON.stringify(placed.body),
  )
}
checkTruthy('order reference issued', /^JZ-/.test(placed.body.order.reference))
check('order starts pending', placed.body.order.status, 'pending')
checkTruthy('payment redirect returned', Boolean(placed.body.payment.redirectUrl))

const reference = placed.body.order.reference
const redirect = placed.body.payment.redirectUrl

console.log('\n=== 6. Idempotency ===')

const replay = await api('/checkout', {
  method: 'POST',
  headers: {
    ...auth,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify({
    email: 'test@example.com',
    billingAddress: address,
    shippingSameAsBilling: true,
  }),
})
check('same key returns the same order', replay.body.order.reference, reference)
check('replay is flagged as reused', replay.body.order.reused, true)

console.log('\n=== 7. Test gateway → signed webhook ===')

// The redirect points at /mock-payment?ref=...&order=...
const params = new URL(redirect).searchParams
const providerReference = params.get('ref')
const orderReference = params.get('order')

check('redirect carries an order reference', orderReference, reference)
checkTruthy('redirect carries a provider reference', providerReference)

const session = await api('/mock-payment/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerReference, orderReference }),
})
check('gateway session loads', session.status, 200)
check('session amount matches the order', session.body.session.amount, placed.body.order.totals.grandTotal)

const complete = await api('/mock-payment/complete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerReference, orderReference, outcome: 'paid' }),
})
check('payment completes', complete.status, 200)
check('order becomes paid', complete.body.order.status, 'paid')
check('fulfilment moves to processing', complete.body.order.fulfilmentStatus, 'processing')

console.log('\n=== 8. Order record ===')

const stored = await api(`/orders/${reference}`)
check('order is readable by reference', stored.status, 200)
check('stored status is paid', stored.body.order.status, 'paid')
check('email is masked in the public view', stored.body.order.email.includes('•'), true)

console.log('\n=== 9. Stock committed, not just reserved ===')

const after = await api(`/products/${TARGET_SLUG}`)
check(
  `stock fell by exactly one (${stockBefore} → ${stockBefore - 1})`,
  after.body.product.available,
  stockBefore - 1,
)

console.log('\n=== 10. Cart is empty after conversion ===')

const emptyCart = await api('/cart', { headers: auth })
check('converted cart has no items', emptyCart.body.cart.items.length, 0)

console.log('\n=== 11. Refusals stay refusals ===')

const unsigned = await api('/payments/mock/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { order_reference: reference, status: 'paid' } }),
})
check('unsigned webhook is rejected', unsigned.status, 400)

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(46)}`)
if (failed === 0) {
  console.log(`All ${passed} checks passed.`)
} else {
  console.log(`${passed} passed, ${failed} failed.`)
  process.exitCode = 1
}
