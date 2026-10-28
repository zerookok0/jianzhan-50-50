import { apiUrl } from '../../config/store'

/**
 * STORE API CLIENT
 * ------------------------------------------------------------------
 * A thin, typed wrapper over the Worker API. Two deliberate rules:
 *
 *   1. It never computes money. Every figure the UI shows came from the
 *      server, already in minor units, with an explicit currency and
 *      minorUnit. `formatMinor` only *displays*; it never derives.
 *
 *   2. The guest cart token is held in a header, not a cookie. It is
 *      persisted in localStorage because a cart must survive a reload,
 *      and it is opaque: the server stores only its SHA-256.
 */

/* ---------------- Errors ---------------- */

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
  | 'network_error'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number
  readonly details?: unknown

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }

  /** True when the request may be retried as-is. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/* ---------------- Cart token ---------------- */

const TOKEN_KEY = 'jianzhan:cart-token:v1'

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode — the cart still works for this page view */
  }
}

/** Forget the cart locally, e.g. after the server reports it expired. */
export function clearCartToken(): void {
  writeToken(null)
}

/* ---------------- Transport ---------------- */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Extra headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const token = readToken()
  if (token) headers['X-Cart-Token'] = token

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'omit',
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (err) {
    // Abort is not a failure worth surfacing.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(
      'network_error',
      'Could not reach the store API. Check your connection and try again.',
      0,
    )
  }

  // The server issues a cart token on the first cart request that had none.
  const issued = response.headers.get('X-Cart-Token')
  if (issued) writeToken(issued)

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const envelope = parsed as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | null

    const code = (envelope?.error?.code ?? 'internal') as ApiErrorCode
    if (code === 'cart_expired') clearCartToken()

    throw new ApiError(
      code,
      envelope?.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      envelope?.error?.details,
    )
  }

  return parsed as T
}

/* ---------------- Money display ---------------- */

/**
 * Render minor units as a currency string.
 *
 * Display only. The value passed in is always whatever the server sent;
 * nothing here multiplies quantities or applies rates.
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

/* ---------------- Catalogue types ---------------- */

export interface ApiImage {
  url: string
  alt: string
}

export interface ApiVariant {
  id: string
  optionName: string
  optionValue: string
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
  price: number
  currency: string
  minorUnit: number
  sku: string
  categoryId: string | null
  glaze: string | null
  year: string | null
  availability: string
  isFeatured: boolean
  requiresShipping: boolean
  weightG: number
  images: ApiImage[]
  variants: ApiVariant[]
  inStock: boolean
  available: number | null
}

export interface ApiCategory {
  id: string
  slug: string
  name: string
  description: string
}

/* ---------------- Cart types ---------------- */

export interface ApiCartLine {
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

export interface ApiCartTotals {
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
}

export interface ApiShippingQuote {
  methodId: string
  name: string
  amount: number
  deliveryTime: string
}

export interface ApiCart {
  cartId: string
  currency: string
  minorUnit: number
  items: ApiCartLine[]
  itemCount: number
  totals: ApiCartTotals
  coupons: { code: string; accepted: boolean; discount: number; message?: string }[]
  shipping: {
    available: boolean
    reason?: string
    selected: ApiShippingQuote | null
    options: ApiShippingQuote[]
  }
  needsShipping: boolean
  destination: { country: string | null; region: string | null; postcode: string | null }
  warnings: string[]
}

/* ---------------- Checkout types ---------------- */

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

export interface QuoteInput {
  country: string
  region?: string
  postcode?: string
  email?: string
  shippingMethodId?: string
}

export interface CheckoutInput {
  email: string
  phone?: string
  billingAddress: ApiAddress
  shippingSameAsBilling: boolean
  shippingAddress?: ApiAddress
  shippingMethodId?: string
  customerNote?: string
}

export interface CheckoutResult {
  order: {
    reference: string
    status: string
    paymentStatus: string
    totals: { grandTotal: number; currency: string; minorUnit: number }
    reused: boolean
  }
  payment: {
    provider: string
    /**
     * Where to send the browser. This is NEVER proof of payment: only a
     * verified webhook may mark an order paid.
     */
    redirectUrl: string | null
    clientSecret?: string | null
  }
}

export interface ApiOrderItem {
  name: string
  variantLabel: string
  sku: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface ApiOrder {
  reference: string
  status: string
  fulfilmentStatus: string
  currency: string
  minorUnit: number
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
  email: string
  createdAt: number
  items: ApiOrderItem[]
  shipping: { address: unknown; methodName: string }
  payments: { provider: string; status: string; amount: number }[]
}

/* ---------------- Catalogue ---------------- */

export async function listProducts(params: {
  page?: number
  perPage?: number
  category?: string
  search?: string
  sort?: 'price-asc' | 'price-desc' | 'name' | 'newest'
  featured?: boolean
} = {}): Promise<{ products: ApiProduct[]; total: number; page: number; perPage: number }> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.perPage) qs.set('perPage', String(params.perPage))
  if (params.category) qs.set('category', params.category)
  if (params.search) qs.set('search', params.search)
  if (params.sort) qs.set('sort', params.sort)
  if (params.featured) qs.set('featured', 'true')

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return request(`/products${suffix}`)
}

export async function getProduct(slug: string): Promise<{ product: ApiProduct }> {
  return request(`/products/${encodeURIComponent(slug)}`)
}

export async function listCategories(): Promise<{ categories: ApiCategory[] }> {
  return request('/categories')
}

/* ---------------- Cart ---------------- */

export async function getCart(): Promise<{ cart: ApiCart }> {
  return request('/cart')
}

export async function addCartItem(input: {
  productId: string
  variantId?: string | null
  quantity?: number
}): Promise<{ cart: ApiCart }> {
  return request('/cart/items', {
    method: 'POST',
    body: {
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      quantity: input.quantity ?? 1,
    },
  })
}

export async function updateCartItem(
  itemId: string,
  quantity: number,
): Promise<{ cart: ApiCart }> {
  return request(`/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: { quantity },
  })
}

export async function removeCartItem(itemId: string): Promise<{ cart: ApiCart }> {
  return request(`/cart/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

export async function applyCoupon(code: string): Promise<{ cart: ApiCart }> {
  return request('/cart/coupons', { method: 'POST', body: { code } })
}

export async function removeCoupon(code: string): Promise<{ cart: ApiCart }> {
  return request(`/cart/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function updateDestination(input: {
  country?: string
  region?: string
  postcode?: string
  email?: string
}): Promise<{ cart: ApiCart }> {
  return request('/cart/destination', { method: 'PATCH', body: input })
}

/* ---------------- Checkout ---------------- */

/**
 * Price the current cart for a destination. Read-only on the server: no
 * order is created and no stock is reserved, so it is safe to call while
 * the customer is still typing.
 */
export async function quoteCheckout(input: QuoteInput): Promise<{ quote: ApiCart }> {
  return request('/checkout/quote', {
    method: 'POST',
    body: {
      country: input.country,
      region: input.region || undefined,
      postcode: input.postcode || undefined,
      email: input.email || undefined,
      shippingMethodId: input.shippingMethodId || undefined,
    },
  })
}

/**
 * Create the order and start payment.
 *
 * The idempotency key is generated once per checkout attempt and reused on
 * retry, so a double-click or a network retry returns the SAME order
 * instead of charging twice.
 */
export async function submitCheckout(
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutResult> {
  return request('/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      email: input.email,
      phone: input.phone || undefined,
      billingAddress: input.billingAddress,
      shippingSameAsBilling: input.shippingSameAsBilling,
      shippingAddress: input.shippingAddress,
      shippingMethodId: input.shippingMethodId || undefined,
      customerNote: input.customerNote || undefined,
    },
  })
}

export async function getOrder(reference: string): Promise<{ order: ApiOrder }> {
  return request(`/orders/${encodeURIComponent(reference)}`)
}
