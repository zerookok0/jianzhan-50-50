import { applyBasisPoints } from '../lib/money.ts'

/**
 * COUPONS
 * ------------------------------------------------------------------
 * Eligibility is a pure function: given a coupon and the cart, answer yes
 * or no with a reason. No database access, so every rule in
 * tests/pricing.test.mjs is verified without a fixture.
 *
 * The reason string is not decoration — the front end shows it, because
 * "invalid code" for an expired code is a support ticket waiting to happen.
 */

export interface Coupon {
  id: string
  code: string
  discountType: 'percent' | 'fixed'
  /** Basis points when percent; minor units when fixed. */
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
  subtotal: number
  lines: { productId: string; categoryId: string | null; subtotal: number }[]
  redemptionsTotal: number
  redemptionsByCustomer: number
  currency: string
  alreadyApplied: string[]
}

export type CouponReason =
  | 'ok'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'below_minimum'
  | 'exhausted'
  | 'customer_limit'
  | 'not_stackable'
  | 'no_eligible_items'
  | 'wrong_currency'

export interface CouponResult {
  ok: boolean
  reason: CouponReason
  /** Minor units. */
  discount: number
  /** Which product ids the discount may be allocated across. */
  eligibleProductIds: string[]
  message: string
}

const MESSAGES: Record<CouponReason, string> = {
  ok: '',
  inactive: 'That code is no longer active.',
  not_started: 'That code is not valid yet.',
  expired: 'That code has expired.',
  below_minimum: 'Your cart does not reach the minimum for that code.',
  exhausted: 'That code has been fully redeemed.',
  customer_limit: 'You have already used that code.',
  not_stackable: 'That code cannot be combined with another.',
  no_eligible_items: 'That code does not apply to anything in your cart.',
  wrong_currency: 'That code applies to a different currency.',
}

export function evaluateCoupon(coupon: Coupon, ctx: CouponContext): CouponResult {
  const fail = (reason: CouponReason): CouponResult => ({
    ok: false,
    reason,
    discount: 0,
    eligibleProductIds: [],
    message: MESSAGES[reason],
  })

  if (!coupon.isActive) return fail('inactive')

  if (coupon.currency && coupon.currency !== ctx.currency) return fail('wrong_currency')

  if (coupon.startsAt !== null && ctx.now < coupon.startsAt) return fail('not_started')
  if (coupon.endsAt !== null && ctx.now > coupon.endsAt) return fail('expired')

  if (coupon.minSubtotal > 0 && ctx.subtotal < coupon.minSubtotal) return fail('below_minimum')

  if (coupon.maxRedemptions !== null && ctx.redemptionsTotal >= coupon.maxRedemptions) {
    return fail('exhausted')
  }

  if (coupon.maxPerCustomer !== null && ctx.redemptionsByCustomer >= coupon.maxPerCustomer) {
    return fail('customer_limit')
  }

  if (coupon.stacking === 'exclusive' && ctx.alreadyApplied.length > 0) {
    return fail('not_stackable')
  }

  /* ---- Scope ---- */

  const scoped =
    coupon.includeProductIds.length > 0 || coupon.includeCategoryIds.length > 0

  const eligible = scoped
    ? ctx.lines.filter(
        (line) =>
          coupon.includeProductIds.includes(line.productId) ||
          (line.categoryId !== null && coupon.includeCategoryIds.includes(line.categoryId)),
      )
    : ctx.lines

  if (eligible.length === 0) return fail('no_eligible_items')

  const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.subtotal, 0)
  if (eligibleSubtotal <= 0) return fail('no_eligible_items')

  /* ---- Amount ---- */

  const discount =
    coupon.discountType === 'percent'
      ? applyBasisPoints(eligibleSubtotal, coupon.amount)
      : Math.min(coupon.amount, eligibleSubtotal)

  if (discount <= 0) return fail('below_minimum')

  return {
    ok: true,
    reason: 'ok',
    discount,
    eligibleProductIds: eligible.map((line) => line.productId),
    message: '',
  }
}

/**
 * The customer key a per-customer limit is counted against.
 *
 * Prefers the normalised email; falls back to the cart id when checkout
 * has not collected one yet. Without the fallback, a limit of 1 would be
 * bypassable simply by not typing an email address until the last moment.
 */
export function customerKeyFor(email: string | null, cartId: string): string {
  const normalised = (email ?? '').trim().toLowerCase()
  return normalised ? `email:${normalised}` : `cart:${cartId}`
}
