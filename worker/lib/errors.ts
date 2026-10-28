/**
 * ERRORS
 * ------------------------------------------------------------------
 * One envelope for every API failure so the front end can branch on a
 * stable `code` instead of parsing prose.
 *
 *   { "error": { "code": "...", "message": "...", "details": {...} } }
 *
 * HTTP status is chosen by the error class, never by the caller guessing.
 */

export type ErrorCode =
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

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, status?: number, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status ?? statusFor(code)
    this.details = details
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    }
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'bad_request':
    case 'validation_failed':
      return 400
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'method_not_allowed':
      return 405
    case 'conflict':
    case 'out_of_stock':
    case 'cart_expired':
    case 'coupon_invalid':
    case 'coupon_exhausted':
    case 'shipping_unavailable':
      return 409
    case 'rate_limited':
      return 429
    case 'payment_unconfigured':
      return 503
    case 'payment_failed':
      return 402
    case 'not_implemented':
      return 501
    default:
      return 500
  }
}

/* ---------------- Convenience constructors ---------------- */

export const badRequest = (m: string, d?: unknown) => new AppError('bad_request', m, 400, d)
export const validationFailed = (d: unknown, m = 'Some fields are invalid.') =>
  new AppError('validation_failed', m, 400, d)
export const unauthorized = (m = 'Authentication required.') => new AppError('unauthorized', m, 401)
export const forbidden = (m = 'You do not have access to this resource.') =>
  new AppError('forbidden', m, 403)
export const notFound = (m = 'Not found.') => new AppError('not_found', m, 404)
export const conflict = (m: string, d?: unknown) => new AppError('conflict', m, 409, d)
export const outOfStock = (m: string, d?: unknown) => new AppError('out_of_stock', m, 409, d)
export const couponInvalid = (m: string, d?: unknown) => new AppError('coupon_invalid', m, 409, d)
export const shippingUnavailable = (m: string, d?: unknown) =>
  new AppError('shipping_unavailable', m, 409, d)
export const paymentUnconfigured = (m: string, d?: unknown) =>
  new AppError('payment_unconfigured', m, 503, d)
export const rateLimited = (retryAfterSeconds: number) =>
  new AppError('rate_limited', 'Too many requests. Please slow down.', 429, {
    retry_after: retryAfterSeconds,
  })
export const internal = (m = 'An unexpected error occurred.') => new AppError('internal', m, 500)
export const notImplemented = (m = 'Not implemented.') => new AppError('not_implemented', m, 501)

/**
 * Normalise anything thrown into an AppError.
 * Unknown errors become a generic 500: internal messages (SQL, stack
 * traces) must never reach the client.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof Error && /D1_ERROR|SQLITE/i.test(err.message)) {
    // Logged server-side, hidden from the client.
    console.error('[db]', err.message)
    return internal('A database error occurred.')
  }
  console.error('[unhandled]', err)
  return internal()
}
