import type { ImageKey } from './images'

/**
 * PRODUCT DATA — single source of truth
 * ------------------------------------------------------------------
 * Home, Collection, Quick View, glaze explorer and the product page all
 * read from this file. Nothing else defines a product.
 *
 * IMPORTANT — PURCHASING
 * This site never sells. Each product links out to its own WordPress /
 * WooCommerce URL. Set `purchaseUrl` per product (and per size variant
 * when the store uses separate URLs). Leave it `null` while unconfigured:
 * the UI then shows an explicit "not configured" notice instead of
 * guessing a fake URL.
 *
 * DEMO DATA: names, copy and prices below are illustrative placeholders,
 * not live stock or real pricing.
 */

export type Availability = 'available' | 'made-to-order' | 'sold-out' | 'enquire'

export type GlazeId = 'oil-spot' | 'hare-fur' | 'iridescent' | 'jade' | 'tea-dust'

export type CategoryId = 'tea-bowl' | 'vessel' | 'set'

export interface SpecItem {
  label: string
  value: string
}

export interface Variant {
  id: string
  label: string
  /** Display value for this option, e.g. 'Large'. Falls back to `label`. */
  optionValue?: string
  /** Price override in minor units, when this option costs differently. */
  price?: number
}

export interface Product {
  id: string
  slug: string
  name: string
  /** Short editorial line used in grids */
  subtitle: string
  description: string
  price: number
  currency: string
  images: ImageKey[]
  category: CategoryId
  glaze: GlazeId
  specifications: SpecItem[]
  /** Optional per-size options; when present the UI asks for a size first. */
  variants?: Variant[]
  featured: boolean
  availability: Availability
  year: string
}
