/**
 * API CLIENT (frontend)
 * ------------------------------------------------------------------
 * Talks to the first-party Worker at /api/v1. No WooCommerce anywhere.
 *
 * Money crosses the wire as integer minor units plus an explicit
 * `currency` and `minorUnit`. Formatting happens only at render time.
 *
 * Cart identity is a bearer token in `X-Cart-Token`. Not a cookie: a
 * cross-origin cookie would be blocked by third-party cookie policy, and
 * a header cannot be set by a cross-site form, which also removes CSRF.
 */

const CART_HEADER = 'X-Cart-Token'
const TOKEN_KEY = 'jianzhan:cart-token:v3'

/* ---------------- Error shape ---------------- */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }

  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429
  }
}

/* ---------------- Base URL ---------------- */

const envBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * Empty base means same-origin, which is the production setup: the Worker
 * is routed on `/api/*` of the same domain. A separate origin is only used
 * when the API is deployed independently.
 */
function apiBase(): string {
  return envBase
}

export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}/api/v1${suffix}`
}

/* ---------------- Token ---------------- */

let memoryToken: string | null = null

export function getCartToken(): string | null {
  if (memoryToken) return memoryToken
  try {
    memoryToken = window.localStorage.getItem(TOKEN_KEY)
  } catch {
    memoryToken = null
  }
  return memoryToken
}

function setCartToken(token: string | null) {
  memoryToken = token
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode — memory copy still works for this session */
  }
}

/* ---------------- Core request ---------------- */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Extra headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>
  /** Send the cart token. Off for catalogue reads. */
  withToken?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers: extraHeaders, withToken = true, signal } = opts

  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (withToken) {
    const token = getCartToken()
    if (token) headers[CART_HEADER] = token
  }

  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal,
    })
  } catch {
    throw new ApiError(
      'network',
      'Could not reach the store. Check your connection and try again.',
      0,
    )
  }

  // A new cart returns its token once, in this header.
  const issued = res.headers.get(CART_HEADER)
  if (issued) setCartToken(issued)

  const text = await res.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError('invalid_response', 'The store sent a malformed response.', res.status)
    }
  }

  if (!res.ok) {
    const err = payload as ApiErrorBody | null
    throw new ApiError(
      err?.error?.code ?? `http_${res.status}`,
      err?.error?.message ?? `Request failed (${res.status}).`,
      res.status,
      err?.error?.details,
    )
  }

  return payload as T
}

/* ---------------- Shared types ---------------- */

export interface Money {
  subtotal: number
  discountTotal: number
  discountedSubtotal: number
  taxTotal: number
  shippingTotal: number
  grandTotal: number
  taxLines: { name: string; rateBp: number; amount: number }[]
}

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

export interface ApiShippingOption {
  methodId: string
  name: string
  deliveryTime: string
  amount: number
  freeApplied: boolean
}

export interface ApiCart {
  cartId: string
  currency: string
  minorUnit: number
  items: ApiCartLine[]
  itemCount: number
  totals: Money
  coupons: { code: string; accepted: boolean; discount: number; message?: string }[]
  shipping: {
    available: boolean
    reason?: string
    selected: ApiShippingOption | null
    options: ApiShippingOption[]
  }
  needsShipping: boolean
  destination: { country: string | null; region: string | null; postcode: string | null }
  warnings: string[]
}

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

/* ---------------- Endpoints ---------------- */

export function listProducts(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const q = qs.toString()
  return request<{ products: ApiProduct[]; total: number; page: number; perPage: number }>(
    `/products${q ? `?${q}` : ''}`,
    { withToken: false },
  )
}

export function getProduct(slug: string) {
  return request<{ product: ApiProduct }>(`/products/${encodeURIComponent(slug)}`, {
    withToken: false,
  })
}

export function listCategories() {
  return request<{ categories: { id: string; slug: string; name: string; description: string }[] }>(
    '/categories',
    { withToken: false },
  )
}

export function getCart() {
  return request<{ cart: ApiCart }>('/cart')
}

export function addCartItem(input: { productId: string; variantId?: string | null; quantity?: number }) {
  return request<{ cart: ApiCart }>('/cart/items', {
    method: 'POST',
    body: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      quantity: input.quantity ?? 1,
    },
  })
}

export function updateCartItem(itemId: string, quantity: number) {
  return request<{ cart: ApiCart }>(`/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: { quantity },
  })
}

export function removeCartItem(itemId: string) {
  return request<{ cart: ApiCart }>(`/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  })
}

export function applyCoupon(code: string) {
  return request<{ cart: ApiCart }>('/cart/coupons', { method: 'POST', body: { code } })
}

export function removeCoupon(code: string) {
  return request<{ cart: ApiCart }>(`/cart/coupons/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  })
}

export function updateDestination(input: {
  country?: string
  region?: string
  postcode?: string
  email?: string
}) {
  return request<{ cart: ApiCart }>('/cart/destination', { method: 'PATCH', body: input })
}

export function quoteCheckout(input: {
  country: string
  region?: string
  postcode?: string
  email?: string
  shippingMethodId?: string
}) {
  return request<{ quote: ApiCart }>('/checkout/quote', { method: 'POST', body: input })
}

export interface CheckoutResponse {
  order: {
    reference: string
    status: string
    paymentStatus: string
    totals: { grandTotal: number; currency: string; minorUnit: number }
    reused: boolean
  }
  payment: { provider: string; redirectUrl: string | null; clientSecret: string | null }
}

export function submitCheckout(
  input: {
    email: string
    phone?: string
    billingAddress: ApiAddress
    shippingAddress?: ApiAddress
    shippingSameAsBilling?: boolean
    shippingMethodId?: string
    customerNote?: string
  },
  idempotencyKey: string,
) {
  return request<CheckoutResponse>('/checkout', {
    method: 'POST',
    body: input,
    // Sent as a header so a retry with the same key returns the SAME order
    // instead of creating a second one and charging twice.
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}

export function getOrder(reference: string) {
  return request<{ order: Record<string, unknown> }>(
    `/orders/${encodeURIComponent(reference)}`,
    { withToken: false },
  )
}

/* ---------------- Money formatting ---------------- */

export function formatMinor(amount: number, currency: string, minorUnit = 2): string {
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

export function clearCartToken() {
  setCartToken(null)
}

export { request }
