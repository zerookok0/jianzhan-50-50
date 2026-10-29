import type { Product } from '../../data/types'
import { formatPrice, availabilityLabels } from '../../data/products'
import { AppLink } from './Media'
import { MediaImage } from './Media'
import { FavButton } from './FavButton'
import { Expand } from './Icons'

interface ProductCardProps {
  product: Product
  onQuickView: (product: Product) => void
  index?: number
}

/**
 * Editorial product card — image, glaze line, name, price.
 * Hovering reveals a low-key quick view affordance (not a loud overlay).
 */
export function ProductCard({ product, onQuickView, index = 0 }: ProductCardProps) {
  const href = `/collection/${product.slug}`
  const soldOut = product.availability === 'sold-out'

  return (
    <article className="card reveal" data-delay={(index % 3) + 1}>
      <div className="card__media">
        <AppLink href={href} ariaLabel={`View ${product.name}`}>
          <MediaImage
            image={product.images[0]}
            alt={`${product.name} — ${product.subtitle}`}
            ratio={4 / 5}
            sizes="(min-width: 1200px) 30vw, (min-width: 768px) 45vw, 92vw"
            showFallbackNote
          />
        </AppLink>

        <div className="card__tools">
          <FavButton productId={product.id} productName={product.name} />
          <button
            type="button"
            className="icon-btn"
            onClick={() => onQuickView(product)}
            aria-label={`Quick view: ${product.name}`}
          >
            <Expand width={14} height={14} />
          </button>
        </div>

        {soldOut && <span className="card__badge">Archive</span>}
      </div>

      <div className="card__body">
        <AppLink href={href} className="card__link">
          <p className="card__glaze">{product.year} · {product.glaze.replace('-', ' ')}</p>
          <h3 className="card__name">{product.name}</h3>
        </AppLink>
        <p className="card__sub">{product.subtitle}</p>
        <div className="card__foot">
          <span className="card__price">{formatPrice(product.price, product.currency)}</span>
          <span className="card__status">{availabilityLabels[product.availability]}</span>
        </div>
      </div>
    </article>
  )
}
