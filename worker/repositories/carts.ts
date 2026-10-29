import { sha256Hex, randomToken } from '../lib/crypto.ts'

/**
 * CARTS
 * ------------------------------------------------------------------
 * Storage only. What a cart *means* — pricing, eligibility, whether a line
 * may be added — lives in `services/cart.ts`.
 *
 * TOKEN HANDLING
 * The browser gets a raw token. The database stores only its SHA-256 hash.
 * A dump of `carts` therefore contains no usable session, and the lookup
 * is a hash equality rather than a scan.
 */

export interface CartRow {
  id: string
  token_hash: string
  currency: string
  minor_unit: number
  email: string | null
  country: string | null
  region: string | null
  postcode: string | null
  /** Applied discount codes as a JSON array, e.g. `["WELCOME10"]`. */
  coupons_json: string
  status: string
  converted_order_id: string | null
  created_at: number
  updated_at: number
  expires_at: number
}

export interface CartItemRow {
  id: string
  cart_id: string
  product_id: string
  variant_id: string | null
  quantity: number
  unit_price: number
  unit_price_currency: string
  created_at: number
  updated_at: number
}

const CART_COLUMNS = `id, token_hash, currency, minor_unit, email, country, region, postcode,
              coupons_json, status, converted_order_id, created_at, updated_at, expires_at`

const ITEM_COLUMNS = `id, cart_id, product_id, variant_id, quantity, unit_price,
              unit_price_currency, created_at, updated_at`

/* ---------------- Lookup ---------------- */

export async function findCartByToken(
  db: D1Database,
  token: string,
): Promise<CartRow | null> {
  const hash = await sha256Hex(token)

  const row = await db
    .prepare(
      `SELECT ${CART_COLUMNS}
         FROM carts
        WHERE token_hash = ?1 AND status = 'active'
        LIMIT 1`,
    )
    .bind(hash)
    .first<CartRow>()

  // An expired cart is not an error — it is simply absent. The caller starts
  // a new one, and the customer sees an empty cart rather than a wall.
  if (!row || row.expires_at < Date.now()) return null

  return row
}

export async function getCartById(db: D1Database, id: string): Promise<CartRow | null> {
  return db
    .prepare(`SELECT ${CART_COLUMNS} FROM carts WHERE id = ?1 LIMIT 1`)
    .bind(id)
    .first<CartRow>()
}

/* ---------------- Creation ---------------- */

export async function createCart(
  db: D1Database,
  options: { currency: string; minorUnit: number; ttlDays: number },
): Promise<{ cart: CartRow; token: string }> {
  const token = randomToken(32)
  const hash = await sha256Hex(token)
  const now = Date.now()

  const cart: CartRow = {
    id: crypto.randomUUID(),
    token_hash: hash,
    currency: options.currency,
    minor_unit: options.minorUnit,
    email: null,
    country: null,
    region: null,
    postcode: null,
    coupons_json: '[]',
    status: 'active',
    converted_order_id: null,
    created_at: now,
    updated_at: now,
    expires_at: now + options.ttlDays * 24 * 60 * 60 * 1000,
  }

  await db
    .prepare(
      `INSERT INTO carts
         (id, token_hash, currency, minor_unit, email, country, region, postcode,
          coupons_json, status, converted_order_id, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, '[]', 'active', NULL, ?5, ?6, ?7)`,
    )
    .bind(
      cart.id,
      cart.token_hash,
      cart.currency,
      cart.minor_unit,
      cart.created_at,
      cart.updated_at,
      cart.expires_at,
    )
    .run()

  return { cart, token }
}

/* ---------------- Items ---------------- */

export async function listCartItems(
  db: D1Database,
  cartId: string,
): Promise<CartItemRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS}
         FROM cart_items
        WHERE cart_id = ?1
        ORDER BY created_at`,
    )
    .bind(cartId)
    .all<CartItemRow>()

  return rows.results ?? []
}

export async function findCartItem(
  db: D1Database,
  cartId: string,
  productId: string,
  variantId: string | null,
): Promise<CartItemRow | null> {
  return db
    .prepare(
      `SELECT ${ITEM_COLUMNS}
         FROM cart_items
        WHERE cart_id = ?1 AND product_id = ?2
          AND ((?3 IS NULL AND variant_id IS NULL) OR variant_id = ?3)
        LIMIT 1`,
    )
    .bind(cartId, productId, variantId)
    .first<CartItemRow>()
}

export async function getCartItem(
  db: D1Database,
  itemId: string,
): Promise<CartItemRow | null> {
  return db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM cart_items WHERE id = ?1 LIMIT 1`)
    .bind(itemId)
    .first<CartItemRow>()
}

export async function insertCartItem(
  db: D1Database,
  input: {
    cartId: string
    productId: string
    variantId: string | null
    quantity: number
    unitPrice: number
    currency: string
  },
): Promise<CartItemRow> {
  const now = Date.now()
  const row: CartItemRow = {
    id: crypto.randomUUID(),
    cart_id: input.cartId,
    product_id: input.productId,
    variant_id: input.variantId,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    unit_price_currency: input.currency,
    created_at: now,
    updated_at: now,
  }

  await db
    .prepare(
      `INSERT INTO cart_items
         (id, cart_id, product_id, variant_id, quantity, unit_price, unit_price_currency,
          created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      row.id,
      row.cart_id,
      row.product_id,
      row.variant_id,
      row.quantity,
      row.unit_price,
      row.unit_price_currency,
      row.created_at,
      row.updated_at,
    )
    .run()

  return row
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

export async function clearCartItems(db: D1Database, cartId: string): Promise<void> {
  await db.prepare('DELETE FROM cart_items WHERE cart_id = ?1').bind(cartId).run()
}

/* ---------------- Cart fields ---------------- */

/**
 * Update the destination. Undefined fields are left untouched, so the
 * checkout can send only the country without wiping a postcode that was
 * already entered.
 */
export async function updateCartDestination(
  db: D1Database,
  cartId: string,
  input: {
    country?: string | null
    region?: string | null
    postcode?: string | null
    email?: string | null
  },
): Promise<void> {
  const current = await db
    .prepare('SELECT country, region, postcode, email FROM carts WHERE id = ?1')
    .bind(cartId)
    .first<{
      country: string | null
      region: string | null
      postcode: string | null
      email: string | null
    }>()

  const next = {
    country: input.country === undefined ? (current?.country ?? null) : input.country,
    region: input.region === undefined ? (current?.region ?? null) : input.region,
    postcode: input.postcode === undefined ? (current?.postcode ?? null) : input.postcode,
    email: input.email === undefined ? (current?.email ?? null) : input.email,
  }

  await db
    .prepare(
      `UPDATE carts
          SET country = ?2, region = ?3, postcode = ?4, email = ?5, updated_at = ?6
        WHERE id = ?1`,
    )
    .bind(cartId, next.country, next.region, next.postcode, next.email, Date.now())
    .run()
}

export async function updateCartCoupons(
  db: D1Database,
  cartId: string,
  codes: string[],
): Promise<void> {
  await db
    .prepare('UPDATE carts SET coupons_json = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(cartId, JSON.stringify(codes), Date.now())
    .run()
}

/** The applied codes, tolerating a malformed column rather than throwing. */
export function parseCoupons(cart: CartRow): string[] {
  try {
    const parsed = JSON.parse(cart.coupons_json || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function markCartConverted(
  db: D1Database,
  cartId: string,
  orderId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE carts SET status = 'converted', converted_order_id = ?2, updated_at = ?3
        WHERE id = ?1`,
    )
    .bind(cartId, orderId, Date.now())
    .run()
}

export async function touchCart(db: D1Database, cartId: string, ttlDays: number): Promise<void> {
  const now = Date.now()
  await db
    .prepare('UPDATE carts SET updated_at = ?2, expires_at = ?3 WHERE id = ?1')
    .bind(cartId, now, now + ttlDays * 24 * 60 * 60 * 1000)
    .run()
}

/**
 * Expire stale carts. Called from the cron.
 *
 * Marked `abandoned` rather than deleted: an abandoned cart is the most
 * useful marketing signal a small shop has, and deleting it throws that
 * away for the sake of a clean table.
 */
export async function expireStaleCarts(db: D1Database): Promise<string[]> {
  const stale = await db
    .prepare(
      `SELECT id FROM carts
        WHERE status = 'active' AND expires_at < ?1
        LIMIT 500`,
    )
    .bind(Date.now())
    .all<{ id: string }>()

  const ids = (stale.results ?? []).map((row) => row.id)
  if (ids.length === 0) return []

  // Bound placeholders rather than string interpolation: the ids come from
  // the database here, but the habit is what keeps the next call site safe.
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ')
  await db
    .prepare(`UPDATE carts SET status = 'abandoned' WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run()

  return ids
}
