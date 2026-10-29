import { formatMinor } from '../../lib/api/client'
import { AppLink, ProductImage } from './Media'
import { FavButton } from './FavButton'
import type { CatalogueProduct } from '../../lib/catalogue'
import { Expand } from './Icons'

interface ProductCardProps {
  product: CatalogueProduct
  onQuickView: (product: CatalogueProduct) => void
  index?: number
}

const AVAILABILITY_NOTE: Record<string, string> = {
  available: '',
  'made-to-order': 'Made to order',
  'sold-out': 'Sold',
  enquire: 'By enquiry',
}

/**
 * PRODUCT CARD
 * ------------------------------------------------------------------
 * One piece in a grid. The whole card is a link to the product page; the
 * quick-view button is a separate control layered above it, so a click
 * never does the wrong thing on touch.
 *
 * The price line shows the "from" figure when options differ, and that
 * figure only counts options that can actually be bought — a sold-out
 * cheap size must not advertise the piece at a price nobody can pay.
 */
export function ProductCard({ product, onQuickView, index = 0 }: ProductCardProps) {
  const note = AVAILABILITY_NOTE[product.availability] ?? ''
  const price = formatMinor(product.fromPrice, product.currency, product.minorUnit)
  const hasRange = product.variants.some((v) => v.price !== product.fromPrice)

  return (
    <article className="card reveal" data-delay={(index % 3) + 1}>
      <div className="card__media">
        <AppLink href={`/collection/${product.slug}`} className="card__link" ariaLabel={product.name}>
          <ProductImage
            src={product.images[0] ?? ''}
            alt={`${product.name} — ${product.subtitle}`}
            ratio={4 / 5}
            sizes="(min-width: 1140px) 30vw, (min-width: 780px) 30vw, 46vw"
            priority={index < 3}
          />
        </AppLink>

        <div className="card__tools">
          <FavButton productId={product.id} productName={product.name} />
          <button
            type="button"
            className="fav-btn"
            onClick={() => onQuickView(product)}
            aria-label={`Quick view of ${product.name}`}
          >
            <Expand width={14} height={14} />
          </button>
        </div>

        {note && <span className="card__badge">{note}</span>}
      </div>

      <div className="card__body">
        <p className="card__glaze">{String(product.glaze).replace('-', ' ')}</p>

        <AppLink href={`/collection/${product.slug}`} className="card__link">
          <h3 className="card__name">{product.name}</h3>
        </AppLink>

        <p className="card__sub">{product.subtitle}</p>

        <div className="card__foot">
          <p className="card__price">
            {hasRange && 'From '}
            {price}
          </p>
          {note && <p className="card__status">{note}</p>}
        </div>
      </div>
    </article>
  )
}

export default ProductCard
