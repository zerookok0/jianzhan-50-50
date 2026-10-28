import { applyBasisPoints, assertMoney, clampNonNegative } from '../lib/money.ts'

/**
 * COUPON EVALUATION
 * ------------------------------------------------------------------
 * Pure functions over a coupon row plus the cart context. All the rules
 * that decide *whether* a coupon applies live here, so they can be tested
 * without a database.
 */

export interface CouponRule {
  id: string
  code: string
  discountType: 'percent' | 'fixed'
  /** percent: basis points. fixed: minor units. */
  amount: number
  currency: string
  minSubtotal: number
  startsAt: number | null
  endsAt: number | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
  includeProductIds: string[]
  includeCategoryIds: string[]
  stacking: 'stackable' | 'exclusive'
  isActive: boolean
}

export interface CouponContext {
  now: number
  /** Minor units, before discounts. */
  subtotal: number
  /** Which products are in the cart, with their category and line subtotal. */
  lines: { productId: string; categoryId: string | null; subtotal: number }[]
  /** Total redemptions so far, for global limits. */
  redemptionsTotal: number
  /** Redemptions by this customer (by email), for per-customer limits. */
  redemptionsByCustomer: number
  currency: string
  /** Codes already applied to the cart, for stacking checks. */
  alreadyApplied: string[]
}

export type CouponRejection =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'below_minimum'
  | 'currency_mismatch'
  | 'exhausted'
  | 'customer_limit'
  | 'no_eligible_items'
  | 'not_stackable'

export interface CouponEvaluation {
  ok: boolean
  reason?: CouponRejection
  message?: string
  /** Discount in minor units, before capping to the subtotal. */
  discount: number
  /** Product ids the discount actually applies to. */
  eligibleProductIds: string[]
}

/**
 * Evaluate one coupon.
 *
 * Order of checks matters: report the most actionable failure first. A
 * customer typing an expired code should see "expired", not "below
 * minimum".
 */
export function evaluateCoupon(coupon: CouponRule, ctx: CouponContext): CouponEvaluation {
  const reject = (reason: CouponRejection, message: string): CouponEvaluation => ({
    ok: false,
    reason,
    message,
    discount: 0,
    eligibleProductIds: [],
  })

  if (!coupon.isActive) {
    return reject('inactive', 'This code is no longer available.')
  }

  if (coupon.startsAt !== null && ctx.now < coupon.startsAt) {
    return reject('not_started', 'This code is not active yet.')
  }

  if (coupon.endsAt !== null && ctx.now > coupon.endsAt) {
    return reject('expired', 'This code has expired.')
  }

  if (coupon.currency !== ctx.currency && coupon.discountType === 'fixed') {
    return reject('currency_mismatch', 'This code is not valid for your currency.')
  }

  if (coupon.maxRedemptions !== null && ctx.redemptionsTotal >= coupon.maxRedemptions) {
    return reject('exhausted', 'This code has reached its usage limit.')
  }

  if (coupon.maxPerCustomer !== null && ctx.redemptionsByCustomer >= coupon.maxPerCustomer) {
    return reject('customer_limit', 'You have already used this code.')
  }

  if (coupon.stacking === 'exclusive' && ctx.alreadyApplied.length > 0) {
    return reject('not_stackable', 'This code cannot be combined with others.')
  }

  if (ctx.subtotal < coupon.minSubtotal) {
    return reject(
      'below_minimum',
      `Spend at least ${formatMinor(coupon.minSubtotal)} to use this code.`,
    )
  }

  /* ---- Scope the discount to eligible items ---- */

  const hasScope = coupon.includeProductIds.length > 0 || coupon.includeCategoryIds.length > 0

  const eligible = ctx.lines.filter((l) => {
    if (!hasScope) return true
    if (coupon.includeProductIds.includes(l.productId)) return true
    if (l.categoryId && coupon.includeCategoryIds.includes(l.categoryId)) return true
    return false
  })

  if (hasScope && eligible.length === 0) {
    return reject('no_eligible_items', 'This code does not apply to the items in your cart.')
  }

  const eligibleSubtotal = eligible.reduce((s, l) => s + l.subtotal, 0)

  let discount =
    coupon.discountType === 'percent'
      ? applyBasisPoints(eligibleSubtotal, coupon.amount, 'round')
      : Math.min(coupon.amount, eligibleSubtotal)

  discount = clampNonNegative(discount)

  return {
    ok: true,
    discount,
    eligibleProductIds: eligible.map((l) => l.productId),
  }
}

/**
 * Evaluate a set of coupons together, enforcing stacking rules.
 * Returns the accepted evaluations and the rejected ones with reasons, so
 * the UI can explain each code individually.
 */
export function evaluateCoupons(
  coupons: CouponRule[],
  baseCtx: Omit<CouponContext, 'alreadyApplied'>,
): {
  accepted: { coupon: CouponRule; result: CouponEvaluation }[]
  rejected: { coupon: CouponRule; result: CouponEvaluation }[]
} {
  const accepted: { coupon: CouponRule; result: CouponEvaluation }[] = []
  const rejected: { coupon: CouponRule; result: CouponEvaluation }[] = []
  const applied: string[] = []

  // Exclusive codes are evaluated first; if one is valid, everything else
  // is refused rather than partially applied.
  const sorted = [...coupons].sort((a, b) => {
    if (a.stacking === b.stacking) return 0
    return a.stacking === 'exclusive' ? -1 : 1
  })

  for (const coupon of sorted) {
    const result = evaluateCoupon(coupon, { ...baseCtx, alreadyApplied: applied })
    if (result.ok) {
      accepted.push({ coupon, result })
      applied.push(coupon.code)
      if (coupon.stacking === 'exclusive') break
    } else {
      rejected.push({ coupon, result })
    }
  }

  return { accepted, rejected }
}

function formatMinor(amount: number): string {
  assertMoney(amount, 'amount')
  return (amount / 100).toFixed(2)
}
