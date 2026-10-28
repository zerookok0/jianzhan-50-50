/**
 * PRICING / COUPON / SHIPPING TESTS
 * Pure business rules. No database, no HTTP.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  allocateDiscount,
  computeTotals,
  computeSubtotal,
  resolveTaxRule,
  totalWeight,
} from '../worker/services/pricing.ts'

import { evaluateCoupon } from '../worker/services/coupons.ts'

import {
  matchZone,
  quoteMethods,
  quoteShipping,
  selectQuote,
} from '../worker/services/shipping.ts'

/* ---------------- Fixtures ---------------- */

function line(over = {}) {
  return {
    productId: 'p1',
    variantId: null,
    name: 'Midnight Oil Spot',
    variantLabel: '',
    sku: 'JZ-01',
    quantity: 1,
    unitPrice: 42000,
    weightG: 310,
    taxClass: 'standard',
    requiresShipping: true,
    ...over,
  }
}

function coupon(over = {}) {
  return {
    id: 'c1',
    code: 'TEST10',
    discountType: 'percent',
    amount: 1000, // 10%
    currency: 'USD',
    minSubtotal: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxPerCustomer: null,
    includeProductIds: [],
    includeCategoryIds: [],
    stacking: 'stackable',
    isActive: true,
    ...over,
  }
}

function taxRule(over = {}) {
  return {
    id: 't1',
    name: 'VAT',
    countries: ['GB'],
    region: '',
    taxClass: '*',
    rateBp: 2000, // 20%
    pricesIncludeTax: false,
    rounding: 'round',
    position: 0,
    isActive: true,
    ...over,
  }
}

function zone(over = {}) {
  return {
    id: 'z1',
    name: 'UK',
    countries: ['GB'],
    regions: [],
    postcodePrefixes: [],
    position: 0,
    isActive: true,
    ...over,
  }
}

function method(over = {}) {
  return {
    id: 'm1',
    zoneId: 'z1',
    name: 'Standard',
    rateType: 'flat',
    rate: 1500,
    freeOver: null,
    minSubtotal: 0,
    deliveryTime: '3-5 days',
    isActive: true,
    position: 0,
    ...over,
  }
}

/* ---------------- Subtotal ---------------- */

test('subtotal multiplies price by quantity', () => {
  assert.equal(computeSubtotal([line({ quantity: 2 })]), 84000)
  assert.equal(
    computeSubtotal([line({ quantity: 1 }), line({ productId: 'p2', unitPrice: 18000 })]),
    60000,
  )
  assert.equal(computeSubtotal([]), 0)
})

test('weight sums only shippable lines', () => {
  const lines = [
    line({ quantity: 2, weightG: 310 }),
    line({ productId: 'p2', quantity: 1, weightG: 500, requiresShipping: false }),
  ]
  assert.equal(totalWeight(lines), 620, 'non-shipping lines excluded')
})

/* ---------------- Discount allocation ---------------- */

test('discount allocation sums exactly to the total', () => {
  const lines = [
    line({ productId: 'a', unitPrice: 100 }),
    line({ productId: 'b', unitPrice: 100 }),
    line({ productId: 'c', unitPrice: 100 }),
  ]
  const alloc = allocateDiscount(lines, 100, 'X')
  const sum = Object.values(alloc.perLine).reduce((s, v) => s + v, 0)
  assert.equal(sum, 100, 'largest-remainder must not lose a cent')
  assert.equal(alloc.amount, 100)
})

test('discount allocation caps at the subtotal', () => {
  const lines = [line({ unitPrice: 1000 })]
  const alloc = allocateDiscount(lines, 99999, 'X')
  assert.equal(alloc.amount, 1000)
  assert.equal(alloc.perLine['p1'], 1000)
})

test('discount of zero allocates nothing', () => {
  const alloc = allocateDiscount([line()], 0, 'X')
  assert.equal(alloc.amount, 0)
  assert.deepEqual(alloc.perLine, {})
})

/* ---------------- Totals ---------------- */

test('totals with no tax and no shipping', () => {
  const totals = computeTotals({
    lines: [line()],
    discounts: [],
    shipping: null,
    taxRules: [],
    destination: { country: null, region: null },
  })
  assert.equal(totals.subtotal, 42000)
  assert.equal(totals.discountTotal, 0)
  assert.equal(totals.taxTotal, 0)
  assert.equal(totals.shippingTotal, 0)
  assert.equal(totals.grandTotal, 42000)
})

test('tax is computed on the discounted amount, not the gross', () => {
  const lines = [line({ unitPrice: 10000 })]
  const discount = allocateDiscount(lines, 2000, 'X') // $20 off $100

  const totals = computeTotals({
    lines,
    discounts: [discount],
    shipping: null,
    taxRules: [taxRule({ countries: ['GB'], rateBp: 2000 })],
    destination: { country: 'GB', region: null },
  })

  assert.equal(totals.discountedSubtotal, 8000)
  assert.equal(totals.taxTotal, 1600)
  assert.equal(totals.grandTotal, 9600)
})

test('shipping is added and taxed separately', () => {
  const lines = [line({ unitPrice: 10000 })]
  const totals = computeTotals({
    lines,
    discounts: [],
    shipping: { methodId: 'm1', name: 'Standard', amount: 1500, taxClass: 'shipping' },
    taxRules: [taxRule({ countries: ['GB'], rateBp: 2000 })],
    destination: { country: 'GB', region: null },
  })

  assert.equal(totals.shippingTotal, 1500)
  assert.equal(totals.taxTotal, 2300)
  assert.equal(totals.grandTotal, 10000 + 2300 + 1500)
})

test('no tax rule means no tax, not an error', () => {
  const totals = computeTotals({
    lines: [line()],
    discounts: [],
    shipping: null,
    taxRules: [taxRule({ countries: ['GB'] })],
    destination: { country: 'US', region: null },
  })
  assert.equal(totals.taxTotal, 0)
  assert.equal(totals.grandTotal, 42000)
})

test('prices-include-tax extracts rather than adds', () => {
  const totals = computeTotals({
    lines: [line({ unitPrice: 12000 })],
    discounts: [],
    shipping: null,
    taxRules: [taxRule({ countries: ['GB'], rateBp: 2000, pricesIncludeTax: true })],
    destination: { country: 'GB', region: null },
  })

  assert.equal(totals.taxTotal, 2000)
  assert.equal(totals.grandTotal, 12000, 'inclusive pricing must not inflate the total')
})

/* ---------------- Tax rule resolution ---------------- */

test('most specific tax rule wins', () => {
  const general = taxRule({ id: 'general', countries: ['*'], taxClass: '*', rateBp: 500 })
  const country = taxRule({ id: 'country', countries: ['GB'], taxClass: '*', rateBp: 2000 })
  const specific = taxRule({ id: 'specific', countries: ['GB'], taxClass: 'reduced', rateBp: 500 })

  const { rule } = resolveTaxRule([general, country, specific], {
    country: 'GB',
    region: null,
    taxClass: 'reduced',
  })
  assert.equal(rule?.id, 'specific')
})

test('ambiguity between equally specific rules is reported', () => {
  const a = taxRule({ id: 'a', countries: ['GB'], taxClass: '*', position: 0 })
  const b = taxRule({ id: 'b', countries: ['GB'], taxClass: '*', position: 1 })

  const { ambiguous } = resolveTaxRule([a, b], {
    country: 'GB',
    region: null,
    taxClass: 'standard',
  })
  assert.equal(ambiguous, true, 'two identical-specificity rules is a config error')
})

/* ---------------- Coupons ---------------- */

const baseCtx = {
  now: 1_700_000_000_000,
  subtotal: 42000,
  lines: [{ productId: 'p1', categoryId: 'bowls', subtotal: 42000 }],
  redemptionsTotal: 0,
  redemptionsByCustomer: 0,
  currency: 'USD',
  alreadyApplied: [],
}

test('percentage coupon applies', () => {
  const result = evaluateCoupon(coupon(), baseCtx)
  assert.equal(result.ok, true)
  assert.equal(result.discount, 4200)
})

test('fixed coupon is capped at the subtotal', () => {
  const result = evaluateCoupon(coupon({ discountType: 'fixed', amount: 99999 }), baseCtx)
  assert.equal(result.ok, true)
  assert.equal(result.discount, 42000)
})

test('expired coupon is rejected with the right reason', () => {
  const result = evaluateCoupon(coupon({ endsAt: baseCtx.now - 1000 }), baseCtx)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'expired')
})

test('not-yet-started coupon is rejected', () => {
  const result = evaluateCoupon(coupon({ startsAt: baseCtx.now + 1000 }), baseCtx)
  assert.equal(result.reason, 'not_started')
})

test('minimum subtotal is enforced', () => {
  const result = evaluateCoupon(coupon({ minSubtotal: 50000 }), baseCtx)
  assert.equal(result.reason, 'below_minimum')
})

test('global redemption limit is enforced', () => {
  const result = evaluateCoupon(coupon({ maxRedemptions: 5 }), {
    ...baseCtx,
    redemptionsTotal: 5,
  })
  assert.equal(result.reason, 'exhausted')
})

test('per-customer limit is enforced', () => {
  const result = evaluateCoupon(coupon({ maxPerCustomer: 1 }), {
    ...baseCtx,
    redemptionsByCustomer: 1,
  })
  assert.equal(result.reason, 'customer_limit')
})

test('exclusive coupon rejects stacking', () => {
  const result = evaluateCoupon(coupon({ stacking: 'exclusive' }), {
    ...baseCtx,
    alreadyApplied: ['OTHER'],
  })
  assert.equal(result.reason, 'not_stackable')
})

test('product-scoped coupon only discounts eligible items', () => {
  const scoped = coupon({ includeProductIds: ['p2'] })
  const ctx = {
    ...baseCtx,
    subtotal: 60000,
    lines: [
      { productId: 'p1', categoryId: 'bowls', subtotal: 42000 },
      { productId: 'p2', categoryId: 'cups', subtotal: 18000 },
    ],
  }
  const result = evaluateCoupon(scoped, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.discount, 1800, '10% of only the $180 item')
  assert.deepEqual(result.eligibleProductIds, ['p2'])
})

test('product-scoped coupon with no eligible items is rejected', () => {
  const result = evaluateCoupon(coupon({ includeProductIds: ['nope'] }), baseCtx)
  assert.equal(result.reason, 'no_eligible_items')
})

test('inactive coupon is rejected', () => {
  const result = evaluateCoupon(coupon({ isActive: false }), baseCtx)
  assert.equal(result.reason, 'inactive')
})

/* ---------------- Shipping ---------------- */

test('zone matching prefers the most specific', () => {
  const rest = zone({ id: 'rest', countries: ['*'] })
  const uk = zone({ id: 'uk', countries: ['GB'] })
  const london = zone({ id: 'london', countries: ['GB'], postcodePrefixes: ['E', 'EC'] })

  const { zone: matched } = matchZone([rest, uk, london], {
    country: 'GB',
    region: null,
    postcode: 'EC1A 1BB',
  })
  assert.equal(matched?.id, 'london')
})

test('no matching zone reports unavailability', () => {
  const result = quoteShipping({
    zones: [zone()],
    methods: [method()],
    request: {
      country: 'US',
      region: null,
      postcode: null,
      subtotal: 1000,
      weightG: 100,
      needsShipping: true,
    },
  })
  assert.equal(result.available, false)
  assert.match(result.reason ?? '', /do not currently ship/)
})

test('flat rate shipping', () => {
  const quotes = quoteMethods([method()], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 10000,
    weightG: 500,
    needsShipping: true,
  })
  assert.equal(quotes[0].amount, 1500)
})

test('free shipping threshold waives the cost', () => {
  const quotes = quoteMethods([method({ freeOver: 50000 })], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 50000,
    weightG: 500,
    needsShipping: true,
  })
  assert.equal(quotes[0].amount, 0)
  assert.equal(quotes[0].freeApplied, true)
})

test('weight-based shipping rounds up to whole kilograms', () => {
  const quotes = quoteMethods([method({ rateType: 'weight', rate: 500 })], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 10000,
    weightG: 1250,
    needsShipping: true,
  })
  assert.equal(quotes[0].amount, 1000)
})

test('subtotal-based shipping is a percentage', () => {
  const quotes = quoteMethods([method({ rateType: 'subtotal', rate: 500 })], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 10000,
    weightG: 500,
    needsShipping: true,
  })
  assert.equal(quotes[0].amount, 500)
})

test('methods below their minimum subtotal are not offered', () => {
  const quotes = quoteMethods([method({ minSubtotal: 50000 })], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 10000,
    weightG: 500,
    needsShipping: true,
  })
  assert.equal(quotes.length, 0)
})

test('cart with nothing to ship returns available with no options', () => {
  const result = quoteShipping({
    zones: [],
    methods: [],
    request: {
      country: 'GB',
      region: null,
      postcode: null,
      subtotal: 1000,
      weightG: 0,
      needsShipping: false,
    },
  })
  assert.equal(result.available, true)
  assert.equal(result.quotes.length, 0)
})

test('selecting a stale method returns null rather than a wrong price', () => {
  const quotes = quoteMethods([method()], 'z1', {
    country: 'GB',
    region: null,
    postcode: null,
    subtotal: 10000,
    weightG: 500,
    needsShipping: true,
  })
  assert.equal(selectQuote(quotes, 'deleted-method'), null)
})

test('default selection is the cheapest option', () => {
  const quotes = quoteMethods(
    [method({ id: 'slow', rate: 2000, position: 0 }), method({ id: 'cheap', rate: 500, position: 1 })],
    'z1',
    {
      country: 'GB',
      region: null,
      postcode: null,
      subtotal: 10000,
      weightG: 500,
      needsShipping: true,
    },
  )
  assert.equal(selectQuote(quotes, null)?.methodId, 'cheap')
})
