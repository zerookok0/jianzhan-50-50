import { applyBasisPoints, clampNonNegative, multiplyMoney, assertMoney } from '../lib/money.ts'

/**
 * PRICING ENGINE
 * ------------------------------------------------------------------
 * Pure functions. No database, no HTTP, no clock. Everything is passed in
 * explicitly so the whole calculation is unit-testable and deterministic.
 *
 * Order of operations (deliberate, and the usual cause of disputes):
 *   1. Line subtotal      = unit price × quantity
 *   2. Discounts          applied to the subtotal, allocated per line
 *   3. Tax                computed on the DISCOUNTED amount
 *   4. Shipping           computed on the discounted subtotal, then taxed
 *   5. Grand total        = discounted subtotal + tax + shipping
 *
 * All amounts are integer minor units. No floats.
 */

export interface PricedLine {
  productId: string
  variantId: string | null
  name: string
  variantLabel: string
  sku: string
  quantity: number
  unitPrice: number
  weightG: number
  taxClass: string
  requiresShipping: boolean
}

export interface DiscountAllocation {
  /** Coupon code, or 'automatic'. */
  code: string
  amount: number
  /** Per-product-id share of the discount, for accurate line-level tax. */
  perLine: Record<string, number>
}

export interface TaxLine {
  name: string
  rateBp: number
  /** Tax amount in minor units. */
  amount: number
  /** Base the tax was computed on. */
  taxableBase: number
  pricesIncludeTax: boolean
}

export interface ComputedTotals {
  subtotal: number
  discountTotal: number
  /** subtotal − discountTotal */
  discountedSubtotal: number
  taxTotal: number
  shippingTotal: number
  grandTotal: number
  taxLines: TaxLine[]
  discountAllocations: DiscountAllocation[]
}

/* ---------------- Tax rule shape (mirrors the tax_rules table) ---------------- */

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

/**
 * Pick the most specific applicable rule for a product in a destination.
 * Specificity: country+region+class beats country+class beats class-only.
 * Returns null when nothing matches — the caller must treat that as "no
 * tax configured" rather than assuming zero tax is correct.
 */
export function resolveTaxRule(
  rules: TaxRule[],
  args: { country: string | null; region: string | null; taxClass: string },
): { rule: TaxRule | null; ambiguous: boolean } {
  if (!args.country) return { rule: null, ambiguous: false }

  const candidates = rules.filter((r) => {
    if (!r.isActive) return false
    const countryOk = r.countries.includes('*') || r.countries.includes(args.country!)
    if (!countryOk) return false
    const regionOk = !r.region || r.region === args.region
    if (!regionOk) return false
    const classOk = r.taxClass === '*' || r.taxClass === args.taxClass
    return classOk
  })

  if (!candidates.length) return { rule: null, ambiguous: false }

  const score = (r: TaxRule) =>
    (r.countries.includes('*') ? 0 : 10) +
    (r.region ? 5 : 0) +
    (r.taxClass === '*' ? 0 : 3)

  const sorted = [...candidates].sort((a, b) => {
    const diff = score(b) - score(a)
    if (diff !== 0) return diff
    return a.position - b.position
  })

  // Two rules with identical specificity is a configuration error, not
  // something to silently resolve by array order. We compare the raw
  // specificity SCORE of the top two candidates, not their sorted order.
  const topScore = score(sorted[0])
  const ambiguous = sorted.length > 1 && score(sorted[1]) === topScore
  return { rule: sorted[0], ambiguous }
}

/* ---------------- Line subtotals ---------------- */

export function computeSubtotal(lines: PricedLine[]): number {
  return lines.reduce((sum, l) => sum + multiplyMoney(l.unitPrice, l.quantity), 0)
}

export function totalWeight(lines: PricedLine[]): number {
  return lines.reduce((sum, l) => {
    if (!l.requiresShipping) return sum
    return sum + l.weightG * l.quantity
  }, 0)
}

/* ---------------- Discount allocation ---------------- */

/**
 * Spread a whole-order discount across lines in proportion to their
 * subtotal, using largest-remainder so the parts sum EXACTLY to the total.
 *
 * Naive proportional rounding leaves a cent unallocated, which then shows
 * up as a tax discrepancy. Largest-remainder guarantees exactness.
 */
export function allocateDiscount(
  lines: PricedLine[],
  totalDiscount: number,
  code: string,
): DiscountAllocation {
  assertMoney(totalDiscount, 'totalDiscount')
  if (totalDiscount <= 0 || lines.length === 0) {
    return { code, amount: 0, perLine: {} }
  }

  const lineTotals = lines.map((l) => ({
    id: lineKey(l),
    subtotal: multiplyMoney(l.unitPrice, l.quantity),
  }))
  const subtotal = lineTotals.reduce((s, l) => s + l.subtotal, 0)
  if (subtotal === 0) return { code, amount: 0, perLine: {} }

  // Cap the discount at the subtotal — never discount below zero.
  const capped = Math.min(totalDiscount, subtotal)

  const exact = lineTotals.map((l) => (l.subtotal * capped) / subtotal)
  const floored = exact.map((v) => Math.floor(v))
  let remainder = capped - floored.reduce((s, v) => s + v, 0)

  // Hand out the leftover cents to the lines with the largest fractional part.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const allocated = [...floored]
  for (let k = 0; k < order.length && remainder > 0; k++) {
    allocated[order[k].i] += 1
    remainder--
  }

  const perLine: Record<string, number> = {}
  lineTotals.forEach((l, i) => {
    if (allocated[i] > 0) perLine[l.id] = allocated[i]
  })

  return { code, amount: capped, perLine }
}

export function lineKey(l: PricedLine): string {
  return l.variantId ? `${l.productId}:${l.variantId}` : l.productId
}

/* ---------------- Full computation ---------------- */

export interface ShippingSelection {
  methodId: string
  name: string
  /** Total shipping in minor units, already computed by shipping service. */
  amount: number
  /** Tax class applied to shipping, if the jurisdiction taxes it. */
  taxClass?: string
}

export interface ComputeInput {
  lines: PricedLine[]
  discounts: DiscountAllocation[]
  shipping: ShippingSelection | null
  taxRules: TaxRule[]
  destination: { country: string | null; region: string | null }
}

export function computeTotals(input: ComputeInput): ComputedTotals {
  const { lines, discounts, shipping, taxRules, destination } = input

  const subtotal = computeSubtotal(lines)
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0)
  const discountedSubtotal = clampNonNegative(subtotal - discountTotal)

  /* ---- Per-line discount share ---- */
  const discountByLine: Record<string, number> = {}
  for (const d of discounts) {
    for (const [key, amount] of Object.entries(d.perLine)) {
      discountByLine[key] = (discountByLine[key] ?? 0) + amount
    }
  }

  /* ---- Tax, per line, on the discounted amount ---- */
  const taxBuckets = new Map<string, TaxLine>()
  let taxTotal = 0
  /**
   * Tax already contained in the listed prices. When prices are
   * tax-inclusive the extracted tax is PART of the line price, not an
   * addition to it, so it must be excluded from the grand total while
   * still being reported on the invoice.
   */
  let taxIncludedInPrices = 0

  for (const line of lines) {
    const key = lineKey(line)
    const gross = multiplyMoney(line.unitPrice, line.quantity)
    const discounted = clampNonNegative(gross - (discountByLine[key] ?? 0))
    if (discounted === 0) continue

    const { rule } = resolveTaxRule(taxRules, {
      country: destination.country,
      region: destination.region,
      taxClass: line.taxClass,
    })
    if (!rule || rule.rateBp === 0) continue

    // Inclusive: extract the tax already inside the price.
    // Exclusive: compute the tax to add on top.
    const taxableBase = rule.pricesIncludeTax
      ? Math.round((discounted * 10000) / (10000 + rule.rateBp))
      : discounted

    const taxAmount = rule.pricesIncludeTax
      ? discounted - taxableBase
      : applyBasisPoints(discounted, rule.rateBp, rule.rounding)

    taxTotal += taxAmount
    if (rule.pricesIncludeTax) taxIncludedInPrices += taxAmount

    const bucketKey = `${rule.id}:${line.taxClass}`
    const existing = taxBuckets.get(bucketKey)
    if (existing) {
      existing.amount += taxAmount
      existing.taxableBase += taxableBase
    } else {
      taxBuckets.set(bucketKey, {
        name: rule.name,
        rateBp: rule.rateBp,
        amount: taxAmount,
        taxableBase,
        pricesIncludeTax: rule.pricesIncludeTax,
      })
    }
  }

  /* ---- Shipping (taxed with the 'shipping' class when a rule exists) ---- */
  let shippingTotal = shipping?.amount ?? 0
  if (shipping && shipping.amount > 0) {
    const { rule } = resolveTaxRule(taxRules, {
      country: destination.country,
      region: destination.region,
      taxClass: shipping.taxClass ?? 'shipping',
    })
    if (rule && rule.rateBp > 0 && !rule.pricesIncludeTax) {
      const shippingTax = applyBasisPoints(shipping.amount, rule.rateBp, rule.rounding)
      taxTotal += shippingTax
      const bucketKey = `${rule.id}:shipping`
      const existing = taxBuckets.get(bucketKey)
      if (existing) {
        existing.amount += shippingTax
        existing.taxableBase += shipping.amount
      } else {
        taxBuckets.set(bucketKey, {
          name: `${rule.name} (shipping)`,
          rateBp: rule.rateBp,
          amount: shippingTax,
          taxableBase: shipping.amount,
          pricesIncludeTax: false,
        })
      }
    } else if (rule && rule.pricesIncludeTax) {
      // Shipping price already includes tax; do not add anything.
      shippingTotal = shipping.amount
    }
  }

  // Tax-inclusive amounts are already inside discountedSubtotal, so only
  // the tax that must be ADDED (exclusive rules) belongs in the total.
  const grandTotal = discountedSubtotal + (taxTotal - taxIncludedInPrices) + shippingTotal

  return {
    subtotal,
    discountTotal,
    discountedSubtotal,
    taxTotal,
    shippingTotal,
    grandTotal,
    taxLines: [...taxBuckets.values()],
    discountAllocations: discounts,
  }
}

/** Human-readable summary, used by the quote endpoint and tests. */
export function describeTotals(t: ComputedTotals): string {
  return [
    `subtotal=${t.subtotal}`,
    `discount=${t.discountTotal}`,
    `tax=${t.taxTotal}`,
    `shipping=${t.shippingTotal}`,
    `grand=${t.grandTotal}`,
  ].join(' ')
}
