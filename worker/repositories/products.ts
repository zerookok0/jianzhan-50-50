/**
 * PRODUCT REPOSITORY
 * ------------------------------------------------------------------
 * Pure D1 access. No pricing decisions, no eligibility rules — those
 * live in services/ so they can be tested without a database.
 */

export interface ProductRow {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  price: number
  currency: string
  minor_unit: number
  sku: string | null
  category_id: string | null
  glaze: string | null
  weight_g: number
  requires_shipping: number
  tax_class: string
  status: string
  is_featured: number
  year: string | null
  availability: string
  created_at: number
  updated_at: number
}

export interface VariantRow {
  id: string
  product_id: string
  sku: string | null
  option_name: string
  option_value: string
  price: number | null
  weight_g: number | null
  position: number
  is_active: number
}

export interface ImageRow {
  id: string
  product_id: string
  r2_key: string | null
  url: string
  alt: string
  position: number
}

export interface InventoryRow {
  id: string
  product_id: string
  variant_id: string | null
  on_hand: number
  reserved: number
  sellable: number
  is_tracked: number
  allow_backorder: number
}

export interface ProductWithRelations extends ProductRow {
  variants: VariantRow[]
  images: ImageRow[]
  /**
   * The product-level inventory row (variant_id IS NULL). Null when the
   * product is stocked entirely per variant.
   */
  inventory: InventoryRow | null
  /**
   * EVERY inventory row for this product, parent and per-variant.
   *
   * This exists because a product with options has one row per option, and
   * a single `inventory` field cannot represent that: reading only the
   * first row silently applied the parent's stock to every variant, which
   * is how a "Large" bowl appeared buyable while its row said zero.
   */
  inventoryRows: InventoryRow[]
}

/** Stock that can actually be bought from one inventory row. */
export function inventoryAvailable(row: InventoryRow | null | undefined): number | null {
  if (!row) return null
  // Untracked means unlimited (made to order) — not zero.
  if (row.is_tracked !== 1) return null
  return Math.max(0, row.on_hand - row.reserved)
}

/**
 * The inventory row that governs a specific option.
 *
 * Falls back to the product-level row when a variant has no row of its
 * own, so a store that tracks stock at product level keeps working. It
 * never falls back the other way: a variant with a row must use it.
 */
export function inventoryRowFor(
  product: ProductWithRelations,
  variantId: string | null,
): InventoryRow | null {
  if (!variantId) return product.inventory ?? null
  const own = product.inventoryRows.find((r) => r.variant_id === variantId)
  return own ?? product.inventory ?? null
}

export interface ListProductsOptions {
  status?: 'active' | 'draft' | 'archived' | 'all'
  categoryId?: string | null
  featured?: boolean
  search?: string
  limit: number
  offset: number
  orderBy?: 'newest' | 'price_asc' | 'price_desc' | 'name'
}

export async function listProducts(
  db: D1Database,
  opts: ListProductsOptions,
): Promise<{ rows: ProductRow[]; total: number }> {
  const where: string[] = []
  const binds: unknown[] = []

  if (opts.status && opts.status !== 'all') {
    where.push('status = ?')
    binds.push(opts.status)
  }
  if (opts.categoryId) {
    where.push('category_id = ?')
    binds.push(opts.categoryId)
  }
  if (opts.featured) {
    where.push('is_featured = 1')
  }
  if (opts.search) {
    where.push('(name LIKE ? OR subtitle LIKE ? OR sku LIKE ?)')
    const like = `%${opts.search}%`
    binds.push(like, like, like)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const orderSql = (() => {
    switch (opts.orderBy) {
      case 'price_asc':
        return 'ORDER BY price ASC, name ASC'
      case 'price_desc':
        return 'ORDER BY price DESC, name ASC'
      case 'name':
        return 'ORDER BY name ASC'
      default:
        return 'ORDER BY is_featured DESC, created_at DESC'
    }
  })()

  const [list, count] = await Promise.all([
    db
      .prepare(`SELECT * FROM products ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...binds, opts.limit, opts.offset)
      .all<ProductRow>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM products ${whereSql}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ])

  return { rows: list.results ?? [], total: count?.n ?? 0 }
}

export async function getProductBySlug(
  db: D1Database,
  slug: string,
): Promise<ProductWithRelations | null> {
  const product = await db
    .prepare('SELECT * FROM products WHERE slug = ?1')
    .bind(slug)
    .first<ProductRow>()
  if (!product) return null
  return hydrate(db, product)
}

export async function getProductById(
  db: D1Database,
  id: string,
): Promise<ProductWithRelations | null> {
  const product = await db
    .prepare('SELECT * FROM products WHERE id = ?1')
    .bind(id)
    .first<ProductRow>()
  if (!product) return null
  return hydrate(db, product)
}

/** Batch-hydrate variants, images and inventory for a set of products. */
export async function hydrateMany(
  db: D1Database,
  rows: ProductRow[],
): Promise<ProductWithRelations[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',')

  const [variants, images, inventory] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY position`,
      )
      .bind(...ids)
      .all<VariantRow>(),
    db
      .prepare(
        `SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY position`,
      )
      .bind(...ids)
      .all<ImageRow>(),
    db
      .prepare(`SELECT * FROM inventory WHERE product_id IN (${placeholders})`)
      .bind(...ids)
      .all<InventoryRow>(),
  ])

  const byProduct = <T extends { product_id: string }>(list: T[]) => {
    const map = new Map<string, T[]>()
    for (const item of list) {
      const arr = map.get(item.product_id) ?? []
      arr.push(item)
      map.set(item.product_id, arr)
    }
    return map
  }

  const vMap = byProduct(variants.results ?? [])
  const iMap = byProduct(images.results ?? [])
  const invMap = byProduct(inventory.results ?? [])

  return rows.map((r) => {
    const invRows = invMap.get(r.id) ?? []
    return {
      ...r,
      variants: vMap.get(r.id) ?? [],
      images: iMap.get(r.id) ?? [],
      // The parent row is the one whose variant_id is NULL.
      inventory: invRows.find((i) => i.variant_id === null) ?? null,
      inventoryRows: invRows,
    }
  })
}

async function hydrate(db: D1Database, product: ProductRow): Promise<ProductWithRelations> {
  const [variants, images, inventory] = await Promise.all([
    db
      .prepare('SELECT * FROM product_variants WHERE product_id = ?1 ORDER BY position')
      .bind(product.id)
      .all<VariantRow>(),
    db
      .prepare('SELECT * FROM product_images WHERE product_id = ?1 ORDER BY position')
      .bind(product.id)
      .all<ImageRow>(),
    db
      .prepare('SELECT * FROM inventory WHERE product_id = ?1')
      .bind(product.id)
      .all<InventoryRow>(),
  ])

  const invRows = inventory.results ?? []

  return {
    ...product,
    variants: variants.results ?? [],
    images: images.results ?? [],
    inventory: invRows.find((i) => i.variant_id === null) ?? null,
    inventoryRows: invRows,
  }
}

/* ---------------- Writes ---------------- */

export async function insertProduct(db: D1Database, row: ProductRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO products (
        id, slug, name, subtitle, description, price, currency, minor_unit, sku,
        category_id, glaze, weight_g, requires_shipping, tax_class, status,
        is_featured, year, availability, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
    )
    .bind(
      row.id, row.slug, row.name, row.subtitle, row.description, row.price,
      row.currency, row.minor_unit, row.sku, row.category_id, row.glaze,
      row.weight_g, row.requires_shipping, row.tax_class, row.status,
      row.is_featured, row.year, row.availability, row.created_at, row.updated_at,
    )
    .run()
}

export async function updateProduct(
  db: D1Database,
  id: string,
  patch: Partial<Omit<ProductRow, 'id' | 'created_at'>>,
): Promise<void> {
  const fields = Object.keys(patch)
  if (!fields.length) return
  const sets = fields.map((f, i) => `${f} = ?${i + 2}`).join(', ')
  await db
    .prepare(`UPDATE products SET ${sets}, updated_at = ?${fields.length + 2} WHERE id = ?1`)
    .bind(id, ...fields.map((f) => (patch as Record<string, unknown>)[f]), Date.now())
    .run()
}

/* ---------------- Categories ---------------- */

export interface CategoryRow {
  id: string
  slug: string
  name: string
  description: string
  position: number
  created_at: number
  updated_at: number
}

export async function listCategories(db: D1Database): Promise<CategoryRow[]> {
  const res = await db.prepare('SELECT * FROM categories ORDER BY position, name').all<CategoryRow>()
  return res.results ?? []
}

export async function getCategoryBySlug(
  db: D1Database,
  slug: string,
): Promise<CategoryRow | null> {
  return db.prepare('SELECT * FROM categories WHERE slug = ?1').bind(slug).first<CategoryRow>()
}
