import type { Product } from '../data/types'
import { site } from '../data/site'

/**
 * Purchase URL resolution
 * ------------------------------------------------------------------
 * 1. Per-variant URL (if the store uses separate URLs per size)
 * 2. Product-level purchaseUrl
 * 3. Derived from site.shopBaseUrl + slug (only when enabled)
 * Otherwise: null → the UI shows a "not configured" notice.
 *
 * Never invent a URL here.
 */
export function resolvePurchaseUrl(product: Product, variantId?: string): string | null {
  if (variantId) {
    const variant = product.variants?.find((v) => v.id === variantId)
    if (variant?.purchaseUrl) return sanitize(variant.purchaseUrl)
  }

  // If variants exist but none has a URL, fall back to the product link.
  if (product.purchaseUrl) return sanitize(product.purchaseUrl)

  if (site.autoDerivePurchaseUrl && site.shopBaseUrl) {
    return `${site.shopBaseUrl.replace(/\/$/, '')}/product/${product.slug}/`
  }

  return null
}

function sanitize(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '#'
  } catch {
    return '#'
  }
}

export function isExternalUrl(url: string | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.origin !== window.location.origin
  } catch {
    return false
  }
}
