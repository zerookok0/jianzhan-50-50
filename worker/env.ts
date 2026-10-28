import type { AppError } from './lib/errors.ts'

/**
 * ENVIRONMENT BINDINGS
 * ------------------------------------------------------------------
 * Types for the Cloudflare Worker bindings. Secrets are declared here
 * but their VALUES must be set via `wrangler secret put` — never in
 * wrangler.toml, never in the repo, never in a VITE_ variable.
 */

export interface Env {
  /* ---- Bindings ---- */
  DB: D1Database
  IMAGES: R2Bucket

  /* ---- Plain vars (wrangler.toml [vars]) ---- */
  ENVIRONMENT: 'development' | 'preview' | 'production'
  /** Public origin of the storefront, for CORS and links. */
  APP_ORIGIN: string
  /** Allowed CORS origins, comma separated (preview + prod). */
  ALLOWED_ORIGINS: string
  /** 'USD' etc. Must match the currencies configured in D1. */
  DEFAULT_CURRENCY: string
  /** Minutes an unpaid order holds its stock reservation. */
  ORDER_RESERVATION_MINUTES: string
  /** Cart lifetime in days. */
  CART_TTL_DAYS: string

  /* ---- Secrets (wrangler secret put) ---- */
  /** Signing key for session state. 32+ random bytes, base64. */
  SESSION_SECRET?: string
  /** Dev-mock payment provider signing secret (non-production only). */
  PAYMENT_MOCK_SECRET?: string
  /** Real provider secrets, populated only after a provider is chosen. */
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  RESEND_API_KEY?: string

  /** Set only during the one-time admin bootstrap. */
  ADMIN_BOOTSTRAP_TOKEN?: string
}

/** Narrowed env for handlers that require the database. */
export type AppContext = {
  env: Env
  executionCtx: ExecutionContext
  request: Request
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly appError?: AppError,
  ) {
    super(message)
  }
}

/** True only on the real production environment. */
export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === 'production'
}

/** Local dev (`wrangler dev`) — the only place the mock provider may run. */
export function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === 'development'
}
