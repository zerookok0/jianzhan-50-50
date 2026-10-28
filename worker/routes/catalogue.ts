import { json } from '../lib/http.ts'
import { notFound } from '../lib/errors.ts'
import { Ctx, validate, str, int } from '../lib/validate.ts'
import * as productRepo from '../repositories/products.ts'
import type { Env } from '../env.ts'

/**
 * PUBLIC CATALOGUE ROUTES
 * ------------------------------------------------------------------
 * Read-only. Prices come from D1 in minor units and are serialised as
 * integers plus an explicit currency + minorUnit, so the client never has
 * to guess how to format them.
 */

export interface CategoryDto {
  id: string
  slug: string
  name: string
  description: string
}

export interface ImageDto {
  url: string
  alt: string
}

export interface VariantDto {
  id: string
  optionName: string
  optionValue: string
  price: number
  available: number | null
  inStock: boolean
}

export interface ProductDto {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  price: number
  currency: string
  minorUnit: number
  sku: string
  categoryId: string | null
  glaze: string | null
  year: string | null
  availability: string
  isFeatured: boolean
  requiresShipping: boolean
  weightG: number
  images: ImageDto[]
  variants: VariantDto[]
  inStock: boolean
  available: number | null
}

export interface ProductsResponse {
  products: ProductDto[]
  total: number
  page: number
  perPage: number
}

/** GET /api/v1/products */
export async function listProductsHandler(env: Env, url: URL): Promise<Response> {
  const params = validate((ctx: Ctx) => ({
    page: int(ctx, url.searchParams.get('page') ?? '1', 'page', { min: 1, max: 1000 }) ?? 1,
    perPage: int(ctx, url.searchParams.get('perPage') ?? '12', 'perPage', {
      min: 1,
      max: 60,
    }) ?? 12,
    category: str(ctx, url.searchParams.get('category'), 'category', { required: false, max: 140 }),
    search: str(ctx, url.searchParams.get('search'), 'search', { required: false, max: 140 }),
    sort: str(ctx, url.searchParams.get('sort'), 'sort', { required: false, max: 40 }),
    featured: url.searchParams.get('featured') === 'true',
  }))

  const orderBy = (() => {
    switch (params.sort) {
      case 'price-asc':
        return 'price_asc' as const
      case 'price-desc':
        return 'price_desc' as const
      case 'name':
        return 'name' as const
      default:
        return 'newest' as const
    }
  })()

  const { rows, total } = await productRepo.listProducts(env.DB, {
    status: 'active',
    categoryId: params.category || null,
    search: params.search || undefined,
    featured: params.featured,
    limit: params.perPage,
    offset: (params.page - 1) * params.perPage,
    orderBy,
  })

  const hydrated = await productRepo.hydrateMany(env.DB, rows)

  return json({
    products: hydrated.map(toProductDto),
    total,
    page: params.page,
    perPage: params.perPage,
  } satisfies ProductsResponse)
}

/** GET /api/v1/products/:slug */
export async function getProductHandler(env: Env, slug: string): Promise<Response> {
  const product = await productRepo.getProductBySlug(env.DB, slug)
  if (!product || product.status !== 'active') throw notFound('That piece could not be found.')
  return json({ product: toProductDto(product) })
}

/** GET /api/v1/categories */
export async function listCategoriesHandler(env: Env): Promise<Response> {
  const rows = await productRepo.listCategories(env.DB)
  return json({
    categories: rows.map(
      (c): CategoryDto => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
      }),
    ),
  })
}

/* ---------------- Mapping ---------------- */

export function toProductDto(p: productRepo.ProductWithRelations): ProductDto {
  const available = p.inventory
    ? p.inventory.is_tracked === 1
      ? Math.max(0, p.inventory.on_hand - p.inventory.reserved)
      : null
    : null

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    description: p.description,
    price: p.price,
    currency: p.currency,
    minorUnit: p.minor_unit,
    sku: p.sku ?? '',
    categoryId: p.category_id,
    glaze: p.glaze,
    year: p.year,
    availability: p.availability,
    isFeatured: p.is_featured === 1,
    requiresShipping: p.requires_shipping === 1,
    weightG: p.weight_g,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    variants: p.variants
      .filter((v) => v.is_active === 1)
      .map((v) => ({
        id: v.id,
        optionName: v.option_name,
        optionValue: v.option_value,
        price: v.price ?? p.price,
        available,
        inStock: available === null || available > 0,
      })),
    inStock: available === null ? p.availability !== 'sold-out' : available > 0,
    available,
  }
}
