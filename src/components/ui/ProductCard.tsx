import type { CatalogueProduct } from '../../lib/catalogue'
import { formatMinor } from '../../lib/api/client'
import { AppLink, ProductImage } from './Media'
import { FavButton } from './FavButton'
import { Expand } from './Icons'

/**
 * PRODUCT CARD
 * ------------------------------------------------------------------
 * One piece, one card. The whole card is a link; the quick-view and save
 * buttons sit above it and stop propagation, so they never trigger
 * navigation by accident.
 *
 * There is no "add to cart" here on purpose: a piece has to be seen at
 * full size first. Adding from a grid is how people buy the wrong bowl.
 *
 * Prices arrive in minor units from the API and are only formatted here.
 */

interface ProductCardProps {
  product: CatalogueProduct
  onQuickView?: (product: CatalogueProduct) => void
  index?: number
}

/** Short status word for the badge, derived from live stock. */
function badgeFor(product: CatalogueProduct): string | null {
  if (product.availability === 'sold-out') return 'Sold — archive'
  if (product.availability === 'enquire') return 'Enquire'
  if (product.availability === 'made-to-order') return 'Made to order'
  if (!product.inStock) return 'Sold out'
  return null
}

export function ProductCard({ product, onQuickView, index = 0 }: ProductCardProps) {
  const badge = badgeFor(product)
  const image = product.images[0]

  return (
    <article className="card reveal" data-delay={(index % 3) + 1}>
      <div className="card__media">
        <AppLink
          href={`/collection/${product.slug}`}
          className="card__link"
          ariaLabel={`${product.name} — view details`}
        >
          <ProductImage
            src={image}
            alt={`${product.name} — ${product.subtitle}`}
            ratio={4 / 5}
            sizes="(min-width: 780px) 32vw, 46vw"
          />
        </AppLink>

        <div className="card__tools">
          {onQuickView && (
            <button
              type="button"
              className="fav-btn"
              onClick={() => onQuickView(product)}
              aria-label={`Quick view of ${product.name}`}
            >
              <Expand width={15} height={15} />
            </button>
          )}
          <FavButton productId={product.id} productName={product.name} />
        </div>

        {badge && <span className="card__badge">{badge}</span>}
      </div>

      <div className="card__body">
        <p className="card__glaze">{product.glaze.replace('-', ' ')}</p>

        <AppLink href={`/collection/${product.slug}`} className="card__link">
          <h3 className="card__name">{product.name}</h3>
        </AppLink>

        <p className="card__sub">{product.subtitle}</p>

        <div className="card__foot">
          <p className="card__price">
            {product.variants.length > 1 && product.fromPrice !== product.price ? 'From ' : ''}
            {formatMinor(product.fromPrice, product.currency, product.minorUnit)}
          </p>
          <p className="card__status">{product.year}</p>
        </div>
      </div>
    </article>
  )
}
