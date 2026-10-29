import type { PriceLine, TaxRule } from '../services/pricing.ts'
import type { ShippingMethod, ShippingZone } from '../services/shipping.ts'
import type { Coupon } from '../services/coupons.ts'

/**
 * PRODUCTS
 * ------------------------------------------------------------------
 * Reads only. No business rules: availability is computed by
 * `services/inventory.ts`, and pricing by `services/pricing.ts`. If a
 * decision appears in this file, it is in the wrong place.
 *
 * Every read is explicit about its columns. `SELECT *` on a table that
 * later gains a column has a habit of leaking that column to an API
 * response, and the adjacency of `SELECT *` to a password hash is a
 * cliché because it happens.
 */

/* ---------------- Row shapes ---------------- */

export interface ProductRow {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  price: number
  currency: string
  minor_unit: number
  sku: string
  category_id: string | null
  glaze: string | null
  year: string | null
  weight_g: number
  requires_shipping: number
  tax_class: string
  status: string
  availability: string
  is_featured: number
  created_at: number
  updated_at: number
}

export interface VariantRow {
  id: string
  product_id: string
  sku: string
  option_name: string
  option_value: string
  price: number
  weight_g: number | null
  position: number
  is_active: number
}

export interface ImageRow {
  id: string
  product_id: string
  r2_key: string | null
  url: string | null
  alt: string
  position: number
}

export interface CategoryRow {
  id: string
  slug: string
  name: string
  description: string
  position: number
}

/* ---------------- Products ---------------- */

export async function listActiveProducts(
  db: D1Database,
  options: {
    categoryId?: string
    glaze?: string
    search?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ rows: ProductRow[]; total: number }> {
  const clauses = [`status = 'active'`]
  const args: unknown[] = []

  if (options.categoryId) {
    args.push(options.categoryId)
    clauses.push(`category_id = ?${args.length}`)
  }

  if (options.glaze) {
    args.push(options.glaze)
    clauses.push(`glaze = ?${args.length}`)
  }

  if (options.search) {
    // LIKE with a leading wildcard will never use an index, which is fine
    // at this catalogue size and would need FTS5 at a larger one.
    const term = `%${options.search.replace(/[%_]/g, '')}%`
    args.push(term)
    const position = args.length
    args.push(term)
    clauses.push(
      `(name LIKE ?${position} OR subtitle LIKE ?${position} OR description LIKE ?${position + 1})`,
    )
  }

  const where = `WHERE ${clauses.join(' AND ')}`

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM products ${where}`)
    .bind(...args)
    .first<{ n: number }>()

  const limit = Math.min(Math.max(options.limit ?? 60, 1), 100)
  const offset = Math.max(options.offset ?? 0, 0)

  const rows = await db
    .prepare(
      `SELECT id, slug, name, subtitle, description, price, currency, minor_unit, sku,
              category_id, glaze, year, weight_g, requires_shipping, tax_class,
              status, availability, is_featured, created_at, updated_at
         FROM products
         ${where}
        ORDER BY is_featured DESC, created_at DESC
        LIMIT ?${args.length + 1} OFFSET ?${args.length + 2}`,
    )
    .bind(...args, limit, offset)
    .all<ProductRow>()

  return { rows: rows.results ?? [], total: totalRow?.n ?? 0 }
}

export async function getProductBySlug(
  db: D1Database,
  slug: string,
): Promise<ProductRow | null> {
  return db
    .prepare(
      `SELECT id, slug, name, subtitle, description, price, currency, minor_unit, sku,
              category_id, glaze, year, weight_g, requires_shipping, tax_class,
              status, availability, is_featured, created_at, updated_at
         FROM products
        WHERE slug = ?1
        LIMIT 1`,
    )
    .bind(slug)
    .first<ProductRow>()
}

export async function getProductById(
  db: D1Database,
  id: string,
): Promise<ProductRow | null> {
  return db
    .prepare(
      `SELECT id, slug, name, subtitle, description, price, currency, minor_unit, sku,
              category_id, glaze, year, weight_g, requires_shipping, tax_class,
              status, availability, is_featured, created_at, updated_at
         FROM products
        WHERE id = ?1
        LIMIT 1`,
    )
    .bind(id)
    .first<ProductRow>()
}

export async function getProductIds(db: D1Database, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return []

  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ')
  const rows = await db
    .prepare(
      `SELECT id, slug, name, subtitle, description, price, currency, minor_unit, sku,
              category_id, glaze, year, weight_g, requires_shipping, tax_class,
              status, availability, is_featured, created_at, updated_at
         FROM products
        WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<ProductRow>()

  return rows.results ?? []
}

/* ---------------- Variants ---------------- */

export async function listVariants(
  db: D1Database,
  productId: string,
): Promise<VariantRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, product_id, sku, option_name, option_value, price, weight_g, position, is_active
         FROM product_variants
        WHERE product_id = ?1 AND is_active = 1
        ORDER BY position`,
    )
    .bind(productId)
    .all<VariantRow>()

  return rows.results ?? []
}

export async function getVariant(db: D1Database, id: string): Promise<VariantRow | null> {
  return db
    .prepare(
      `SELECT id, product_id, sku, option_name, option_value, price, weight_g, position, is_active
         FROM product_variants
        WHERE id = ?1
        LIMIT 1`,
    )
    .bind(id)
    .first<VariantRow>()
}

/** Variants for several products at once, grouped by product id. */
export async function variantsForProducts(
  db: D1Database,
  productIds: string[],
): Promise<Map<string, VariantRow[]>> {
  const out = new Map<string, VariantRow[]>()
  if (productIds.length === 0) return out

  const placeholders = productIds.map((_, i) => `?${i + 1}`).join(', ')
  const rows = await db
    .prepare(
      `SELECT id, product_id, sku, option_name, option_value, price, weight_g, position, is_active
         FROM product_variants
        WHERE product_id IN (${placeholders}) AND is_active = 1
        ORDER BY product_id, position`,
    )
    .bind(...productIds)
    .all<VariantRow>()

  for (const row of rows.results ?? []) {
    const list = out.get(row.product_id) ?? []
    list.push(row)
    out.set(row.product_id, list)
  }

  return out
}

/* ---------------- Images ---------------- */

export async function listImages(
  db: D1Database,
  productId: string,
): Promise<ImageRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, product_id, r2_key, url, alt, position
         FROM product_images
        WHERE product_id = ?1
        ORDER BY position`,
    )
    .bind(productId)
    .all<ImageRow>()

  return rows.results ?? []
}

export async function imagesForProducts(
  db: D1Database,
  productIds: string[],
): Promise<Map<string, ImageRow[]>> {
  const out = new Map<string, ImageRow[]>()
  if (productIds.length === 0) return out

  const placeholders = productIds.map((_, i) => `?${i + 1}`).join(', ')
  const rows = await db
    .prepare(
      `SELECT id, product_id, r2_key, url, alt, position
         FROM product_images
        WHERE product_id IN (${placeholders})
        ORDER BY product_id, position`,
    )
    .bind(...productIds)
    .all<ImageRow>()

  for (const row of rows.results ?? []) {
    const list = out.get(row.product_id) ?? []
    list.push(row)
    out.set(row.product_id, list)
  }

  return out
}

/* ---------------- Categories ---------------- */

export async function listCategories(
  db: D1Database,
): Promise<Array<CategoryRow & { product_count: number }>> {
  const rows = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.position,
              COUNT(p.id) AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
        GROUP BY c.id
        ORDER BY c.position`,
    )
    .all<CategoryRow & { product_count: number }>()

  return rows.results ?? []
}

/* ---------------- Pricing inputs ---------------- */

export interface ShippingConfig {
  zones: ShippingZone[]
  methods: ShippingMethod[]
}

export interface TaxConfig {
  rules: TaxRule[]
}

function parseJsonArray(input: string | null): string[] {
  if (!input) return []
  try {
    const parsed = JSON.parse(input)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    // A malformed JSON column is a data problem, not a reason to 500 the
    // whole catalogue. Treat it as "no restriction" and let the row be
    // fixed in the admin panel.
    return []
  }
}

export async function loadShippingConfig(db: D1Database): Promise<ShippingConfig> {
  const zoneRows = await db
    .prepare(
      `SELECT id, name, countries, regions, postcode_prefixes, position, is_active
         FROM shipping_zones
        WHERE is_active = 1
        ORDER BY position`,
    )
    .all<{
      id: string
      name: string
      countries: string
      regions: string
      postcode_prefixes: string
      position: number
      is_active: number
    }>()

  const methodRows = await db
    .prepare(
      `SELECT id, zone_id, name, rate_type, rate, free_over, min_subtotal,
              delivery_time, position, is_active
         FROM shipping_methods
        WHERE is_active = 1
        ORDER BY position`,
    )
    .all<{
      id: string
      zone_id: string
      name: string
      rate_type: string
      rate: number
      free_over: number | null
      min_subtotal: number
      delivery_time: string
      position: number
      is_active: number
    }>()

  const zones: ShippingZone[] = (zoneRows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    countries: parseJsonArray(row.countries),
    regions: parseJsonArray(row.regions),
    postcodePrefixes: parseJsonArray(row.postcode_prefixes),
    position: row.position,
    isActive: row.is_active === 1,
  }))

  const methods: ShippingMethod[] = (methodRows.results ?? []).map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    name: row.name,
    rateType: (row.rate_type as ShippingMethod['rateType']) ?? 'flat',
    rate: row.rate,
    freeOver: row.free_over,
    minSubtotal: row.min_subtotal,
    deliveryTime: row.delivery_time,
    isActive: row.is_active === 1,
    position: row.position,
  }))

  return { zones, methods }
}

export async function loadTaxRules(db: D1Database): Promise<TaxRule[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, countries, region, tax_class, rate_bp, prices_include_tax,
              rounding, position, is_active
         FROM tax_rules
        WHERE is_active = 1
        ORDER BY position`,
    )
    .all<{
      id: string
      name: string
      countries: string
      region: string | null
      tax_class: string
      rate_bp: number
      prices_include_tax: number
      rounding: string
      position: number
      is_active: number
    }>()

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    countries: parseJsonArray(row.countries),
    region: row.region ?? '',
    taxClass: row.tax_class,
    rateBp: row.rate_bp,
    pricesIncludeTax: row.prices_include_tax === 1,
    rounding: (row.rounding as TaxRule['rounding']) ?? 'round',
    position: row.position,
    isActive: row.is_active === 1,
  }))
}

export async function getCouponByCode(db: D1Database, code: string): Promise<Coupon | null> {
  const row = await db
    .prepare(
      `SELECT id, code, discount_type, amount, currency, minor_unit, min_subtotal,
              starts_at, ends_at, max_redemptions, max_per_customer,
              include_product_ids, include_category_ids, stacking, is_active
         FROM coupons
        WHERE UPPER(code) = UPPER(?1)
        LIMIT 1`,
    )
    .bind(code)
    .first<{
      id: string
      code: string
      discount_type: string
      amount: number
      currency: string
      minor_unit: number
      min_subtotal: number
      starts_at: number | null
      ends_at: number | null
      max_redemptions: number | null
      max_per_customer: number | null
      include_product_ids: string
      include_category_ids: string
      stacking: string
      is_active: number
    }>()

  if (!row) return null

  return {
    id: row.id,
    code: row.code,
    discountType: (row.discount_type as Coupon['discountType']) ?? 'percent',
    amount: row.amount,
    currency: row.currency,
    minSubtotal: row.min_subtotal,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxRedemptions: row.max_redemptions,
    maxPerCustomer: row.max_per_customer,
    includeProductIds: parseJsonArray(row.include_product_ids),
    includeCategoryIds: parseJsonArray(row.include_category_ids),
    stacking: (row.stacking as Coupon['stacking']) ?? 'stackable',
    isActive: row.is_active === 1,
  }
}

/**
 * Build the `PriceLine`s the pricing service consumes.
 *
 * Prices come from the DATABASE, never from the client. A cart line's
 * stored `unit_price` is used only as a fallback when the product has been
 * deleted, which keeps an orphaned line displayable rather than crashing
 * the cart.
 */
export async function priceLinesFor(
  db: D1Database,
  items: { productId: string; variantId: string | null; quantity: number }[],
): Promise<PriceLine[]> {
  if (items.length === 0) return []

  const productIds = [...new Set(items.map((item) => item.productId))]
  const products = await getProductIds(db, productIds)
  const productMap = new Map(products.map((p) => [p.id, p]))

  const variantsByProduct = await variantsForProducts(db, productIds)

  const lines: PriceLine[] = []

  for (const item of items) {
    const product = productMap.get(item.productId)
    if (!product) continue

    const variant = item.variantId
      ? (variantsByProduct.get(item.productId) ?? []).find((v) => v.id === item.variantId)
      : undefined

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      variantLabel: variant ? `${variant.option_name}: ${variant.option_value}` : '',
      sku: variant?.sku || product.sku,
      quantity: item.quantity,
      unitPrice: variant ? variant.price : product.price,
      weightG: variant?.weight_g ?? product.weight_g,
      taxClass: product.tax_class,
      requiresShipping: product.requires_shipping === 1,
      inventoryId: null,
    })
  }

  return lines
}
