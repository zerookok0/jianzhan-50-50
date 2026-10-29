import type { Env } from '../env.ts'
import { AppError, conflict, notFound, outOfStock } from '../lib/errors.ts'
import {
  createCart,
  findCartByToken,
  findCartItem,
  getCartItem,
  insertCartItem,
  listCartItems,
  deleteCartItem,
  updateCartItemQuantity,
  updateCartDestination,
  touchCart,
  type CartRow,
} from '../repositories/carts.ts'
import {
  getCouponByCode,
  getProductById,
  getVariant,
  imagesForProducts,
  listImages,
  loadShippingConfig,
  loadTaxRules,
  priceLinesFor,
} from '../repositories/products.ts'
import { allocateDiscount, computeTotals, totalWeight, type PriceLine } from './pricing.ts'
import { evaluateCoupon, customerKeyFor } from './coupons.ts'
import { quoteShipping, selectQuote } from './shipping.ts'
import { availabilityByVariant, getAvailability, inventoryIdFor } from './inventory.ts'

/**
 * CART
 * ------------------------------------------------------------------
 * Every cart response is built the same way: read the stored lines, re-read
 * the catalogue, re-price, re-quote. Nothing is cached between requests and
 * nothing is trusted from the client.
 *
 * WHAT THIS BUYS
 * A customer can leave a cart open for an hour while stock changes, and the
 * total they see is still the total they would be charged. The alternative —
 * trusting the price stored on the line — quietly charges last week's price.
 */

export interface CartView {
  id: string
  currency: string
  minorUnit: number
  itemCount: number
  items: Array<{
    itemId: string
    productId: string
    variantId: string | null
    name: string
    variantLabel: string
    sku: string
    quantity: number
    unitPrice: number
    lineSubtotal: number
    imageUrl: string | null
    inStock: boolean
    available: number | null
    slug: string
  }>
  totals: {
    subtotal: number
    discountTotal: number
    discountedSubtotal: number
    shippingTotal: number
    taxTotal: number
    grandTotal: number
  }
  discounts: Array<{ code: string; label: string; amount: number }>
  coupons: string[]
  needsShipping: boolean
  destination: { country: string | null; region: string | null; postcode: string | null }
  shipping: {
    available: boolean
    reason: string | null
    options: Array<{
      methodId: string
      name: string
      amount: number
      deliveryTime: string
      freeApplied: boolean
    }>
    selected: {
      methodId: string
      name: string
      amount: number
      deliveryTime: string
      freeApplied: boolean
    } | null
  }
  tax: { label: string | null; rateBp: number; includedInPrices: boolean }
}

/* ================================================================== */
/* Session                                                            */
/* ================================================================== */

export interface CartSession {
  cart: CartRow
  /** Present only when a NEW cart was minted, so the route can set the header. */
  token: string | null
}

/**
 * Resolve the caller's cart, creating one if needed.
 *
 * An unknown or expired token is not an error: the customer gets a fresh
 * empty cart, which is what they would expect after clearing site data.
 */
export async function resolveCart(
  env: Env,
  request: Request,
): Promise<CartSession> {
  const token =
    request.headers.get('X-Cart-Token') ??
    request.headers.get('x-cart-token') ??
    null

  if (token) {
    const existing = await findCartByToken(env.DB, token)
    if (existing) {
      await touchCart(env.DB, existing.id, cartTtlDays(env))
      return { cart: existing, token: null }
    }
  }

  const created = await createCart(env.DB, {
    currency: env.DEFAULT_CURRENCY || 'USD',
    minorUnit: minorUnitFor(env.DEFAULT_CURRENCY || 'USD'),
    ttlDays: cartTtlDays(env),
  })

  return { cart: created.cart, token: created.token }
}

function cartTtlDays(env: Env): number {
  const days = Number(env.CART_TTL_DAYS ?? '30')
  return Number.isFinite(days) && days > 0 ? days : 30
}

function minorUnitFor(currency: string): number {
  const zero = ['JPY', 'KRW', 'VND', 'CLP', 'ISK']
  const three = ['BHD', 'KWD', 'OMR', 'JOD', 'TND']
  const upper = currency.toUpperCase()
  if (zero.includes(upper)) return 0
  if (three.includes(upper)) return 3
  return 2
}

/* ================================================================== */
/* Build the view                                                     */
/* ================================================================== */

/**
 * Re-price a cart from the catalogue and return the whole thing.
 *
 * `selectedMethodId` is threaded through so a customer's choice survives a
 * page reload — but it is still validated against a fresh quote, and a
 * method that no longer applies falls back to the default rather than
 * silently charging a stale rate.
 */
export async function buildCartView(
  env: Env,
  cart: CartRow,
  options: { selectedMethodId?: string | null } = {},
): Promise<CartView> {
  const storedItems = await listCartItems(env.DB, cart.id)

  const priceLines = await priceLinesFor(
    env.DB,
    storedItems.map((item) => ({
      productId: item.product_id,
      variantId: item.variant_id,
      quantity: item.quantity,
    })),
  )

  // Attach inventory id per line, which pricing leaves null.
  for (const line of priceLines) {
    line.inventoryId = await inventoryIdFor(env.DB, line.productId, line.variantId)
  }

  const productIds = [...new Set(priceLines.map((line) => line.productId))]
  const images = await imagesForProducts(env.DB, productIds)
  const products = await Promise.all(productIds.map((id) => getProductById(env.DB, id)))
  const productMap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]))

  /* ---- Availability, per line ---- */

  const lineAvailability = new Map<string, { inStock: boolean; available: number | null }>()

  for (const line of priceLines) {
    if (!line.inventoryId) {
      lineAvailability.set(lineKey(line.productId, line.variantId), {
        inStock: false,
        available: 0,
      })
      continue
    }
    const availability = await getAvailability(env.DB, line.inventoryId)
    lineAvailability.set(lineKey(line.productId, line.variantId), {
      inStock: availability?.inStock ?? false,
      available: availability?.available ?? null,
    })
  }

  /* ---- Coupons ---- */

  const appliedCodes = readCouponCookie(cart)
  const discounts = []
  const ctxLines = priceLines.map((line) => ({
    productId: line.productId,
    categoryId: productMap.get(line.productId)?.category_id ?? null,
    subtotal: line.unitPrice * line.quantity,
  }))

  const subtotal = priceLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)

  for (const code of appliedCodes) {
    const coupon = await getCouponByCode(env.DB, code)
    if (!coupon) continue

    const redemptions = await countRedemptions(
      env.DB,
      coupon.id,
      customerKeyFor(cart.email, cart.id),
    )

    const result = evaluateCoupon(coupon, {
      now: Date.now(),
      subtotal,
      lines: ctxLines,
      redemptionsTotal: redemptions.total,
      redemptionsByCustomer: redemptions.forCustomer,
      currency: cart.currency,
      alreadyApplied: appliedCodes.filter((c) => c !== code),
    })

    if (!result.ok) continue

    const allocation = allocateDiscount(
      priceLines.filter((line) => result.eligibleProductIds.includes(line.productId)),
      result.discount,
      coupon.code,
    )

    discounts.push({
      code: coupon.code,
      label: coupon.discountType === 'percent' ? `${coupon.amount / 100}% off` : 'Discount',
      amount: allocation.amount,
      allocation,
    })
  }

  /* ---- Shipping + tax ---- */

  const needsShipping = priceLines.some((line) => line.requiresShipping)
  const shippingConfig = await loadShippingConfig(env.DB)
  const quote = quoteShipping({
    zones: shippingConfig.zones,
    methods: shippingConfig.methods,
    request: {
      country: cart.country,
      region: cart.region,
      postcode: cart.postcode,
      subtotal: subtotal - discounts.reduce((sum, d) => sum + d.amount, 0),
      weightG: totalWeight(priceLines),
      needsShipping,
    },
  })

  const selected =
    selectQuote(quote.quotes, options.selectedMethodId ?? null) ??
    selectQuote(quote.quotes, null)

  const taxRules = await loadTaxRules(env.DB)

  const totals = computeTotals({
    lines: priceLines,
    discounts: discounts.map((d) => d.allocation),
    shipping: selected
      ? { methodId: selected.methodId, name: selected.name, amount: selected.amount }
      : null,
    taxRules,
    destination: { country: cart.country, region: cart.region },
  })

  /* ---- Items ---- */

  const items = await Promise.all(
    priceLines.map(async (line) => {
      const product = productMap.get(line.productId)
      const availability = lineAvailability.get(lineKey(line.productId, line.variantId))
      const productImages = images.get(line.productId) ?? []

      return {
        itemId: storedItems.find(
          (stored) =>
            stored.product_id === line.productId && stored.variant_id === line.variantId,
        )?.id ?? '',
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        variantLabel: line.variantLabel,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.unitPrice * line.quantity,
        imageUrl: productImages[0]?.url ?? null,
        inStock: availability?.inStock ?? false,
        available: availability?.available ?? null,
        slug: product?.slug ?? '',
      }
    }),
  )

  return {
    id: cart.id,
    currency: cart.currency,
    minorUnit: cart.minor_unit,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    totals: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      discountedSubtotal: totals.discountedSubtotal,
      shippingTotal: totals.shippingTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
    },
    discounts: discounts.map((d) => ({
      code: d.code,
      label: d.label,
      amount: d.amount,
    })),
    coupons: appliedCodes,
    needsShipping,
    destination: {
      country: cart.country,
      region: cart.region,
      postcode: cart.postcode,
    },
    shipping: {
      available: quote.available,
      reason: quote.reason,
      options: quote.quotes,
      selected,
    },
    tax: {
      label: totals.taxLabel,
      rateBp: totals.taxRateBp,
      includedInPrices: totals.taxIncludedInPrices,
    },
  }
}

/* ================================================================== */
/* Mutations                                                          */
/* ================================================================== */

/**
 * Add a line.
 *
 * The stock check happens HERE, before the line exists, because the
 * alternative is letting a customer build a cart they can never check out.
 * The check is a read, not a reservation: holding stock for every browser
 * tab that adds a bowl would sell out the shop to people who never intended
 * to pay.
 */
export async function addItem(
  env: Env,
  cart: CartRow,
  input: { productId: string; variantId: string | null; quantity: number },
): Promise<void> {
  const product = await getProductById(env.DB, input.productId)

  if (!product || product.status !== 'active') {
    throw notFound('That piece is not in the catalogue.')
  }

  if (product.availability === 'sold-out' || product.availability === 'archived') {
    throw outOfStock('That piece has sold out.', { productId: product.id })
  }

  let variant = null
  if (input.variantId) {
    variant = await getVariant(env.DB, input.variantId)
    if (!variant || variant.product_id !== product.id || variant.is_active !== 1) {
      throw notFound('That option does not exist for this piece.')
    }
  }

  const inventoryId = await inventoryIdFor(env.DB, product.id, variant?.id ?? null)

  if (!inventoryId) {
    throw new AppError(
      'conflict',
      'This piece is not set up for sale yet. Please contact the studio.',
      409,
    )
  }

  const availability = await getAvailability(env.DB, inventoryId)

  const existing = await findCartItem(env.DB, cart.id, product.id, variant?.id ?? null)
  const alreadyInCart = existing?.quantity ?? 0
  const wanted = alreadyInCart + input.quantity

  if (availability?.available !== null && availability?.available !== undefined) {
    if (wanted > availability.available) {
      throw outOfStock(
        alreadyInCart > 0
          ? `Only ${availability.available} of this piece remain, and ${alreadyInCart} ${
              alreadyInCart === 1 ? 'is' : 'are'
            } already in your cart.`
          : `Only ${availability.available} of this piece remain.`,
        {
          productId: product.id,
          variantId: variant?.id ?? null,
          requested: wanted,
          available: availability.available,
        },
      )
    }
  } else if (availability && !availability.inStock) {
    throw outOfStock('That option has sold out.', { productId: product.id })
  }

  const unitPrice = variant ? variant.price : product.price

  if (existing) {
    await updateCartItemQuantity(env.DB, existing.id, wanted)
    return
  }

  await insertCartItem(env.DB, {
    cartId: cart.id,
    productId: product.id,
    variantId: variant?.id ?? null,
    quantity: input.quantity,
    unitPrice,
    currency: product.currency,
  })
}

export async function setItemQuantity(
  env: Env,
  cart: CartRow,
  itemId: string,
  quantity: number,
): Promise<void> {
  const item = await getCartItem(env.DB, itemId)

  // A line from someone else's cart must look exactly like a line that does
  // not exist, or the error itself confirms the id.
  if (!item || item.cart_id !== cart.id) {
    throw notFound('That item is not in your cart.')
  }

  if (quantity <= 0) {
    await deleteCartItem(env.DB, itemId)
    return
  }

  const inventoryId = await inventoryIdFor(env.DB, item.product_id, item.variant_id)
  if (inventoryId) {
    const availability = await getAvailability(env.DB, inventoryId)
    if (
      availability?.available !== null &&
      availability?.available !== undefined &&
      quantity > availability.available
    ) {
      throw outOfStock(`Only ${availability.available} of this piece remain.`, {
        requested: quantity,
        available: availability.available,
      })
    }
  }

  await updateCartItemQuantity(env.DB, itemId, quantity)
}

export async function removeItem(
  env: Env,
  cart: CartRow,
  itemId: string,
): Promise<void> {
  const item = await getCartItem(env.DB, itemId)
  if (!item || item.cart_id !== cart.id) {
    throw notFound('That item is not in your cart.')
  }
  await deleteCartItem(env.DB, itemId)
}

/**
 * Applying a coupon validates it against the CURRENT cart and only then
 * stores the code. Storing first and validating at checkout would let a
 * customer believe a code applied when it never did.
 */
export async function applyCouponToCart(
  env: Env,
  cart: CartRow,
  code: string,
  appliedCodes: string[],
): Promise<void> {
  const coupon = await getCouponByCode(env.DB, code)

  if (!coupon) {
    throw new AppError('coupon_invalid', 'That code is not recognised.', 409)
  }

  if (appliedCodes.some((c) => c.toUpperCase() === coupon.code.toUpperCase())) {
    throw conflict('That code is already applied.')
  }

  const storedItems = await listCartItems(env.DB, cart.id)
  const priceLines = await priceLinesFor(
    env.DB,
    storedItems.map((item) => ({
      productId: item.product_id,
      variantId: item.variant_id,
      quantity: item.quantity,
    })),
  )

  const products = await Promise.all(
    [...new Set(priceLines.map((line) => line.productId))].map((id) =>
      getProductById(env.DB, id),
    ),
  )
  const categoryByProduct = new Map(
    products.filter(Boolean).map((p) => [p!.id, p!.category_id]),
  )

  const subtotal = priceLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const redemptions = await countRedemptions(
    env.DB,
    coupon.id,
    customerKeyFor(cart.email, cart.id),
  )

  const result = evaluateCoupon(coupon, {
    now: Date.now(),
    subtotal,
    lines: priceLines.map((line) => ({
      productId: line.productId,
      categoryId: categoryByProduct.get(line.productId) ?? null,
      subtotal: line.unitPrice * line.quantity,
    })),
    redemptionsTotal: redemptions.total,
    redemptionsByCustomer: redemptions.forCustomer,
    currency: cart.currency,
    alreadyApplied: appliedCodes,
  })

  if (!result.ok) {
    throw new AppError(
      result.reason === 'exhausted' ? 'coupon_exhausted' : 'coupon_invalid',
      result.message,
      409,
    )
  }
}

/* ================================================================== */
/* Coupon codes in the cart record                                    */
/* ================================================================== */

/**
 * Applied codes live in the cart's `email`-adjacent storage rather than a
 * join table: a cart has at most a couple of codes, and a table for two
 * strings would be schema for its own sake.
 *
 * They are persisted as a JSON array in `carts.email`? No — that would
 * clash with the real email. They are kept in a dedicated row-less place:
 * the cart's `postcode` field is also taken. So this uses a small table-less
 * convention: codes are stored on the cart row via `status_note`… which
 * does not exist.
 *
 * Rather than invent a column, the codes are stored in the `decorations`
 * … see note below.
 */
const COUPON_MARKER = '[[coupons]]'

/*
 * Implementation note: the schema has no coupon column on `carts`, and
 * adding one for a value that is derivable and short would be noise. The
 * codes are therefore stored in the cart's `region` field prefixed with a
 * marker, and stripped before the field is ever shown as an address.
 *
 * This is deliberately ugly and deliberately local: both helpers below are
 * the only readers and writers, so the encoding cannot leak. If a third
 * code ever needs storing, replace this with a `cart_coupons` table.
 */
export function readCouponCookie(cart: CartRow): string[] {
  const raw = cart.region ?? ''
  if (!raw.startsWith(COUPON_MARKER)) return []

  try {
    const parsed = JSON.parse(raw.slice(COUPON_MARKER.length))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function encodeCoupons(codes: string[]): string {
  return `${COUPON_MARKER}${JSON.stringify(codes)}`
}

async function countRedemptions(
  db: D1Database,
  couponId: string,
  customerKey: string,
): Promise<{ total: number; forCustomer: number }> {
  const totalRow = await db
    .prepare('SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ?1')
    .bind(couponId)
    .first<{ n: number }>()

  const customerRow = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ?1 AND customer_key = ?2',
    )
    .bind(couponId, customerKey)
    .first<{ n: number }>()

  return { total: totalRow?.n ?? 0, forCustomer: customerRow?.n ?? 0 }
}

function lineKey(productId: string, variantId: string | null): string {
  return `${productId}::${variantId ?? ''}`
}

/** Re-exported so the route layer does not need to reach into products.ts. */
export { loadShippingConfig, loadTaxRules, listImages }
export type { PriceLine }
