/**
 * SHIPPING
 * ------------------------------------------------------------------
 * Quotes are pure: given zones, methods and a basket, produce priced
 * options. No database, no clock, no network — so the tests assert exact
 * amounts.
 *
 * The rule that prevents the most embarrassing bug: a method that no
 * longer exists, or no longer applies, returns `null` rather than a
 * guessed price. Charging an old rate because a zone was deleted is worse
 * than refusing the order.
 */

export interface ShippingZone {
  id: string
  name: string
  countries: string[]
  regions: string[]
  postcodePrefixes: string[]
  position: number
  isActive: boolean
}

export interface ShippingMethod {
  id: string
  zoneId: string
  name: string
  rateType: 'flat' | 'weight' | 'subtotal'
  /** Minor units for flat; minor units per kg for weight; basis points for subtotal. */
  rate: number
  /** Minor units; shipping is free at or above this subtotal. */
  freeOver: number | null
  minSubtotal: number
  deliveryTime: string
  isActive: boolean
  position: number
}

export interface ShippingRequest {
  country: string | null
  region: string | null
  postcode: string | null
  subtotal: number
  weightG: number
  needsShipping: boolean
}

export interface ShippingQuote {
  methodId: string
  name: string
  /** Minor units. */
  amount: number
  deliveryTime: string
  freeApplied: boolean
}

export interface ShippingResult {
  available: boolean
  reason: string | null
  quotes: ShippingQuote[]
}

/* ---------------- Zone matching ---------------- */

/**
 * Most specific zone wins:
 *   postcode prefix  (score 3)
 *   region           (score 2)
 *   country          (score 1)
 *   wildcard         (score 0)
 */
export function matchZone(
  zones: ShippingZone[],
  destination: { country: string | null; region: string | null; postcode: string | null },
): { zone: ShippingZone | null } {
  const country = destination.country?.toUpperCase() ?? ''
  const region = destination.region?.toUpperCase() ?? ''
  const postcode = (destination.postcode ?? '').toUpperCase().replace(/\s+/g, '')

  const scored = zones
    .filter((zone) => zone.isActive)
    .map((zone) => {
      const countryMatch = zone.countries.some((c) => c === '*' || c.toUpperCase() === country)
      if (!countryMatch) return null

      if (zone.regions.length > 0) {
        const regionMatch = zone.regions.some((r) => r.toUpperCase() === region)
        if (!regionMatch) return null
      }

      if (zone.postcodePrefixes.length > 0) {
        const prefixMatch = zone.postcodePrefixes.some((prefix) =>
          postcode.startsWith(prefix.toUpperCase().replace(/\s+/g, '')),
        )
        if (!prefixMatch) return null
      }

      let score = 0
      if (zone.countries.some((c) => c !== '*')) score += 1
      if (zone.regions.length > 0) score += 2
      if (zone.postcodePrefixes.length > 0) score += 3

      return { zone, score }
    })
    .filter((entry): entry is { zone: ShippingZone; score: number } => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.zone.position - b.zone.position
    })

  return { zone: scored[0]?.zone ?? null }
}

/* ---------------- Pricing a method ---------------- */

function priceMethod(
  method: ShippingMethod,
  request: { subtotal: number; weightG: number },
): { amount: number; freeApplied: boolean } {
  if (method.freeOver !== null && request.subtotal >= method.freeOver) {
    return { amount: 0, freeApplied: true }
  }

  switch (method.rateType) {
    case 'weight': {
      // Round up to whole kilograms: a 1.25 kg parcel is charged as 2 kg,
      // which is how carriers bill it.
      const kg = Math.max(1, Math.ceil(request.weightG / 1000))
      return { amount: method.rate * kg, freeApplied: false }
    }
    case 'subtotal':
      return {
        amount: Math.floor((request.subtotal * method.rate) / 10000),
        freeApplied: false,
      }
    case 'flat':
    default:
      return { amount: method.rate, freeApplied: false }
  }
}

export function quoteMethods(
  methods: ShippingMethod[],
  zoneId: string,
  request: { subtotal: number; weightG: number },
): ShippingQuote[] {
  return methods
    .filter(
      (method) =>
        method.isActive &&
        method.zoneId === zoneId &&
        request.subtotal >= method.minSubtotal,
    )
    .sort((a, b) => a.position - b.position)
    .map((method) => {
      const priced = priceMethod(method, request)
      return {
        methodId: method.id,
        name: method.name,
        amount: priced.amount,
        deliveryTime: method.deliveryTime,
        freeApplied: priced.freeApplied,
      }
    })
}

/**
 * The whole quote: does anything need shipping, which zone applies, and
 * what can we offer.
 *
 * A basket with nothing shippable is `available: true` with no options —
 * not an error. Telling a digital-goods customer that delivery is
 * unavailable would be nonsense.
 */
export function quoteShipping(input: {
  zones: ShippingZone[]
  methods: ShippingMethod[]
  request: ShippingRequest
}): ShippingResult {
  const { zones, methods, request } = input

  if (!request.needsShipping) {
    return { available: true, reason: null, quotes: [] }
  }

  if (!request.country) {
    return {
      available: false,
      reason: 'Enter a delivery address to see options.',
      quotes: [],
    }
  }

  const { zone } = matchZone(zones, request)

  if (!zone) {
    return {
      available: false,
      reason: `We do not currently ship to ${request.country}.`,
      quotes: [],
    }
  }

  const quotes = quoteMethods(methods, zone.id, {
    subtotal: request.subtotal,
    weightG: request.weightG,
  })

  if (quotes.length === 0) {
    return {
      available: false,
      reason: 'No delivery option is available for this order.',
      quotes: [],
    }
  }

  return { available: true, reason: null, quotes }
}

/**
 * Pick the requested method, or the cheapest one when none was requested.
 *
 * Returns null when the requested method is gone. Falling back to a
 * different price without telling anyone is how a customer gets charged
 * more than the button they pressed.
 */
export function selectQuote(
  quotes: ShippingQuote[],
  methodId: string | null,
): ShippingQuote | null {
  if (quotes.length === 0) return null

  if (methodId) {
    return quotes.find((quote) => quote.methodId === methodId) ?? null
  }

  return quotes.reduce((cheapest, quote) => (quote.amount < cheapest.amount ? quote : cheapest))
}
