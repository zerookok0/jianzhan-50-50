import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256Hex,
  timingSafeEqualString,
} from '../lib/crypto.ts'
import { forbidden, unauthorized } from '../lib/errors.ts'
import { serializeCookie, parseCookies, type CookieOptions } from '../lib/http.ts'

/**
 * ADMIN AUTHENTICATION
 * ------------------------------------------------------------------
 * Session-cookie auth with server-side validation on every request.
 *
 * Threat model this addresses:
 *   • Stolen DB dump leaks nothing usable — only SHA-256 hashes of tokens.
 *   • XSS cannot read the session cookie (HttpOnly).
 *   • CSRF is blocked by a double-submit token on state-changing routes.
 *   • Brute force is rate-limited per IP+email AND locked per account.
 *   • Timing attacks on token comparison are defeated by constant-time
 *     comparison.
 */

export const SESSION_COOKIE = 'jz_admin_session'
export const CSRF_COOKIE = 'jz_admin_csrf'
export const CSRF_HEADER = 'X-CSRF-Token'

const SESSION_TTL_MS = 1000 * 60 * 60 * 8 // 8 hours
const MAX_FAILED_ATTEMPTS = 8
const LOCKOUT_MS = 1000 * 60 * 15

export interface AdminUserRow {
  id: string
  email: string
  password_hash: string
  role: 'admin' | 'staff'
  is_active: number
  failed_attempts: number
  locked_until: number | null
  last_login_at: number | null
}

export interface AdminSession {
  userId: string
  email: string
  role: 'admin' | 'staff'
  csrfToken: string
  sessionId: string
}

/* ---------------- Password rules ---------------- */

/**
 * Minimum viable policy. Length dominates complexity for real-world
 * strength, so require length and reject only the worst offenders.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.'
  if (password.length > 200) return 'Password is too long.'
  if (/^(.)\1+$/.test(password)) return 'Password cannot be a single repeated character.'
  const common = ['password', 'admin', 'letmein', 'welcome', '123456', 'qwerty']
  const lower = password.toLowerCase()
  if (common.some((c) => lower.includes(c))) return 'Password contains a common word.'
  return null
}

/* ---------------- Login ---------------- */

export interface LoginResult {
  ok: boolean
  /** Set on success. */
  cookies?: string[]
  user?: { id: string; email: string; role: string }
  /** Set on failure; deliberately vague to avoid user enumeration. */
  message?: string
  lockedForSeconds?: number
}

export async function login(
  db: D1Database,
  args: { email: string; password: string; userAgent: string; ipHash: string },
): Promise<LoginResult> {
  const now = Date.now()

  const user = await db
    .prepare('SELECT * FROM admin_users WHERE email = ?1 COLLATE NOCASE')
    .bind(args.email)
    .first<AdminUserRow>()

  // Constant-ish work whether or not the user exists, so a missing account
  // is not distinguishable by timing. verifyPassword against a dummy hash
  // costs the same PBKDF2 work.
  if (!user) {
    await verifyPassword(args.password, 'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAA')
    return { ok: false, message: 'Invalid email or password.' }
  }

  if (!user.is_active) {
    return { ok: false, message: 'Invalid email or password.' }
  }

  if (user.locked_until && user.locked_until > now) {
    return {
      ok: false,
      message: 'Too many attempts. Try again later.',
      lockedForSeconds: Math.ceil((user.locked_until - now) / 1000),
    }
  }

  const valid = await verifyPassword(args.password, user.password_hash)

  if (!valid) {
    const attempts = user.failed_attempts + 1
    const lock = attempts >= MAX_FAILED_ATTEMPTS
    await db
      .prepare(
        `UPDATE admin_users
            SET failed_attempts = ?2,
                locked_until = ?3,
                updated_at = ?4
          WHERE id = ?1`,
      )
      .bind(user.id, lock ? 0 : attempts, lock ? now + LOCKOUT_MS : null, now)
      .run()

    return {
      ok: false,
      message: 'Invalid email or password.',
      ...(lock ? { lockedForSeconds: Math.ceil(LOCKOUT_MS / 1000) } : {}),
    }
  }

  /* ---- Success ---- */

  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const csrfToken = randomToken(24)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + SESSION_TTL_MS

  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_sessions
           (id, user_id, token_hash, csrf_token, user_agent, ip_hash, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(sessionId, user.id, tokenHash, csrfToken, args.userAgent.slice(0, 200), args.ipHash, expiresAt, now),
    db
      .prepare(
        `UPDATE admin_users
            SET failed_attempts = 0, locked_until = NULL, last_login_at = ?2, updated_at = ?2
          WHERE id = ?1`,
      )
      .bind(user.id, now),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, detail, ip_hash, created_at)
         VALUES (?1, 'admin', ?2, 'admin.login', 'admin_user', ?2, '{}', ?3, ?4)`,
      )
      .bind(crypto.randomUUID(), user.id, args.ipHash, now),
  ])

  const base: CookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }

  // The CSRF cookie is readable by JS (double-submit); the session cookie
  // is not. Both are Secure + SameSite=Strict.
  return {
    ok: true,
    user: { id: user.id, email: user.email, role: user.role },
    cookies: [
      serializeCookie(SESSION_COOKIE, token, base),
      serializeCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false }),
    ],
  }
}

/* ---------------- Session resolution ---------------- */

/** Resolve and validate the session from the request cookie. */
export async function requireAdmin(
  db: D1Database,
  request: Request,
  opts: { requireRole?: 'admin' } = {},
): Promise<AdminSession> {
  const cookies = parseCookies(request)
  const token = cookies[SESSION_COOKIE]
  if (!token) throw unauthorized('Sign in to continue.')

  const tokenHash = await sha256Hex(token)
  const now = Date.now()

  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.csrf_token, s.expires_at,
              u.email, u.role, u.is_active
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{
      id: string
      user_id: string
      csrf_token: string
      expires_at: number
      email: string
      role: 'admin' | 'staff'
      is_active: number
    }>()

  if (!row) throw unauthorized('Session is invalid. Please sign in again.')
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM admin_sessions WHERE id = ?1').bind(row.id).run()
    throw unauthorized('Session expired. Please sign in again.')
  }
  if (!row.is_active) throw forbidden('This account is disabled.')
  if (opts.requireRole === 'admin' && row.role !== 'admin') {
    throw forbidden('Administrator access required.')
  }

  // CSRF: state-changing methods must present the token in a header that
  // matches the session's stored token. A cross-site form cannot set a
  // custom header, and cannot read the value to forge it.
  if (isMutating(request.method)) {
    const header = request.headers.get(CSRF_HEADER)
    if (!header || !timingSafeEqualString(header, row.csrf_token)) {
      throw forbidden('CSRF token missing or invalid.')
    }
  }

  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    csrfToken: row.csrf_token,
    sessionId: row.id,
  }
}

function isMutating(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
}

/* ---------------- Logout ---------------- */

export async function logout(db: D1Database, request: Request): Promise<string[]> {
  const cookies = parseCookies(request)
  const token = cookies[SESSION_COOKIE]
  if (token) {
    const tokenHash = await sha256Hex(token)
    await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(tokenHash).run()
  }
  const expired: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 0 }
  return [
    serializeCookie(SESSION_COOKIE, '', expired),
    serializeCookie(CSRF_COOKIE, '', { ...expired, httpOnly: false }),
  ]
}

/** Cron: drop expired sessions. */
export async function pruneSessions(db: D1Database): Promise<number> {
  const res = await db
    .prepare('DELETE FROM admin_sessions WHERE expires_at < ?1')
    .bind(Date.now())
    .run()
  return res.meta.changes ?? 0
}

/* ---------------- Bootstrap ---------------- */

/**
 * One-time admin creation.
 *
 * Guarded by ADMIN_BOOTSTRAP_TOKEN, which the operator sets as a secret,
 * calls once, then removes. There is no default password and no public
 * signup route.
 */
export async function bootstrapAdmin(
  db: D1Database,
  args: { email: string; password: string; token: string; expectedToken: string | undefined },
): Promise<{ ok: boolean; message: string }> {
  if (!args.expectedToken) {
    return { ok: false, message: 'ADMIN_BOOTSTRAP_TOKEN is not set. Refusing to bootstrap.' }
  }
  if (!timingSafeEqualString(args.token, args.expectedToken)) {
    return { ok: false, message: 'Invalid bootstrap token.' }
  }

  const existing = await db
    .prepare('SELECT COUNT(*) AS n FROM admin_users')
    .first<{ n: number }>()
  if ((existing?.n ?? 0) > 0) {
    return { ok: false, message: 'An admin account already exists. Bootstrap is closed.' }
  }

  const weak = validatePasswordStrength(args.password)
  if (weak) return { ok: false, message: weak }

  const now = Date.now()
  const hash = await hashPassword(args.password)

  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_users
           (id, email, password_hash, role, is_active, failed_attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'admin', 1, 0, ?4, ?4)`,
      )
      .bind(crypto.randomUUID(), args.email.toLowerCase(), hash, now),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, detail, ip_hash, created_at)
         VALUES (?1, 'system', NULL, 'admin.bootstrap', 'admin_user', '', '{}', '', ?2)`,
      )
      .bind(crypto.randomUUID(), now),
  ])

  return { ok: true, message: 'Admin account created. Remove ADMIN_BOOTSTRAP_TOKEN now.' }
}
