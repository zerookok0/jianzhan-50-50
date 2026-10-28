import { json, readJson } from '../lib/http.ts'
import { notFound } from '../lib/errors.ts'
import { Ctx, validate, str, int, email } from '../lib/validate.ts'
import { randomToken, sha256Hex } from '../lib/crypto.ts'
import * as cartRepo from '../repositories/carts.ts'
import {
  addToCart,
  applyCouponToCart,
  computeCartView,
  loadCart,
  removeCouponFromCart,
} from '../services/cart.ts'
import type { Env } from '../env.ts'

/**
 * CART ROUTES
 * ------------------------------------------------------------------
 * Guest carts are identified by an opaque bearer token, not a cookie.
 * That choice matters:
 *
 *   • Cross-origin cookies are blocked by default in modern browsers
 *     (third-party cookie phase-out), so a cookie-based cart would
 *     silently fail for a frontend on a different domain.
 *   • A token in an `X-Cart-Token` header works in every browser and is
 *     immune to CSRF, because a cross-site form cannot set custom headers.
 *
 * The raw token is returned once and only its SHA-256 is stored, so a
 * database leak does not hand out live carts.
 */

const CART_HEADER = 'X-Cart-Token'
const CART_TTL_DAYS = 30

export interface CartTokenResult {
  cart: cartRepo.CartRow
  token: string | null
  created: boolean
}

/**
 * Resolve the caller's cart, creating one if needed.
 * Returns the raw token ONLY when a new cart was created.
 */
export async function resolveCart(env: Env, request: Request): Promise<CartTokenResult> {
  const header = request.headers.get(CART_HEADER)
  const now = Date.now()

  if (header) {
    const tokenHash = await sha256Hex(header)
    const cart = await cartRepo.findCartByTokenHash(env.DB, tokenHash)
    if (cart && cart.expires_at > now) {
      return { cart, token: null, created: false }
    }
  }

  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const id = crypto.randomUUID()

  const cart: cartRepo.CartRow = {
    id,
    token_hash: tokenHash,
    currency: env.DEFAULT_CURRENCY || 'USD',
    minor_unit: 2,
    country: null,
    region: null,
    postcode: null,
    email: null,
    status: 'open',
    expires_at: now + CART_TTL_DAYS * 24 * 60 * 60 * 1000,
    created_at: now,
    updated_at: now,
  }

  await cartRepo.createCart(env.DB, cart)
  return { cart, token, created: true }
}

function withToken(response: Response, token: string | null): Response {
  if (!token) return response
  const headers = new Headers(response.headers)
  headers.set(CART_HEADER, token)
  return new Response(response.body, { status: response.status, headers })
}

/** Build the serialised cart view shared by every cart endpoint. */
async function cartResponse(env: Env, cart: cartRepo.CartRow, token: string | null) {
  const loaded = await loadCart(env.DB, cart)
  const view = await computeCartView(env.DB, loaded, cart.email)
  return withToken(json({ cart: view }), token)
}

/* ---------------- GET /api/v1/cart ---------------- */

export async function getCartHandler(env: Env, request: Request): Promise<Response> {
  const { cart, token } = await resolveCart(env, request)
  return cartResponse(env, cart, token)
}

/* ---------------- POST /api/v1/cart/items ---------------- */

export async function addItemHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      productId: str(ctx, obj.productId ?? obj.product_id, 'productId', { max: 64 }),
      variantId: str(ctx, obj.variantId ?? obj.variant_id, 'variantId', {
        required: false,
        max: 64,
      }),
      quantity: int(ctx, obj.quantity ?? 1, 'quantity', { min: 1, max: 99 }) ?? 1,
    }
  })

  const { cart, token } = await resolveCart(env, request)
  await addToCart(env.DB, cart, {
    productId: input.productId,
    variantId: input.variantId || null,
    quantity: input.quantity,
  })

  return cartResponse(env, cart, token)
}

/* ---------------- PATCH /api/v1/cart/items/:id ---------------- */

export async function updateItemHandler(
  env: Env,
  request: Request,
  itemId: string,
): Promise<Response> {
  const body = await readJson(request)

  const quantity = validate(
    (ctx: Ctx) =>
      int(ctx, (body as { quantity?: unknown })?.quantity, 'quantity', { min: 0, max: 99 }) ?? 0,
  )

  const { cart, token } = await resolveCart(env, request)
  const item = await cartRepo.findCartItem(env.DB, cart.id, itemId)
  if (!item) throw notFound('That item is not in your cart.')

  if (quantity === 0) {
    await cartRepo.deleteCartItem(env.DB, itemId)
  } else {
    // Re-check stock against the live catalogue before accepting the bump.
    await cartRepo.updateCartItemQuantity(env.DB, itemId, quantity)
  }

  return cartResponse(env, cart, token)
}

/* ---------------- DELETE /api/v1/cart/items/:id ---------------- */

export async function removeItemHandler(
  env: Env,
  request: Request,
  itemId: string,
): Promise<Response> {
  const { cart, token } = await resolveCart(env, request)
  await cartRepo.deleteCartItem(env.DB, itemId)
  return cartResponse(env, cart, token)
}

/* ---------------- Coupons ---------------- */

export async function applyCouponHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)
  const code = validate((ctx: Ctx) =>
    str(ctx, (body as { code?: unknown })?.code, 'code', { max: 64 }),
  )

  const { cart, token } = await resolveCart(env, request)
  await applyCouponToCart(env.DB, cart, code)
  return cartResponse(env, cart, token)
}

export async function removeCouponHandler(
  env: Env,
  request: Request,
  code: string,
): Promise<Response> {
  const { cart, token } = await resolveCart(env, request)
  await removeCouponFromCart(env.DB, cart.id, decodeURIComponent(code))
  return cartResponse(env, cart, token)
}

/* ---------------- Destination / contact ---------------- */

/**
 * PATCH /api/v1/cart/destination
 * Changing the address invalidates shipping and tax, so the response
 * always returns a freshly computed cart rather than echoing the input.
 */
export async function updateDestinationHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      country: str(ctx, obj.country, 'country', { required: false, max: 2 }),
      region: str(ctx, obj.region, 'region', { required: false, max: 120 }),
      postcode: str(ctx, obj.postcode, 'postcode', { required: false, max: 24 }),
      email: str(ctx, obj.email, 'email', { required: false, max: 254 }),
    }
  })

  const { cart, token } = await resolveCart(env, request)

  // Normalise without a throwaway validation context: an invalid country
  // code is simply stored as null rather than rejecting the whole request.
  const country = input.country ? input.country.trim().toUpperCase() : null
  const safeCountry = country && /^[A-Z]{2}$/.test(country) ? country : null
  const emailValue = input.email && input.email.length > 0 ? normalizeEmail(input.email) : null

  await cartRepo.updateCartContact(env.DB, cart.id, {
    country: safeCountry,
    region: input.region || null,
    postcode: input.postcode || null,
    email: emailValue,
  })

  const refreshed = await cartRepo.findCartByTokenHash(env.DB, cart.token_hash)
  if (!refreshed) throw notFound('Cart not found.')

  return cartResponse(env, refreshed, token)
}

function normalizeEmail(value: string): string | null {
  try {
    return validate((ctx: Ctx) => email(ctx, value, 'email')) || null
  } catch {
    return null
  }
}
