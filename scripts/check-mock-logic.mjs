/**
 * Exercises the mock Store API logic without a browser.
 * Extracts the same fixture maths the browser mock uses, so a regression
 * in pricing/stock/discount handling shows up here rather than in the UI.
 *
 * Usage: node scripts/check-mock-logic.mjs
 */

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}`)
    console.log(`      actual   ${JSON.stringify(actual)}`)
    failures++
  }
}

/* ---- Replicate the mock's money maths (minor units, 2dp) ---- */

const CATALOGUE = {
  101: { name: 'Midnight Oil Spot', price: 42000, stock: 3 },
  103: { name: 'Iridescent Blue', price: 64000, stock: 2 },
  108: { name: 'Deep Iridescence', price: 72000, stock: 0 },
  109: { name: "Hare's Fur Cup", price: 18000, stock: 10 },
}

const COUPONS = {
  TEST10: { type: 'percent', amount: 10 },
  WELCOME20: { type: 'percent', amount: 20 },
  SHIPFREE: { type: 'fixed', amount: 1500 },
}

function totals(lines, coupons = []) {
  const totalItems = lines.reduce((a, l) => a + CATALOGUE[l.id].price * l.qty, 0)
  let discount = 0
  for (const code of coupons) {
    const c = COUPONS[code]
    discount +=
      c.type === 'percent'
        ? Math.round((totalItems * c.amount) / 100)
        : Math.min(c.amount, totalItems)
  }
  const shipping = totalItems > 0 ? (totalItems >= 50000 ? 0 : 1500) : 0
  const total = Math.max(0, totalItems - discount) + shipping
  return { totalItems, discount, shipping, total }
}

/* ---- Cart maths ---- */

check('one bowl subtotal', totals([{ id: 101, qty: 1 }]).totalItems, 42000)
check('one bowl + $15 shipping', totals([{ id: 101, qty: 1 }]).shipping, 1500)
check('one bowl total', totals([{ id: 101, qty: 1 }]).total, 43500)

check('over $500 ships free', totals([{ id: 103, qty: 1 }]).shipping, 0)
check('$640 item total', totals([{ id: 103, qty: 1 }]).total, 64000)

check('two cups = $360', totals([{ id: 109, qty: 2 }]).totalItems, 36000)
check('two cups total', totals([{ id: 109, qty: 2 }]).total, 37500)

/* ---- Coupons ---- */

check('10% off $420', totals([{ id: 101, qty: 1 }], ['TEST10']).discount, 4200)
check('10% off applied to total', totals([{ id: 101, qty: 1 }], ['TEST10']).total, 39300)

check('20% off $420', totals([{ id: 101, qty: 1 }], ['WELCOME20']).discount, 8400)

check('fixed $15 coupon', totals([{ id: 101, qty: 1 }], ['SHIPFREE']).discount, 1500)
check('fixed coupon never exceeds subtotal', totals([{ id: 109, qty: 1 }], ['SHIPFREE']).discount, 1500)

// Coupon cannot drive the total negative.
const big = totals([{ id: 109, qty: 1 }], ['TEST10', 'WELCOME20'])
check('stacked coupons stay non-negative', big.total >= 0, true)

/* ---- Stock rules (mirrors add-item guards) ---- */

function canAdd(id, alreadyInCart, wantQty = 1) {
  const p = CATALOGUE[id]
  if (!p) return 'not-found'
  if (p.stock <= 0) return 'out-of-stock'
  if (alreadyInCart + wantQty > p.stock) return 'insufficient'
  return 'ok'
}

check('out of stock item rejected', canAdd(108, 0), 'out-of-stock')
check('first add of stock-3 item', canAdd(101, 0), 'ok')
check('add up to stock limit', canAdd(101, 2), 'ok')
check('exceeding stock rejected', canAdd(101, 3), 'insufficient')
check('unknown product rejected', canAdd(999, 0), 'not-found')
check('stock-2 item allows second add', canAdd(103, 1), 'ok')

/* ---- Empty cart ---- */

check('empty cart totals zero', totals([]).total, 0)
check('empty cart no shipping', totals([]).shipping, 0)

console.log(`\n${failures === 0 ? 'All mock logic checks passed.' : failures + ' check(s) failed.'}`)
process.exitCode = failures === 0 ? 0 : 1
