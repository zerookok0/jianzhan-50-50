import { applyBasisPoints, assertMoney, clampNonNegative } from '../lib/money.ts'

/**
 * PRICING
 * ------------------------------------------------------------------
 * Pure arithmetic. No database, no HTTP, no framework — which is why the
 * tests in tests/pricing.test.mjs can assert exact integers.
 *
 * THE TWO RULES THAT MATTER
 *
 *   1. Discounts are distributed across lines with the largest-remainder
 *      method, so the parts sum EXACTLY to the whole. Splitting a $10
 *      discount three ways with naive rounding gives $9.99 and a one-cent
 *      discrepancy that a customer will eventually notice.
 *
 *   2. Tax applies to the DISCOUNTED subtotal, not the gross. Taxes on
 *      money the customer never paid is a refund waiting to happen.
 */

/* ---------------- Shapes ---------------- */

export interface PriceLine {
  productId: string
  variantId: string | null
  name: string
  variantLabel: string
  sku: string
  quantity: number
  /** Minor units, per unit. */
  unitPrice: number
  weightG: number
  taxClass: string
  requiresShipping: boolean
  inventoryId: string | null
}

export interface DiscountAllocation {
  code: string
  /** Total discount applied, in minor units. */
  amount: number
  /** Per product id, so a line can show its own reduction. */
  perLine: Record<string, number>
}

export interface ShippingLine {
  methodId: string
  name: string
  amount: number
  taxClass?: string
}

export interface TaxRule {
  id: string
  name: string
  countries: string[]
  region: string
  taxClass: string
  rateBp: number
  pricesIncludeTax: boolean
  rounding: 'round' | 'floor' | 'ceil'
  position: number
  isActive: boolean
}

export interface Destination {
  country: string | null
  region: string | null
}

export interface Totals {
  subtotal: number
  discountTotal: number
  discountedSubtotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
  taxLabel: string | null
  taxRateBp: number
  taxIncludedInPrices: boolean
  /** Per-line discount, keyed by product id, so a row can display it. */
  perLineDiscount: Record<string, number>
}

/* ---------------- Subtotal ---------------- */

export function computeSubtotal(lines: PriceLine[]): number {
  return lines.reduce((sum, line) => {
    assertMoney(line.unitPrice, 'unitPrice')
    return sum + line.unitPrice * line.quantity
  }, 0)
}

export function totalWeight(lines: PriceLine[]): number {
  return lines.reduce(
    (sum, line) => (line.requiresShipping ? sum + line.weightG * line.quantity : sum),
    0,
  )
}

export function lineTotal(line: PriceLine): number {
  return line.unitPrice * line.quantity
}

/* ---------------- Discount allocation ---------------- */

/**
 * Split `total` across lines proportional to their subtotals, using the
 * largest-remainder method so the allocation sums exactly to `total`.
 *
 * Capped at the subtotal: a discount can never make an order negative.
 */
export function allocateDiscount(
  lines: PriceLine[],
  total: number,
  code: string,
): DiscountAllocation {
  assertMoney(total, 'discount total')

  const subtotal = computeSubtotal(lines)
  if (subtotal <= 0 || total <= 0) {
    return { code, amount: 0, perLine: {} }
  }

  const capped = Math.min(total, subtotal)

  const shares = lines.map((line) => {
    const lineSum = lineTotal(line)
    const exact = (lineSum * capped) / subtotal
    return {
      key: line.productId,
      floor: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    }
  })

  let allocated = shares.reduce((sum, share) => sum + share.floor, 0)
  let leftover = capped - allocated

  // Hand out the remaining cents, largest remainder first. Ties break on
  // the key so the result is deterministic (a test that changes answer
  // between runs is worse than no test).
  const ordered = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder
    return a.key.localeCompare(b.key)
  })

  for (const share of ordered) {
    if (leftover <= 0) break
    share.floor += 1
    leftover -= 1
  }

  const perLine: Record<string, number> = {}
  for (const share of shares) {
    if (share.floor > 0) perLine[share.key] = (perLine[share.key] ?? 0) + share.floor
  }

  allocated = Object.values(perLine).reduce((sum, v) => sum + v, 0)

  return { code, amount: allocated, perLine }
}

/* ---------------- Tax ---------------- */

/**
 * Choose the most specific rule for a destination and tax class.
 *
 * Specificity, highest first:
 *   country + region + tax class
 *   country + tax class
 *   country
 *   wildcard
 *
 * Two rules at the same specificity is a configuration error, and the
 * caller is told so rather than silently getting whichever sorted first.
 */
export function resolveTaxRule(
  rules: TaxRule[],
  request: Destination & { taxClass?: string },
): { rule: TaxRule | null; ambiguous: boolean } {
  const country = request.country?.toUpperCase() ?? ''
  const region = request.region?.toUpperCase() ?? ''
  const taxClass = request.taxClass ?? 'standard'

  const candidates = rules
    .filter((rule) => rule.isActive)
    .map((rule) => {
      const countryMatch = rule.countries.some(
        (c) => c === '*' || c.toUpperCase() === country,
      )
      if (!countryMatch) return null

      const regionMatch = !rule.region || rule.region.toUpperCase() === region
      if (!regionMatch) return null

      const classMatch = rule.taxClass === '*' || rule.taxClass === taxClass
      if (!classMatch) return null

      let score = 0
      if (rule.countries.some((c) => c !== '*')) score += 4
      if (rule.region) score += 2
      if (rule.taxClass !== '*') score += 1

      return { rule, score }
    })
    .filter((entry): entry is { rule: TaxRule; score: number } => entry !== null)

  if (candidates.length === 0) return { rule: null, ambiguous: false }

  const best = Math.max(...candidates.map((c) => c.score))
  const winners = candidates.filter((c) => c.score === best)

  return {
    rule: winners[0].rule,
    ambiguous: winners.length > 1,
  }
}

/* ---------------- Totals ---------------- */

export interface ComputeTotalsInput {
  lines: PriceLine[]
  discounts: DiscountAllocation[]
  shipping: ShippingLine | null
  taxRules: TaxRule[]
  destination: Destination
}

export function computeTotals(input: ComputeTotalsInput): Totals {
  const { lines, discounts, shipping, taxRules, destination } = input

  const subtotal = computeSubtotal(lines)

  const discountTotal = Math.min(
    subtotal,
    discounts.reduce((sum, d) => sum + Math.max(0, d.amount), 0),
  )

  const perLineDiscount: Record<string, number> = {}
  for (const discount of discounts) {
    for (const [productId, amount] of Object.entries(discount.perLine)) {
      perLineDiscount[productId] = (perLineDiscount[productId] ?? 0) + amount
    }
  }

  const discountedSubtotal = subtotal - discountTotal
  const shippingTotal = shipping ? clampNonNegative(shipping.amount) : 0

  /* ---- Tax ---- */

  const { rule } = resolveTaxRule(taxRules, {
    ...destination,
    taxClass: 'standard',
  })

  const rateBp = rule?.rateBp ?? 0
  const taxIncludedInPrices = rule?.pricesIncludeTax ?? false
  const rounding = rule?.rounding ?? 'round'

  let taxTotal = 0

  if (rule && rateBp > 0) {
    if (taxIncludedInPrices) {
      // The listed price already contains tax: EXTRACT it. The usual
      // mistake is to add it on top, which inflates every receipt by the
      // VAT rate while still "showing VAT" plausibly.
      const grossWithTax = discountedSubtotal + shippingTotal
      taxTotal = applyBasisPoints(grossWithTax, rateBp, rounding)
      const net = grossWithTax - taxTotal

      return {
        subtotal,
        discountTotal,
        discountedSubtotal,
        shippingTotal,
        taxTotal,
        // Grand total is the price the customer was quoted. Tax is a
        // component of it, not an addition to it.
        grandTotal: net + taxTotal,
        taxLabel: rule.name,
        taxRateBp: rateBp,
        taxIncludedInPrices,
        perLineDiscount,
      }
    }

    const taxable = discountedSubtotal + shippingTotal
    taxTotal = applyBasisPoints(taxable, rateBp, rounding)
  }

  return {
    subtotal,
    discountTotal,
    discountedSubtotal,
    shippingTotal,
    taxTotal,
    grandTotal: discountedSubtotal + shippingTotal + taxTotal,
    taxLabel: rule?.name ?? null,
    taxRateBp: rateBp,
    taxIncludedInPrices,
    perLineDiscount,
  }
}
