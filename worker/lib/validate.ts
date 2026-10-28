import { validationFailed } from './errors.ts'

/**
 * VALIDATION
 * ------------------------------------------------------------------
 * Small hand-rolled schema helpers. Deliberately dependency-free: adding
 * zod would be fine, but the shapes here are simple and the bundle size
 * of the Worker matters less than keeping the rules explicit and testable.
 *
 * Every parser returns a typed value or throws a 400 with per-field
 * details. Never trust a client-supplied price, quantity or id.
 */

export type ParseErr = Record<string, string>

class Ctx {
  errors: ParseErr = {}
  add(path: string, message: string) {
    if (!this.errors[path]) this.errors[path] = message
    return this
  }
  get failed() {
    return Object.keys(this.errors).length > 0
  }
  throwIfFailed() {
    if (this.failed) throw validationFailed(this.errors)
  }
}

/* ---------------- Scalars ---------------- */

export function str(
  ctx: Ctx,
  value: unknown,
  path: string,
  opts: { min?: number; max?: number; required?: boolean; trim?: boolean } = {},
): string {
  const { min = 0, max = 5000, required = true, trim = true } = opts
  if (value === undefined || value === null || value === '') {
    if (required) ctx.add(path, 'This field is required.')
    return ''
  }
  if (typeof value !== 'string') {
    ctx.add(path, 'Must be a string.')
    return ''
  }
  const out = trim ? value.trim() : value
  if (out.length < min) ctx.add(path, `Must be at least ${min} characters.`)
  if (out.length > max) ctx.add(path, `Must be at most ${max} characters.`)
  return out
}

export function int(
  ctx: Ctx,
  value: unknown,
  path: string,
  opts: { min?: number; max?: number; required?: boolean } = {},
): number | undefined {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = true } = opts
  if (value === undefined || value === null || value === '') {
    if (required) ctx.add(path, 'This field is required.')
    return undefined
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.add(path, 'Must be a whole number.')
    return undefined
  }
  if (n < min) ctx.add(path, `Must be at least ${min}.`)
  if (n > max) ctx.add(path, `Must be at most ${max}.`)
  return n
}

export function bool(ctx: Ctx, value: unknown, path: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  ctx.add(path, 'Must be a boolean.')
  return fallback
}

export function enumOf<T extends string>(
  ctx: Ctx,
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    ctx.add(path, `Must be one of: ${allowed.join(', ')}`)
    return allowed[0]
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    ctx.add(path, `Must be one of: ${allowed.join(', ')}`)
    return fallback ?? allowed[0]
  }
  return value as T
}

export function email(ctx: Ctx, value: unknown, path: string, required = true): string {
  const raw = str(ctx, value, path, { required, max: 254 })
  if (!raw) return ''
  // Pragmatic check: one @, a dot in the domain, no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) ctx.add(path, 'Enter a valid email address.')
  return raw.toLowerCase()
}

export function slug(ctx: Ctx, value: unknown, path: string): string {
  const raw = str(ctx, value, path, { max: 140 })
  if (!raw) return ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
    ctx.add(path, 'Use lowercase letters, numbers and single hyphens.')
  }
  return raw
}

export function isoCountry(ctx: Ctx, value: unknown, path: string): string {
  const raw = str(ctx, value, path, { max: 2 })
  if (!raw) return ''
  const upper = raw.toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) ctx.add(path, 'Use a two-letter country code, e.g. US.')
  return upper
}

export function arrayOf<T>(
  ctx: Ctx,
  value: unknown,
  path: string,
  item: (ctx: Ctx, v: unknown, p: string) => T,
  opts: { max?: number } = {},
): T[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    ctx.add(path, 'Must be a list.')
    return []
  }
  if (opts.max && value.length > opts.max) {
    ctx.add(path, `At most ${opts.max} items.`)
    return []
  }
  return value.map((v, i) => item(ctx, v, `${path}[${i}]`))
}

/* ---------------- Address ---------------- */

export interface Address {
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

export function parseAddress(
  ctx: Ctx,
  value: unknown,
  path: string,
): Address {
  const obj = (value ?? {}) as Record<string, unknown>
  if (typeof value !== 'object' || value === null) {
    ctx.add(path, 'Address is required.')
  }
  return {
    firstName: str(ctx, obj.firstName ?? obj.first_name, `${path}.firstName`, { max: 80 }),
    lastName: str(ctx, obj.lastName ?? obj.last_name, `${path}.lastName`, { max: 80 }),
    company: str(ctx, obj.company, `${path}.company`, { max: 120, required: false }),
    line1: str(ctx, obj.line1 ?? obj.address_1, `${path}.line1`, { max: 200 }),
    line2: str(ctx, obj.line2 ?? obj.address_2, `${path}.line2`, { max: 200, required: false }),
    city: str(ctx, obj.city, `${path}.city`, { max: 120 }),
    region: str(ctx, obj.region ?? obj.state, `${path}.region`, { max: 120, required: false }),
    postcode: str(ctx, obj.postcode, `${path}.postcode`, { max: 24 }),
    country: isoCountry(ctx, obj.country, `${path}.country`),
    phone: str(ctx, obj.phone, `${path}.phone`, { max: 32, required: false }),
  }
}

/* ---------------- Entry point ---------------- */

/**
 * Run a parser, collecting field errors, and throw one 400 if any failed.
 */
export function validate<T>(fn: (ctx: Ctx) => T): T {
  const ctx = new Ctx()
  const result = fn(ctx)
  ctx.throwIfFailed()
  return result
}

export { Ctx }
