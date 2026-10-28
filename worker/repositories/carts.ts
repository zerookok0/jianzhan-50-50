/**
 * CART REPOSITORY
 * ------------------------------------------------------------------
 * Cart persistence only. Totals are NOT stored here — they are computed
 * by services/pricing.ts from live product data on every request, so a
 * stale cart row can never produce a wrong price.
 */

export interface CartRow {
  id: string
  token_hash: string
  currency: string
  minor_unit: number
  country: string | null
  region: string | null
  postcode: string | null
  email: string | null
  status: string
  expires_at: number
  created_at: number
  updated_at: number
}

export interface CartItemRow {
  id: string
  cart_id: string
  product_id: string
  variant_id: string | null
  quantity: number
  unit_price: number
  created_at: number
  updated_at: number
}

export async function findCartByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<CartRow | null> {
  return db
    .prepare('SELECT * FROM carts WHERE token_hash = ?1 AND status = ?2')
    .bind(tokenHash, 'open')
    .first<CartRow>()
}

export async function createCart(
  db: D1Database,
  row: Omit<CartRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO carts (id, token_hash, currency, minor_unit, country, region, postcode,
        email, status, expires_at, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
    .bind(
      row.id, row.token_hash, row.currency, row.minor_unit, row.country, row.region,
      row.postcode, row.email, row.status, row.expires_at, now, now,
    )
    .run()
}

export async function listCartItems(db: D1Database, cartId: string): Promise<CartItemRow[]> {
  const res = await db
    .prepare('SELECT * FROM cart_items WHERE cart_id = ?1 ORDER BY created_at')
    .bind(cartId)
    .all<CartItemRow>()
  return res.results ?? []
}

export async function findCartItem(
  db: D1Database,
  cartId: string,
  itemId: string,
): Promise<CartItemRow | null> {
  return db
    .prepare('SELECT * FROM cart_items WHERE cart_id = ?1 AND id = ?2')
    .bind(cartId, itemId)
    .first<CartItemRow>()
}

export async function findCartItemByProduct(
  db: D1Database,
  cartId: string,
  productId: string,
  variantId: string | null,
): Promise<CartItemRow | null> {
  return db
    .prepare(
      `SELECT * FROM cart_items
       WHERE cart_id = ?1 AND product_id = ?2 AND IFNULL(variant_id,'') = ?3`,
    )
    .bind(cartId, productId, variantId ?? '')
    .first<CartItemRow>()
}

export async function insertCartItem(
  db: D1Database,
  row: Omit<CartItemRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, unit_price, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    )
    .bind(row.id, row.cart_id, row.product_id, row.variant_id, row.quantity, row.unit_price, now, now)
    .run()
}

export async function updateCartItemQuantity(
  db: D1Database,
  itemId: string,
  quantity: number,
): Promise<void> {
  await db
    .prepare('UPDATE cart_items SET quantity = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(itemId, quantity, Date.now())
    .run()
}

export async function deleteCartItem(db: D1Database, itemId: string): Promise<void> {
  await db.prepare('DELETE FROM cart_items WHERE id = ?1').bind(itemId).run()
}

export async function updateCartContact(
  db: D1Database,
  cartId: string,
  patch: { country?: string | null; region?: string | null; postcode?: string | null; email?: string | null },
): Promise<void> {
  const fields = Object.keys(patch) as (keyof typeof patch)[]
  if (!fields.length) return
  const sets = fields.map((f, i) => `${f} = ?${i + 2}`).join(', ')
  await db
    .prepare(`UPDATE carts SET ${sets}, updated_at = ?${fields.length + 2} WHERE id = ?1`)
    .bind(cartId, ...fields.map((f) => patch[f] ?? null), Date.now())
    .run()
}

export async function markCartConverted(db: D1Database, cartId: string): Promise<void> {
  await db
    .prepare('UPDATE carts SET status = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(cartId, 'converted', Date.now())
    .run()
}

/** Carts past their TTL are abandoned and their reservations released. */
export async function expireStaleCarts(db: D1Database): Promise<string[]> {
  const now = Date.now()
  const stale = await db
    .prepare('SELECT id FROM carts WHERE status = ?1 AND expires_at < ?2 LIMIT 200')
    .bind('open', now)
    .all<{ id: string }>()

  const ids = (stale.results ?? []).map((r) => r.id)
  if (!ids.length) return []

  const placeholders = ids.map((_, i) => `?${i + 3}`).join(',')
  await db
    .prepare(`UPDATE carts SET status = ?1, updated_at = ?2 WHERE id IN (${placeholders})`)
    .bind('abandoned', now, ...ids)
    .run()

  return ids
}

/* ---------------- Coupons on a cart ---------------- */

export interface AppliedCoupon {
  code: string
  coupon_id: string
}

/**
 * Applied coupons are re-resolved from the coupons table on every read,
 * so an expired or deactivated coupon stops applying immediately.
 * Stored as a join table-free JSON list on the cart for simplicity.
 */
export async function getCartCouponCodes(db: D1Database, cartId: string): Promise<string[]> {
  const row = await db
    .prepare('SELECT coupon_codes FROM cart_coupons WHERE cart_id = ?1')
    .bind(cartId)
    .first<{ coupon_codes: string }>()
  if (!row) return []
  try {
    const parsed = JSON.parse(row.coupon_codes)
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === 'string') : []
  } catch {
    return []
  }
}

export async function setCartCouponCodes(
  db: D1Database,
  cartId: string,
  codes: string[],
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cart_coupons (cart_id, coupon_codes) VALUES (?1, ?2)
       ON CONFLICT(cart_id) DO UPDATE SET coupon_codes = ?2`,
    )
    .bind(cartId, JSON.stringify(codes))
    .run()
}
