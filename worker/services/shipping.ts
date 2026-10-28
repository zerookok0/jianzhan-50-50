import { applyBasisPoints, clampNonNegative } from '../lib/money.ts'

/**
 * SHIPPING
 * ------------------------------------------------------------------
 * Zone matching then method pricing. Pure functions; the caller loads the
 * zones and methods from D1 and passes them in.
 *
 * This is deliberately simple arithmetic, not carrier integration. No
 * live rates, no dimensional weight, no negotiated tariffs.
 */

export interface ShippingZoneRule {
  id: string
  name: string
  countries: string[]
  regions: string[]
  postcodePrefixes: string[]
  position: number
  isActive: boolean
}

export interface ShippingMethodRule {
  id: string
  zoneId: string
  name: string
  rateType: 'flat' | 'weight' | 'subtotal'
  /** flat: minor units per shipment; weight: per kg; subtotal: basis points. */
  rate: number
  freeOver: number | null
  minSubtotal: number
  deliveryTime: string
  isActive: boolean
  position: number
}

export interface ShippingQuote {
  methodId: string
  zoneId: string
  name: string
  deliveryTime: string
  /** Minor units. */
  amount: number
  /** True when the free-shipping threshold waived the cost. */
  freeApplied: boolean
}

export interface ShippingRequest {
  country: string | null
  region: string | null
  postcode: string | null
  /** Minor units, after discounts. */
  subtotal: number
  /** Grams. */
  weightG: number
  /** False when the cart has no shippable items. */
  needsShipping: boolean
}

/**
 * Match a destination to the most specific zone.
 * Specificity: postcode prefix > region > country > wildcard.
 */
export function matchZone(
  zones: ShippingZoneRule[],
  dest: { country: string | null; region: string | null; postcode: string | null },
): { zone: ShippingZoneRule | null; ambiguity: boolean } {
  if (!dest.country) return { zone: null, ambiguity: false }

  const candidates = zones.filter((z) => {
    if (!z.isActive) return false
    const countryOk = z.countries.includes('*') || z.countries.includes(dest.country!)
    if (!countryOk) return false
    if (z.regions.length && !(dest.region && z.regions.includes(dest.region))) return false
    if (z.postcodePrefixes.length) {
      const pc = (dest.postcode ?? '').toUpperCase()
      if (!pc || !z.postcodePrefixes.some((p) => pc.startsWith(p.toUpperCase()))) return false
    }
    return true
  })

  if (!candidates.length) return { zone: null, ambiguity: false }

  const score = (z: ShippingZoneRule) => {
    let s = 0
    if (!z.countries.includes('*')) s += 10
    if (z.regions.length) s += 5
    if (z.postcodePrefixes.length) s += 8
    return s
  }

  const sorted = [...candidates].sort((a, b) => score(b) - score(a) || a.position - b.position)
  const ambiguity = sorted.length > 1 && score(sorted[0]) === score(sorted[1])
  return { zone: sorted[0], ambiguity }
}

/**
 * Price every active method in a zone for a given request.
 * Methods below their minimum subtotal are omitted, not shown as disabled,
 * so the customer is never offered something they cannot select.
 */
export function quoteMethods(
  methods: ShippingMethodRule[],
  zoneId: string,
  req: ShippingRequest,
): ShippingQuote[] {
  const applicable = methods.filter(
    (m) => m.zoneId === zoneId && m.isActive && req.subtotal >= m.minSubtotal,
  )

  return applicable
    .sort((a, b) => a.position - b.position)
    .map((m) => {
      const base = (() => {
        switch (m.rateType) {
          case 'flat':
            return m.rate
          case 'weight': {
            // Per-kilogram, rounded up so a 250 g parcel still pays 1 kg.
            const kg = Math.max(1, Math.ceil(req.weightG / 1000))
            return m.rate * kg
          }
          case 'subtotal':
            return applyBasisPoints(req.subtotal, m.rate, 'round')
          default:
            return 0
        }
      })()

      const freeApplied = m.freeOver !== null && req.subtotal >= m.freeOver
      const amount = freeApplied ? 0 : clampNonNegative(base)

      return {
        methodId: m.id,
        zoneId,
        name: m.name,
        deliveryTime: m.deliveryTime,
        amount,
        freeApplied,
      }
    })
}

/**
 * Build the full quote for a destination.
 * Returns an explicit "unavailable" result rather than an empty list, so
 * the UI can distinguish "no method matches" from "nothing to ship".
 */
export function quoteShipping(args: {
  zones: ShippingZoneRule[]
  methods: ShippingMethodRule[]
  request: ShippingRequest
}): { available: boolean; quotes: ShippingQuote[]; reason?: string } {
  const { request } = args

  if (!request.needsShipping) {
    return { available: true, quotes: [] }
  }

  if (!request.country) {
    return { available: false, quotes: [], reason: 'Enter a delivery country to see shipping.' }
  }

  const { zone } = matchZone(args.zones, {
    country: request.country,
    region: request.region,
    postcode: request.postcode,
  })

  if (!zone) {
    return {
      available: false,
      quotes: [],
      reason: `We do not currently ship to ${request.country}. Please contact the studio.`,
    }
  }

  const quotes = quoteMethods(args.methods, zone.id, request)

  if (!quotes.length) {
    return {
      available: false,
      quotes: [],
      reason: 'No delivery option is available for this address. Please contact the studio.',
    }
  }

  return { available: true, quotes }
}

/** Pick the requested method, or the cheapest, or fail explicitly. */
export function selectQuote(
  quotes: ShippingQuote[],
  requestedId: string | null,
): ShippingQuote | null {
  if (!quotes.length) return null
  if (requestedId) {
    const match = quotes.find((q) => q.methodId === requestedId)
    if (match) return match
    // A requested-but-missing method is a stale cart, not a silent
    // fallback to a different price.
    return null
  }
  return [...quotes].sort((a, b) => a.amount - b.amount)[0]
}
