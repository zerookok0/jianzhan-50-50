import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiError, listProducts, type ApiProduct } from './api/client'
import { storeLive } from '../config/store'
import {
  products as staticProducts,
  glazes as staticGlazes,
  categories as staticCategories,
  type Glaze,
} from '../data/products'
import { img } from '../data/images'
import type {
  Availability,
  CategoryId,
  GlazeId,
  Product as StaticProduct,
} from '../data/types'

/**
 * LIVE CATALOGUE
 * ------------------------------------------------------------------
 * THE ONE PLACE THE STOREFRONT GETS PRODUCTS FROM.
 *
 * Why this file exists: every page used to import `src/data/products.ts`
 * directly. That file is a lookbook — it has no inventory, no variant
 * stock and no server prices. So the buy button could never be correct,
 * because the product it was handed had never been near the database.
 *
 * The rules this enforces:
 *
 *   1. In `live` mode the catalogue comes from GET /api/v1/products, in
 *      minor units, with the server's own currency and stock.
 *
 *   2. `src/data/products.ts` survives as an offline fallback and as the
 *      editorial source for specifications (diameter, capacity, firing)
 *      that the database does not store. It is never the price source.
 *
 *   3. Components receive one normalised shape, so no component has to
 *      know whether a product arrived over the network or from the file.
 *
 * Prices are ALWAYS integers in minor units plus an explicit currency and
 * minorUnit. Nothing multiplies or rounds here beyond display.
 */

/* ---------------- Normalised shape ---------------- */

export interface CatalogueVariant {
  id: string
  /** e.g. "Small — 12.6 cm". Already human-readable from the server. */
  label: string
  optionName: string
  optionValue: string
  /** Minor units. */
  price: number
  available: number | null
  inStock: boolean
}

export interface CatalogueProduct {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  /** Minor units — the parent price. */
  price: number
  /** Lowest purchasable price, for "from" display when options differ. */
  fromPrice: number
  currency: string
  minorUnit: number
  sku: string
  /** Absolute URLs, ready for <img>. */
  images: string[]
  category: CategoryId | string
  glaze: GlazeId | string
  year: string
  availability: Availability
  featured: boolean
  variants: CatalogueVariant[]
  inStock: boolean
  available: number | null
  specifications: { label: string; value: string }[]
  /** Where this record came from — surfaced only when the API failed. */
  source: 'api' | 'static'
}

/* ---------------- Editorial supplements ---------------- */

/** Specifications the database does not model, keyed by slug. */
const SPECS_BY_SLUG = new Map(staticProducts.map((p) => [p.slug, p.specifications]))

/* ---------------- Mapping ---------------- */

function normaliseAvailability(raw: string, inStock: boolean): Availability {
  // Enquiry-only is a deliberate state, not a stock failure: a piece with
  // zero units that is sold by conversation must not read as "sold out".
  if (raw === 'enquire') return 'enquire'
  if (raw === 'sold-out') return 'sold-out'
  // Made-to-order is ALSO not a stock failure, but it is not "available"
  // either — a customer needs to know the piece is made after ordering.
  // Collapsing it to `available` was misleading, and hid the lead time.
  if (raw === 'made-to-order') return 'made-to-order'
  if (!inStock) return 'sold-out'
  return 'available'
}

function fromApi(p: ApiProduct): CatalogueProduct {
  const variants: CatalogueVariant[] = p.variants.map((v) => ({
    id: v.id,
    label: v.optionValue || v.optionName,
    optionName: v.optionName,
    optionValue: v.optionValue,
    price: v.price,
    available: v.available,
    inStock: v.inStock,
  }))

  /**
   * "From" must reflect what can actually be bought. Taking the minimum
   * over every option let a sold-out cheap size advertise the product as
   * cheaper than any selectable price — the grid said $640 while the only
   * buyable option was $740.
   */
  const buyablePrices = variants.filter((v) => v.inStock).map((v) => v.price)
  const variantPrices = buyablePrices.length ? buyablePrices : variants.map((v) => v.price)
  const fromPrice = variantPrices.length ? Math.min(...variantPrices) : p.price

  const specs =
    SPECS_BY_SLUG.get(p.slug) ??
    [
      { label: 'Weight', value: `${p.weightG} g` },
      { label: 'Reference', value: p.sku },
      { label: 'Firing', value: 'Wood-fired' },
    ].filter((s) => Boolean(s.value))

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    description: p.description,
    price: p.price,
    fromPrice,
    currency: p.currency,
    minorUnit: p.minorUnit,
    sku: p.sku,
    images: p.images.map((i) => i.url),
    category: p.categoryId ?? 'tea-bowl',
    glaze: p.glaze ?? 'oil-spot',
    year: p.year ?? '',
    availability: normaliseAvailability(p.availability, p.inStock),
    featured: p.isFeatured,
    variants,
    inStock: p.inStock,
    available: p.available,
    specifications: specs,
    source: 'api',
  }
}

function fromStatic(p: StaticProduct): CatalogueProduct {
  const variants: CatalogueVariant[] = (p.variants ?? []).map((v) => ({
    id: v.id,
    label: v.optionValue ?? v.label,
    optionName: 'Size',
    optionValue: v.optionValue ?? v.label,
    // The static file stores whole currency units; normalise to minor.
    price: Math.round((v.price ?? p.price) * 100),
    available: null,
    inStock: true,
  }))

  const price = Math.round(p.price * 100)
  const variantPrices = variants.map((v) => v.price)

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    description: p.description,
    price,
    fromPrice: variantPrices.length ? Math.min(...variantPrices) : price,
    currency: p.currency,
    minorUnit: 2,
    sku: '',
    images: p.images.map((key) => img(key, 1200)),
    category: p.category,
    glaze: p.glaze,
    year: p.year,
    availability: p.availability,
    featured: p.featured,
    variants,
    inStock: p.availability !== 'sold-out' && p.availability !== 'enquire',
    available: null,
    specifications: p.specifications,
    source: 'static',
  }
}

const STATIC_CATALOGUE: CatalogueProduct[] = staticProducts.map(fromStatic)

/* ---------------- Context ---------------- */

export interface CatalogueState {
  products: CatalogueProduct[]
  glazes: Glaze[]
  categories: { id: CategoryId; label: string }[]
  loading: boolean
  /** Human-readable reason the live catalogue could not be loaded. */
  error: string | null
  source: 'api' | 'static'
  refresh: () => Promise<void>
  bySlug: (slug: string) => CatalogueProduct | undefined
  related: (product: CatalogueProduct, count?: number) => CatalogueProduct[]
}

const CatalogueContext = createContext<CatalogueState | null>(null)

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const live = storeLive()

  const [products, setProducts] = useState<CatalogueProduct[]>(
    live ? [] : STATIC_CATALOGUE,
  )
  const [loading, setLoading] = useState(live)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'api' | 'static'>(
    live ? 'api' : 'static',
  )

  const refresh = useCallback(async () => {
    if (!live) {
      setProducts(STATIC_CATALOGUE)
      setSource('static')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // One read for the whole storefront. The catalogue is small and a
      // consistent snapshot is worth more than per-page requests.
      const { products: rows, total } = await listProducts({ perPage: 60 })
      if (rows.length === 0 && total === 0) {
        setError('The store has no published pieces yet.')
        setProducts([])
        setSource('api')
        return
      }
      setProducts(rows.map(fromApi))
      setSource('api')
      setError(null)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'The store could not be reached.'
      setError(message)
      // An offline catalogue beats a blank page, but it is flagged so the
      // UI never claims these prices are live.
      setProducts(STATIC_CATALOGUE)
      setSource('static')
    } finally {
      setLoading(false)
    }
  }, [live])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const bySlug = useCallback(
    (slug: string) => products.find((p) => p.slug === slug),
    [products],
  )

  const related = useCallback(
    (product: CatalogueProduct, count = 3) =>
      products
        .filter((p) => p.id !== product.id)
        .map((p) => ({
          p,
          score: (p.glaze === product.glaze ? 2 : 0) + (p.featured ? 1 : 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map((entry) => entry.p),
    [products],
  )

  const value = useMemo<CatalogueState>(
    () => ({
      products,
      glazes: staticGlazes,
      categories: staticCategories,
      loading,
      error,
      source,
      refresh,
      bySlug,
      related,
    }),
    [products, loading, error, source, refresh, bySlug, related],
  )

  return (
    <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>
  )
}

export function useCatalogue(): CatalogueState {
  return (
    useContext(CatalogueContext) ?? {
      products: STATIC_CATALOGUE,
      glazes: staticGlazes,
      categories: staticCategories,
      loading: false,
      error: null,
      source: 'static',
      refresh: async () => {},
      bySlug: (slug: string) => STATIC_CATALOGUE.find((p) => p.slug === slug),
      related: () => [],
    }
  )
}

/** The piece this route shows, plus whether the catalogue is still loading. */
export function useCatalogueProduct(slug: string): {
  product: CatalogueProduct | undefined
  loading: boolean
  error: string | null
} {
  const { bySlug, loading, error } = useCatalogue()
  return { product: bySlug(slug), loading, error }
}
