import { apiUrl, store } from '../../config/store'

/**
 * API CLIENT
 * ------------------------------------------------------------------
 * The single place the storefront talks to the Worker.
 *
 * THREE RULES THIS FILE ENFORCES
 *
 *   1. The cart token lives in localStorage and travels in `X-Cart-Token`.
 *      The server mints it on the first cart request and returns it in the
 *      same header; it is never invented on the client, because a made-up
 *      token would silently create a new empty cart on every call.
 *
 *   2. Money is never computed here. Every amount is an integer in minor
 *      units, exactly as the server sent it. `formatMinor` converts to a
 *      display string and nothing else.
 *
 *   3. Failure is typed. `ApiError` carries the server's error code and
 *      HTTP status, so a caller can tell "out of stock" from "the network
 *      is down" without parsing an English sentence.
 */

/* ================================================================== */
/* Errors                                                              */
/* ================================================================== */

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'out_of_stock'
  | 'cart_expired'
  | 'coupon_invalid'
  | 'coupon_exhausted'
  | 'shipping_unavailable'
  | 'payment_unconfigured'
  | 'payment_failed'
  | 'rate_limited'
  | 'internal'
  | 'not_implemented'
  /** Not a server code: the request never reached the Worker. */
  | 'network'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/* ================================================================== */
/* Cart token                                                          */
/* ================================================================== */

const TOKEN_KEY = 'jianzhan:cart-token:v1'

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private mode / storage disabled: the cart works for this page view
    // only. The server will mint a fresh token per request, which is a
    // degraded but coherent experience.
    return null
  }
}

function writeToken(token: string | null): void {
  try {
    if (!token) window.localStorage.removeItem(TOKEN_KEY)
    else window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* storage unavailable — see readToken */
  }
}

/** Forget the cart session. Used when the server says it expired. */
export function clearCartToken(): void {
  writeToken(null)
}

/* ================================================================== */
/* Transport                                                           */
/* ================================================================== */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Sent as `Idempotency-Key`; checkout relies on it. */
  idempotencyKey?: string
  signal?: AbortSignal
}

const TIMEOUT_MS = 20_000

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = readToken()
  if (token) headers['X-Cart-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  // A request that hangs forever is worse than one that fails: the user is
  // left on a spinner with no explanation. Abort and report it.
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal,
    })
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError'
    throw new ApiError(
      0,
      'network',
      aborted
        ? 'The store did not respond in time. Please try again.'
        : 'The store could not be reached. Check your connection and try again.',
    )
  } finally {
    window.clearTimeout(timeout)
  }

  // The server issues or rotates the cart token on any cart-shaped call.
  const issued = response.headers.get('X-Cart-Token')
  if (issued) writeToken(issued)

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const envelope = payload as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | null

    const code = (envelope?.error?.code as ApiErrorCode) ?? 'internal'
    const message =
      envelope?.error?.message ??
      // A 5xx with an HTML body is usually a proxy error, not our Worker.
      (response.status >= 500
        ? 'The store is temporarily unavailable. Please try again shortly.'
        : `Request failed (${response.status}).`)

    // An expired cart is recoverable: drop the token so the next call
    // starts clean rather than resending a dead one forever.
    if (code === 'cart_expired') writeToken(null)

    throw new ApiError(response.status, code, message, envelope?.error?.details)
  }

  return (payload ?? {}) as T
}

/* ================================================================== */
/* Catalogue                                                           */
/* ================================================================== */

export interface ApiProductImage {
  url: string
  alt: string
  position: number
}

export interface ApiVariant {
  id: string
  optionName: string
  optionValue: string
  /** Minor units. */
  price: number
  available: number | null
  inStock: boolean
}

export interface ApiProduct {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  /** Minor units — the parent price. */
  price: number
  currency: string
  minorUnit: number
  sku: string
  categoryId: string | null
  glaze: string | null
  year: string | null
  weightG: number
  isFeatured: boolean
  availability: string
  inStock: boolean
  available: number | null
  images: ApiProductImage[]
  variants: ApiVariant[]
}

export interface ApiCategory {
  id: string
  slug: string
  name: string
  description: string
  productCount: number
}

export interface ProductListResult {
  products: ApiProduct[]
  total: number
  page: number
  perPage: number
}

export async function listProducts(
  params: { page?: number; perPage?: number; category?: string; glaze?: string; search?: string } = {},
): Promise<ProductListResult> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.perPage) query.set('perPage', String(params.perPage))
  if (params.category) query.set('category', params.category)
  if (params.glaze) query.set('glaze', params.glaze)
  if (params.search) query.set('search', params.search)

  const suffix = query.toString() ? `?${query}` : ''
  return request<ProductListResult>(`/products${suffix}`)
}

export async function getProduct(slug: string): Promise<{ product: ApiProduct }> {
  return request<{ product: ApiProduct }>(`/products/${encodeURIComponent(slug)}`)
}

export async function listCategories(): Promise<{ categories: ApiCategory[] }> {
  return request<{ categories: ApiCategory[] }>('/categories')
}

/* ================================================================== */
/* Cart                                                                */
/* ================================================================== */

export interface ApiCartItem {
  itemId: string
  productId: string
  variantId: string | null
  name: string
  variantLabel: string
  sku: string
  quantity: number
  /** Minor units, per unit. */
  unitPrice: number
  /** Minor units, unitPrice × quantity. */
  lineSubtotal: number
  imageUrl: string | null
  inStock: boolean
  available: number | null
  slug: string
}

export interface ApiCartDiscount {
  code: string
  label: string
  /** Minor units. */
  amount: number
}

export interface ApiShippingOption {
  methodId: string
  name: string
  /** Minor units. */
  amount: number
  deliveryTime: string
  freeApplied: boolean
}

export interface ApiCartTotals {
  subtotal: number
  discountTotal: number
  discountedSubtotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
}

export interface ApiCart {
  currency: string
  minorUnit: number
  itemCount: number
  items: ApiCartItem[]
  totals: ApiCartTotals
  discounts: ApiCartDiscount[]
  coupons: string[]
  needsShipping: boolean
  destination: {
    country: string | null
    region: string | null
    postcode: string | null
  }
  shipping: {
    available: boolean
    reason: string | null
    options: ApiShippingOption[]
    selected: ApiShippingOption | null
  }
  tax: {
    /** Display string from the server, e.g. "UK VAT (20%)". */
    label: string | null
    rateBp: number
    includedInPrices: boolean
  }
}

interface CartEnvelope {
  cart: ApiCart
}

export async function getCart(): Promise<CartEnvelope> {
  return request<CartEnvelope>('/cart')
}

export async function addCartItem(input: {
  productId: string
  variantId?: string | null
  quantity?: number
}): Promise<CartEnvelope> {
  return request<CartEnvelope>('/cart/items', {
    method: 'POST',
    body: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      quantity: input.quantity ?? 1,
    },
  })
}

export async function updateCartItem(itemId: string, quantity: number): Promise<CartEnvelope> {
  return request<CartEnvelope>(`/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: { quantity },
  })
}

export async function removeCartItem(itemId: string): Promise<CartEnvelope> {
  return request<CartEnvelope>(`/cart/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

export async function applyCoupon(code: string): Promise<CartEnvelope> {
  return request<CartEnvelope>('/cart/coupons', { method: 'POST', body: { code } })
}

export async function removeCoupon(code: string): Promise<CartEnvelope> {
  return request<CartEnvelope>(`/cart/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function updateDestination(input: {
  country?: string
  region?: string
  postcode?: string
  email?: string
}): Promise<CartEnvelope> {
  return request<CartEnvelope>('/cart/destination', { method: 'PATCH', body: input })
}

/* ================================================================== */
/* Checkout & orders                                                   */
/* ================================================================== */

export interface ApiAddress {
  firstName: string
  lastName: string
  company: string
  line1: string
  line2: string
  city: string
  region: string
  postcode: string
  country: string
  phone: string
}

export interface CheckoutPayload {
  email: string
  phone?: string
  billingAddress: ApiAddress
  shippingSameAsBilling: boolean
  shippingAddress?: ApiAddress
  shippingMethodId?: string
  customerNote?: string
}

export interface ApiPaymentAttempt {
  provider: string
  status: string
  /** Minor units. */
  amount: number
  createdAt: string
}

export interface ApiOrderItem {
  name: string
  variantLabel: string
  sku: string
  quantity: number
  /** Minor units. */
  unitPrice: number
  /** Minor units. */
  lineTotal: number
}

export interface ApiOrder {
  reference: string
  /** pending | paid | failed | cancelled | refunded */
  status: string
  fulfilmentStatus: string
  email: string
  currency: string
  minorUnit: number
  items: ApiOrderItem[]
  /** Minor units. */
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
  shipping: {
    methodName: string
    address: ApiAddress | null
  }
  billing: ApiAddress | null
  payments: ApiPaymentAttempt[]
  createdAt: string
  customerNote: string
}

export interface CheckoutResult {
  order: ApiOrder & { reused?: boolean }
  payment: {
    provider: string | null
    redirectUrl: string | null
    /** Opaque provider reference, when one was created. */
    reference: string | null
  }
}

/**
 * Place the order.
 *
 * `idempotencyKey` must be stable for one checkout attempt. The server
 * returns the SAME order for a repeated key, which is what stops a
 * double-click from becoming two charges.
 */
export async function submitCheckout(
  payload: CheckoutPayload,
  idempotencyKey: string,
): Promise<CheckoutResult> {
  return request<CheckoutResult>('/checkout', {
    method: 'POST',
    body: payload,
    idempotencyKey,
  })
}

export async function quoteCheckout(input: {
  country?: string
  region?: string
  postcode?: string
  email?: string
  shippingMethodId?: string
}): Promise<{ quote: ApiCart }> {
  return request<{ quote: ApiCart }>('/checkout/quote', { method: 'POST', body: input })
}

export async function getOrder(reference: string): Promise<{ order: ApiOrder }> {
  return request<{ order: ApiOrder }>(`/orders/${encodeURIComponent(reference)}`)
}

/* ================================================================== */
/* Display                                                             */
/* ================================================================== */

/**
 * Format integer minor units for display.
 *
 * This is the ONLY place an amount becomes a string. It divides by the
 * currency's minor unit at the last possible moment, so nothing upstream
 * ever holds a float.
 */
export function formatMinor(amount: number, currency: string, minorUnit: number): string {
  const value = amount / Math.pow(10, minorUnit)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit,
    }).format(value)
  } catch {
    return `${value.toFixed(minorUnit)} ${currency}`
  }
}

/**
 * A short, human label for an error code. Used where the server's message
 * is too technical for a shopper (it is written for a developer).
 */
export function errorLabel(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.'

  switch (err.code) {
    case 'out_of_stock':
      return 'That piece is no longer available in the quantity requested.'
    case 'cart_expired':
      return 'Your cart expired. Please add the piece again.'
    case 'coupon_invalid':
      return 'That code is not valid for this order.'
    case 'coupon_exhausted':
      return 'That code has already been fully redeemed.'
    case 'shipping_unavailable':
      return 'We cannot deliver to that address yet.'
    case 'payment_unconfigured':
      return 'Payment is not available at the moment. Please contact the studio.'
    case 'rate_limited':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'network':
      return err.message
    default:
      return err.message
  }
}

/** True when the storefront is expected to make network calls at all. */
export const networkEnabled = () => store.mode === 'live'
