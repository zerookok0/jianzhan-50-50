/**
 * CRYPTO
 * ------------------------------------------------------------------
 * Everything here runs on the Web Crypto API, available natively in
 * Workers. No Node-only crypto, no third-party hashing libraries.
 *
 * What is stored where:
 *   • Admin password  → PBKDF2-SHA256 hash (never the password)
 *   • Session token   → only SHA-256 hash in D1 (never the raw token)
 *   • Cart token      → only SHA-256 hash in D1 (never the raw token)
 * The raw values exist only in the cookie / header sent to the client.
 */

const enc = new TextEncoder()

/* ---------------- Random tokens ---------------- */

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

/** Short, human-readable, unguessable public order reference. */
export function publicReference(prefix = 'JZ'): string {
  // 80 bits of entropy across a readable alphabet, minus ambiguous chars.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += alphabet[b % alphabet.length]
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ---------------- Hashing ---------------- */

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 hex digest. Used for token storage and webhook dedupe. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return toHex(digest)
}

/* ---------------- Passwords ---------------- */

const PBKDF2_ITERATIONS = 210_000 // OWASP 2023 guidance for PBKDF2-SHA256
const SALT_BYTES = 16

/**
 * Hash a password as `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
 * The iteration count is embedded so it can be raised later without
 * invalidating existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)

  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )

  return [
    'pbkdf2',
    PBKDF2_ITERATIONS,
    base64url(salt),
    base64url(new Uint8Array(bits)),
  ].join('$')
}

/** Verify a password against a stored hash, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1000) return false

  const salt = fromBase64url(parts[2])
  const expected = fromBase64url(parts[3])
  if (!salt || !expected) return false

  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    expected.length * 8,
  )

  return timingSafeEqual(new Uint8Array(bits), expected)
}

function fromBase64url(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Constant-time comparison.
 * A naive `a === b` leaks timing information proportional to the shared
 * prefix, which is enough to recover a token byte by byte.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    // Still compare to keep timing roughly constant, then fail.
    let diff = a.length ^ b.length
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
    }
    return diff === 0
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Constant-time string compare for CSRF tokens and signatures. */
export function timingSafeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b))
}

/* ---------------- HMAC (webhook signatures) ---------------- */

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(sig)
}

/** Verify an HMAC signature in constant time. */
export async function verifyHmacSha256(
  secret: string,
  payload: string,
  signatureHex: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, payload)
  return timingSafeEqualString(expected.toLowerCase(), signatureHex.toLowerCase())
}
