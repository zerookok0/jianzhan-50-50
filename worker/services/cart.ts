import { multiplyMoney, clampNonNegative, minorUnitFor } from '../lib/money.ts'
import { couponInvalid, notFound, outOfStock } from '../lib/errors.ts'
import * as cartRepo from '../repositories/carts.ts'
import * as productRepo from '../repositories/products.ts'
import type { CouponRule } from './coupons.ts'
import { evaluateCoupons } from './coupons.ts'
import {
  allocateDiscount,
  computeTotals,
  lineKey,
  totalWeight,
  type ComputedTotals,
  type DiscountAllocation,
  type PricedLine,
  type TaxRule,
} from './pricing.ts'
import { quoteShipping, selectQuote, type ShippingMethodRule, type ShippingQuote, type ShippingZoneRule } from './shipping.ts'
import { getAvailability } from './inventory.ts'

/**
 * CART SERVICE
 * ------------------------------------------------------------------
 * Orchestrates everything a cart needs: loading rows from D1, re-reading
 * live prices, evaluating coupons, pricing shipping and tax, and
 * recalculating totals on every call.
 *
 * The critical invariant: NOTHING the client sends is trusted for money.
 * Quantities and product ids are inputs; prices, stock, discounts, tax and
 * shipping are all derived here from the database.
 */

export interface CartLineView {
  itemId: string
  productId: string
  variantId: string | null
  slug: string
  name: string
  variantLabel: string
  sku: string
  imageUrl: string | null
  quantity: number
  unitPrice: number
  lineSubtotal: number
  maxQuantity: number | null
  inStock: boolean
  available: number | null
  requiresShipping: boolean
}

export interface CartView {
  cartId: string
  currency: string
  minorUnit: number
  items: CartLineView[]
  itemCount: number
  totals: ComputedTotals
  coupons: {
    code: string
    accepted: boolean
    discount: number
    message?: string
  }[]
  shipping: {
    available: boolean
    reason?: string
    selected: ShippingQuote | null
    options: ShippingQuote[]
  }
  needsShipping: boolean
  destination: { country: string | null; region: string | null; postcode: string | null }
  warnings: string[]
}

export interface LoadedCart {
  row: cartRepo.CartRow
  lines: cartRepo.CartItemRow[]
  priced: PricedLine[]
  views: CartLineView[]
  coupons: CouponRule[]
  couponCodes: string[]
  taxRules: TaxRule[]
  zones: ShippingZoneRule[]
  methods: ShippingMethodRule[]
  selectedShippingId: string | null
}

/* ---------------- Loading ---------------- */

export async function loadCart(
  db: D1Database,
  cart: cartRepo.CartRow,
  opts: { selectedShippingId?: string | null } = {},
): Promise<LoadedCart> {
  const lines = await cartRepo.listCartItems(db, cart.id)
  const couponCodes = await cartRepo.getCartCouponCodes(db, cart.id)

  // Re-read products so a price change since the item was added is respected.
  const productIds = [...new Set(lines.map((l) => l.product_id))]
  const products = await Promise.all(
    productIds.map((id) => productRepo.getProductById(db, id)),
  )
  const byId = new Map(
    products.filter((p): p is productRepo.ProductWithRelations => p !== null).map((p) => [p.id, p]),
  )

  const views: CartLineView[] = []
  const priced: PricedLine[] = []
  const warnings: string[] = []

  const inventoryIds = [...new Set(
    products
      .filter((p): p is productRepo.ProductWithRelations => p !== null && p.inventory !== null)
      .map((p) => p.inventory!.id),
  )]
  const availability = await getAvailability(db, inventoryIds)

  for (const line of lines) {
    const product = byId.get(line.product_id)
    if (!product) {
      warnings.push('An item in your cart is no longer available and has been removed.')
      continue
    }
    if (product.status !== 'active') {
      warnings.push(`“${product.name}” is no longer for sale.`)
      continue
    }

    const variant = line.variant_id
      ? product.variants.find((v) => v.id === line.variant_id)
      : null

    if (line.variant_id && !variant) {
      warnings.push(`A selected option for “${product.name}” is no longer available.`)
      continue
    }

    // Live price wins over whatever was stored on the row.
    const unitPrice = variant?.price ?? product.price
    const weightG = (variant?.weight_g ?? product.weight_g) || 0
    const label = variant ? `${variant.option_name}: ${variant.option_value}` : ''
    const sku = variant?.sku ?? product.sku ?? ''

    const inv = availability.get(product.inventory?.id ?? '')
    const available = inv?.tracked ? inv.available : null
    const inStock = available === null ? true : available >= line.quantity

    const image = product.images[0]

    views.push({
      itemId: line.id,
      productId: product.id,
      variantId: line.variant_id,
      slug: product.slug,
      name: product.name,
      variantLabel: label,
      sku,
      imageUrl: image?.url ?? null,
      quantity: line.quantity,
      unitPrice,
      lineSubtotal: multiplyMoney(unitPrice, line.quantity),
      maxQuantity: available,
      inStock,
      available,
      requiresShipping: product.requires_shipping === 1,
    })

    priced.push({
      productId: product.id,
      variantId: line.variant_id,
      name: product.name,
      variantLabel: label,
      sku,
      quantity: line.quantity,
      unitPrice,
      weightG,
      taxClass: product.tax_class,
      requiresShipping: product.requires_shipping === 1,
    })

    if (!inStock) {
      warnings.push(
        available === 0
          ? `“${product.name}” is sold out.`
          : `Only ${available} of “${product.name}” remain — adjust the quantity.`,
      )
    }
  }

  // Coupons and rules
  const coupons = await loadCoupons(db, couponCodes)
  const taxRules = await loadTaxRules(db)
  const zones = await loadShippingZones(db)
  const methods = await loadShippingMethods(db)

  return {
    row: cart,
    lines,
    priced,
    views,
    coupons,
    couponCodes,
    taxRules,
    zones,
    methods,
    selectedShippingId: opts.selectedShippingId ?? null,
  }
}

/* ---------------- Computation ---------------- */

export async function computeCartView(
  db: D1Database,
  loaded: LoadedCart,
  customerEmail: string | null,
): Promise<CartView> {
  const { row, priced, views } = loaded

  const subtotal = priced.reduce((s, l) => s + multiplyMoney(l.unitPrice, l.quantity), 0)

  /* ---- Coupons ---- */

  const couponResults = await Promise.all(
    loaded.coupons.map(async (c) => {
      const totals = await db
        .prepare('SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ?1')
        .bind(c.id)
        .first<{ n: number }>()

      const perCustomer = customerEmail
        ? await db
            .prepare(
              'SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ?1 AND email = ?2',
            )
            .bind(c.id, customerEmail.toLowerCase())
            .first<{ n: number }>()
        : { n: 0 }

      return { coupon: c, redemptionsTotal: totals?.n ?? 0, redemptionsByCustomer: perCustomer?.n ?? 0 }
    }),
  )

  const categoryByProduct = new Map<string, string | null>()
  for (const p of priced) {
    const row = await db
      .prepare('SELECT category_id FROM products WHERE id = ?1')
      .bind(p.productId)
      .first<{ category_id: string | null }>()
    categoryByProduct.set(p.productId, row?.category_id ?? null)
  }

  const ctxLines = priced.map((p) => ({
    productId: p.productId,
    categoryId: categoryByProduct.get(p.productId) ?? null,
    subtotal: multiplyMoney(p.unitPrice, p.quantity),
  }))

  // Evaluate together so stacking rules apply against the real set.
  const firstPass = evaluateCoupons(
    couponResults.map((r) => r.coupon),
    {
      now: Date.now(),
      subtotal,
      lines: ctxLines,
      redemptionsTotal: 0,
      redemptionsByCustomer: 0,
      currency: row.currency,
    },
  )

  // Re-evaluate with per-coupon redemption counts, since the batch call
  // above cannot carry different counts per coupon.
  const accepted: { code: string; discount: number; allocation: DiscountAllocation }[] = []
  const couponViews: CartView['coupons'] = []

  for (const { coupon } of firstPass.accepted) {
    const counts = couponResults.find((r) => r.coupon.id === coupon.id)!
    const result = evaluateCoupons([coupon], {
      now: Date.now(),
      subtotal,
      lines: ctxLines,
      redemptionsTotal: counts.redemptionsTotal,
      redemptionsByCustomer: counts.redemptionsByCustomer,
      currency: row.currency,
    })

    if (result.accepted.length) {
      const amount = result.accepted[0].result.discount
      const allocation = allocateDiscount(priced, amount, coupon.code)
      accepted.push({ code: coupon.code, discount: amount, allocation })
      couponViews.push({ code: coupon.code, accepted: true, discount: amount })
    } else {
      const rejection = result.rejected[0]?.result
      couponViews.push({
        code: coupon.code,
        accepted: false,
        discount: 0,
        message: rejection?.message ?? 'This code cannot be applied.',
      })
    }
  }

  for (const { coupon, result } of firstPass.rejected) {
    if (!couponViews.some((c) => c.code === coupon.code)) {
      couponViews.push({
        code: coupon.code,
        accepted: false,
        discount: 0,
        message: result.message,
      })
    }
  }

  /* ---- Shipping ---- */

  const needsShipping = priced.some((l) => l.requiresShipping)
  const discountedSubtotal = clampNonNegative(
    subtotal - accepted.reduce((s, a) => s + a.discount, 0),
  )

  const shippingResult = quoteShipping({
    zones: loaded.zones,
    methods: loaded.methods,
    request: {
      country: row.country,
      region: row.region,
      postcode: row.postcode,
      subtotal: discountedSubtotal,
      weightG: totalWeight(priced),
      needsShipping,
    },
  })

  const requested = loaded.selectedShippingId
  const selected = selectQuote(shippingResult.quotes, requested)

  /* ---- Totals ---- */

  const totals = computeTotals({
    lines: priced,
    discounts: accepted.map((a) => a.allocation),
    shipping: selected
      ? {
          methodId: selected.methodId,
          name: selected.name,
          amount: selected.amount,
          taxClass: 'shipping',
        }
      : null,
    taxRules: loaded.taxRules,
    destination: { country: row.country, region: row.region },
  })

  return {
    cartId: row.id,
    currency: row.currency,
    minorUnit: row.minor_unit ?? minorUnitFor(row.currency),
    items: views,
    itemCount: views.reduce((s, v) => s + v.quantity, 0),
    totals,
    coupons: couponViews,
    shipping: {
      available: shippingResult.available,
      reason: shippingResult.reason,
      selected,
      options: shippingResult.quotes,
    },
    needsShipping,
    destination: { country: row.country, region: row.region, postcode: row.postcode },
    warnings: [],
  }
}

/* ---------------- Rule loaders ---------------- */

async function loadCoupons(db: D1Database, codes: string[]): Promise<CouponRule[]> {
  if (!codes.length) return []
  const placeholders = codes.map((_, i) => `?${i + 1}`).join(',')
  const res = await db
    .prepare(`SELECT * FROM coupons WHERE UPPER(code) IN (${placeholders}) AND is_active = 1`)
    .bind(...codes.map((c) => c.toUpperCase()))
    .all<{
      id: string
      code: string
      discount_type: 'percent' | 'fixed'
      amount: number
      currency: string
      min_subtotal: number
      starts_at: number | null
      ends_at: number | null
      max_redemptions: number | null
      max_per_customer: number | null
      include_product_ids: string
      include_category_ids: string
      stacking: 'stackable' | 'exclusive'
      is_active: number
    }>()

  return (res.results ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    discountType: r.discount_type,
    amount: r.amount,
    currency: r.currency,
    minSubtotal: r.min_subtotal,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    maxRedemptions: r.max_redemptions,
    maxPerCustomer: r.max_per_customer,
    includeProductIds: parseIdList(r.include_product_ids),
    includeCategoryIds: parseIdList(r.include_category_ids),
    stacking: r.stacking,
    isActive: r.is_active === 1,
  }))
}

function parseIdList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

export async function loadTaxRules(db: D1Database): Promise<TaxRule[]> {
  const res = await db
    .prepare('SELECT * FROM tax_rules WHERE is_active = 1 ORDER BY position')
    .all<{
      id: string
      name: string
      countries: string
      region: string
      tax_class: string
      rate_bp: number
      prices_include_tax: number
      rounding: 'round' | 'floor' | 'ceil'
      position: number
      is_active: number
    }>()

  return (res.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    countries: parseIdList(r.countries),
    region: r.region,
    taxClass: r.tax_class,
    rateBp: r.rate_bp,
    pricesIncludeTax: r.prices_include_tax === 1,
    rounding: r.rounding,
    position: r.position,
    isActive: r.is_active === 1,
  }))
}

export async function loadShippingZones(db: D1Database): Promise<ShippingZoneRule[]> {
  const res = await db
    .prepare('SELECT * FROM shipping_zones WHERE is_active = 1 ORDER BY position')
    .all<{
      id: string
      name: string
      countries: string
      regions: string
      postcode_prefixes: string
      position: number
      is_active: number
    }>()

  return (res.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    countries: parseIdList(r.countries),
    regions: parseIdList(r.regions),
    postcodePrefixes: parseIdList(r.postcode_prefixes),
    position: r.position,
    isActive: r.is_active === 1,
  }))
}

export async function loadShippingMethods(db: D1Database): Promise<ShippingMethodRule[]> {
  const res = await db
    .prepare('SELECT * FROM shipping_methods WHERE is_active = 1 ORDER BY position')
    .all<{
      id: string
      zone_id: string
      name: string
      rate_type: 'flat' | 'weight' | 'subtotal'
      rate: number
      free_over: number | null
      min_subtotal: number
      delivery_time: string
      is_active: number
      position: number
    }>()

  return (res.results ?? []).map((r) => ({
    id: r.id,
    zoneId: r.zone_id,
    name: r.name,
    rateType: r.rate_type,
    rate: r.rate,
    freeOver: r.free_over,
    minSubtotal: r.min_subtotal,
    deliveryTime: r.delivery_time,
    isActive: r.is_active === 1,
    position: r.position,
  }))
}

/* ---------------- Cart mutations ---------------- */

export async function addToCart(
  db: D1Database,
  cart: cartRepo.CartRow,
  args: { productId: string; variantId: string | null; quantity: number },
): Promise<void> {
  const product = await productRepo.getProductById(db, args.productId)
  if (!product) throw notFound('That piece could not be found.')
  if (product.status !== 'active') throw outOfStock(`“${product.name}” is not for sale.`)

  if (args.variantId) {
    const variant = product.variants.find((v) => v.id === args.variantId && v.is_active === 1)
    if (!variant) throw notFound('That option is no longer available.')
  }

  const existing = await cartRepo.findCartItemByProduct(
    db,
    cart.id,
    args.productId,
    args.variantId,
  )

  const desired = (existing?.quantity ?? 0) + args.quantity

  // Stock check before writing, so the cart never holds an impossible line.
  if (product.inventory) {
    const avail = await getAvailability(db, [product.inventory.id])
    const info = avail.get(product.inventory.id)
    if (info?.tracked && desired > info.available) {
      throw outOfStock(
        info.available === 0
          ? `“${product.name}” is sold out.`
          : `Only ${info.available} of “${product.name}” remain.`,
        { available: info.available, requested: desired },
      )
    }
  }

  const unitPrice = args.variantId
    ? (product.variants.find((v) => v.id === args.variantId)?.price ?? product.price)
    : product.price

  if (existing) {
    await cartRepo.updateCartItemQuantity(db, existing.id, desired)
  } else {
    await cartRepo.insertCartItem(db, {
      id: crypto.randomUUID(),
      cart_id: cart.id,
      product_id: args.productId,
      variant_id: args.variantId,
      quantity: args.quantity,
      unit_price: unitPrice,
    })
  }
}

export async function applyCouponToCart(
  db: D1Database,
  cart: cartRepo.CartRow,
  code: string,
): Promise<string[]> {
  const normalized = code.trim().toUpperCase()
  const existing = await cartRepo.getCartCouponCodes(db, cart.id)
  if (existing.includes(normalized)) return existing

  const coupon = await db
    .prepare('SELECT * FROM coupons WHERE UPPER(code) = ?1 AND is_active = 1')
    .bind(normalized)
    .first<{ code: string }>()

  if (!coupon) throw couponInvalid('That discount code is not valid.')

  const next = [...existing, normalized]
  await cartRepo.setCartCouponCodes(db, cart.id, next)
  return next
}

export async function removeCouponFromCart(
  db: D1Database,
  cartId: string,
  code: string,
): Promise<string[]> {
  const existing = await cartRepo.getCartCouponCodes(db, cartId)
  const next = existing.filter((c) => c.toUpperCase() !== code.trim().toUpperCase())
  await cartRepo.setCartCouponCodes(db, cartId, next)
  return next
}

export { lineKey }
