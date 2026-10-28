import { AppError, toAppError } from './errors.ts'

/**
 * HTTP PLUMBING
 * ------------------------------------------------------------------
 * Response helpers, CORS, security headers, cookie utilities and a tiny
 * pattern router. No framework: Workers bill by CPU time and every KB of
 * dependency is a cold-start cost.
 */

/* ---------------- JSON responses ---------------- */

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Never let a shared cache hold a cart, order or checkout response.
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v)
  }
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function noContent(init: ResponseInit = {}): Response {
  return new Response(null, { ...init, status: 204 })
}

export function errorResponse(err: unknown): Response {
  const appErr = toAppError(err)
  return json(appErr.toJSON(), { status: appErr.status })
}

/* ---------------- CORS ---------------- */

/**
 * CORS with an explicit allow-list. Never `*`.
 *
 * Two credential modes are supported:
 *   • Storefront → token in `Authorization`/`X-Cart-Token` header, cookie-less.
 *   • Admin      → HttpOnly session cookie, so credentials are required and
 *                  the origin must be echoed exactly.
 */
export function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins.includes(origin)) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Accept, Authorization, X-Cart-Token, X-CSRF-Token, Idempotency-Key, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-Cart-Token, X-Request-Id, Retry-After',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  }
}

export function withCors(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  // Vary on Origin so caches never serve one origin's CORS headers to another.
  headers.append('Vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

export function preflight(request: Request, allowedOrigins: string[]): Response {
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response(null, { status: 403 })
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, allowedOrigins) })
}

/* ---------------- Cookies ---------------- */

export interface CookieOptions {
  maxAge?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${opts.path ?? '/'}`)
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`)
  parts.push(`HttpOnly=${opts.httpOnly ?? true}`)
  // Secure must be on for SameSite=None; also on for every production cookie.
  parts.push(`Secure=${opts.secure ?? true}`)
  parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`)
  return parts.join('; ')
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie')
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAge: 0 })
}

/* ---------------- Request helpers ---------------- */

export async function readJson(request: Request): Promise<unknown> {
  const ct = request.headers.get('Content-Type') ?? ''
  if (!ct.includes('application/json')) {
    throw new AppError('bad_request', 'Expected Content-Type: application/json.', 400)
  }
  const text = await request.text()
  if (!text) return {}
  if (text.length > 100_000) {
    throw new AppError('bad_request', 'Request body is too large.', 413)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AppError('bad_request', 'Request body is not valid JSON.', 400)
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  return null
}

/* ---------------- Router ---------------- */

export interface RouteMatch {
  params: Record<string, string>
}

export type RouteHandler<E = unknown> = (ctx: {
  request: Request
  params: Record<string, string>
  url: URL
  env: E
}) => Promise<Response>

export interface Route<E = unknown> {
  method: string
  /** Pattern like '/api/v1/products/:slug' */
  pattern: string
  handler: RouteHandler<E>
}

/**
 * Compile '/a/:b/c' into a regex with named groups.
 * `:param` matches one path segment; `:rest*` matches the remainder.
 */
function compile(pattern: string): RegExp {
  const parts = pattern.split('/').map((seg) => {
    if (seg.startsWith(':')) {
      const name = seg.slice(1).replace(/\*$/, '')
      return seg.endsWith('*') ? `(?<${name}>.+)` : `(?<${name}>[^/]+)`
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return new RegExp(`^${parts.join('/')}/?$`)
}

export function createRouter<E>(routes: Route<E>[]) {
  const compiled = routes.map((r) => ({ ...r, re: compile(r.pattern) }))

  return async function route(request: Request, env: E): Promise<Response | null> {
    const url = new URL(request.url)
    const path = url.pathname

    let pathMatched = false

    for (const r of compiled) {
      const m = r.re.exec(path)
      if (!m) continue
      pathMatched = true
      if (r.method !== request.method) continue

      return r.handler({
        request,
        params: (m.groups ?? {}) as Record<string, string>,
        url,
        env,
      })
    }

    if (pathMatched) {
      return errorResponse(
        new AppError('method_not_allowed', `${request.method} not allowed on ${path}.`, 405),
      )
    }
    return null
  }
}
