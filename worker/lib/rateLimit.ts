import { rateLimited } from './errors.ts'

/**
 * RATE LIMITING
 * ------------------------------------------------------------------
 * Fixed-window counters stored in D1 so limits survive Worker isolates
 * (in-memory counters reset on every cold start and are trivially
 * bypassed by a load balancer spreading requests).
 *
 * This is intentionally simple. A fixed window allows a burst at the
 * boundary; that is acceptable for login throttling and cart spam. If
 * you need true precision, add a sliding-window or Durable Object.
 */

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfter: number
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const expiresAt = now + windowMs

  // Upsert: start a new window if the old one expired, otherwise increment.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start, expires_at)
       VALUES (?1, 1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.expires_at <= ?2 THEN 1
           ELSE rate_limits.count + 1
         END,
         window_start = CASE
           WHEN rate_limits.expires_at <= ?2 THEN ?2
           ELSE rate_limits.window_start
         END,
         expires_at = CASE
           WHEN rate_limits.expires_at <= ?2 THEN ?3
           ELSE rate_limits.expires_at
         END
       RETURNING count, expires_at`,
    )
    .bind(key, now, expiresAt)
    .first<{ count: number; expires_at: number }>()

  const count = row?.count ?? 1
  const retryAfter = Math.max(1, Math.ceil(((row?.expires_at ?? expiresAt) - now) / 1000))

  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter,
  }
}

/** Throws a 429 with Retry-After when the limit is exceeded. */
export async function enforceRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await checkRateLimit(db, key, limit, windowSeconds)
  if (!result.ok) throw rateLimited(result.retryAfter)
}

/**
 * Occasional cleanup. Called from a cron trigger rather than on the hot
 * path, so a request never pays for garbage collection.
 */
export async function pruneRateLimits(db: D1Database): Promise<number> {
  const result = await db
    .prepare('DELETE FROM rate_limits WHERE expires_at < ?1')
    .bind(Date.now())
    .run()
  return result.meta.changes ?? 0
}

/** Common limit profiles. */
export const LIMITS = {
  /** Cart mutations: generous, but stops scripted abuse. */
  cart: { limit: 120, window: 60 },
  /** Checkout attempts per IP. */
  checkout: { limit: 10, window: 60 },
  /** Admin login per IP+email. */
  login: { limit: 5, window: 300 },
  /** Admin writes. */
  adminWrite: { limit: 60, window: 60 },
  /** Public reads. */
  publicRead: { limit: 300, window: 60 },
  /** Payment webhooks: providers retry, so allow bursts. */
  webhook: { limit: 200, window: 60 },
  /** Password reset / email sending. */
  email: { limit: 5, window: 3600 },
} as const
