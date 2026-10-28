/**
 * MONEY
 * ------------------------------------------------------------------
 * Every amount in this system is an INTEGER of minor currency units
 * (cents, pence, satoshi…). There is no floating point anywhere in the
 * path from price to receipt.
 *
 * Why: 0.1 + 0.2 !== 0.3 in IEEE-754. Accumulating that error across
 * line items, discounts, tax and shipping produces invoices that are off
 * by a cent — which is a legal and accounting problem, not a cosmetic one.
 *
 * Rules:
 *   • Storage, computation and transport: integer minor units.
 *   • Formatting to a human string: only at the edge, via formatMoney().
 *   • Percentages: basis points (1/100 of a percent), also integers.
 *     1000 bp = 10.00%.
 */

export interface Currency {
  code: string
  minorUnit: number
}

/** Currencies whose minor unit is not 2. */
const MINOR_UNITS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, XOF: 0, XAF: 0, XPF: 0, PYG: 0, RWF: 0, UGX: 0, VUV: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
}

export function minorUnitFor(code: string): number {
  return MINOR_UNITS[code.toUpperCase()] ?? 2
}

export function makeCurrency(code: string): Currency {
  const upper = code.toUpperCase()
  return { code: upper, minorUnit: minorUnitFor(upper) }
}

/** Guard: reject anything that is not a non-negative safe integer. */
export function assertMoney(value: unknown, label = 'amount'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer in minor units, got ${String(value)}`)
  }
  return value
}

export function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value
}

/**
 * Apply a percentage given in basis points.
 * Uses integer maths throughout; the division is the only rounding point
 * and is explicit about its mode.
 */
export function applyBasisPoints(
  amount: number,
  basisPoints: number,
  rounding: 'round' | 'floor' | 'ceil' = 'round',
): number {
  assertMoney(amount, 'amount')
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new Error(`basisPoints must be a non-negative integer, got ${String(basisPoints)}`)
  }
  // amount * bp / 10000, with an explicit rounding mode.
  const numerator = amount * basisPoints
  const denom = 10000
  switch (rounding) {
    case 'floor':
      return Math.floor(numerator / denom)
    case 'ceil':
      return Math.ceil(numerator / denom)
    default:
      // Round half away from zero; amounts are non-negative so half-up.
      return Math.floor((numerator + denom / 2) / denom)
  }
}

/** Format minor units for display. Presentation only. */
export function formatMoney(
  amount: number,
  currency: string | Currency,
  options: { symbol?: string; locale?: string } = {},
): string {
  const cur = typeof currency === 'string' ? makeCurrency(currency) : currency
  const locale = options.locale ?? 'en-US'
  const value = amount / Math.pow(10, cur.minorUnit)

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur.code,
      minimumFractionDigits: cur.minorUnit,
      maximumFractionDigits: cur.minorUnit,
    }).format(value)
  } catch {
    // Unknown currency code for Intl — fall back to a plain rendering.
    const fixed = value.toFixed(cur.minorUnit)
    return options.symbol ? `${options.symbol}${fixed}` : `${fixed} ${cur.code}`
  }
}

/**
 * Parse a human decimal string into minor units.
 * Rejects anything that would lose precision beyond the currency's
 * minor unit rather than silently rounding a user's input.
 */
export function parseMoneyToMinor(input: string, currency: string | Currency): number {
  const cur = typeof currency === 'string' ? makeCurrency(currency) : currency
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Cannot parse "${input}" as money`)
  }
  const [whole, frac = ''] = cleaned.split('.')
  if (frac.length > cur.minorUnit) {
    throw new Error(
      `"${input}" has more decimal places than ${cur.code} supports (${cur.minorUnit})`,
    )
  }
  const padded = frac.padEnd(cur.minorUnit, '0')
  const negative = whole.startsWith('-')
  const digits = `${negative ? '-' : ''}${whole.replace('-', '')}${padded}`
  const value = Number(digits)
  if (!Number.isSafeInteger(value)) throw new Error(`"${input}" is out of safe integer range`)
  return value
}

/** Sum, asserting every term is a valid money integer. */
export function sumMoney(values: number[], label = 'sum'): number {
  return values.reduce((acc, v) => acc + assertMoney(v, label), 0)
}

/** Add two amounts, asserting safety. */
export function addMoney(a: number, b: number): number {
  return assertMoney(assertMoney(a) + assertMoney(b))
}

/** Multiply a unit price by an integer quantity. */
export function multiplyMoney(unitPrice: number, quantity: number): number {
  assertMoney(unitPrice, 'unitPrice')
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${String(quantity)}`)
  }
  return assertMoney(unitPrice * quantity, 'lineTotal')
}
