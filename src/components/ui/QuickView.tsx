import { useEffect, useState } from 'react'
import type { Product } from '../../data/types'
import { formatPrice, availabilityLabels } from '../../data/products'
import { site } from '../../data/site'
import { Modal } from './Modal'
import { MediaImage, AppLink } from './Media'
import { FavButton } from './FavButton'
import { BuyButton } from './BuyButton'
import { Close } from './Icons'

interface QuickViewProps {
  product: Product | null
  onClose: () => void
}

export function QuickView({ product, onClose }: QuickViewProps) {
  const [active, setActive] = useState(0)

  // Reset the previewed image whenever a different piece is opened.
  useEffect(() => {
    setActive(0)
  }, [product?.id])

  if (!product) return null
  const images = product.images

  return (
    <Modal open={Boolean(product)} onClose={onClose} labelledBy="qv-title" variant="center">
      <div className="qv">
        <button type="button" className="qv__close" onClick={onClose} aria-label="Close quick view">
          <Close width={16} height={16} />
        </button>

        <div className="qv__media">
          <MediaImage
            image={images[Math.min(active, images.length - 1)]}
            alt={`${product.name} — detail ${active + 1}`}
            ratio={1}
            sizes="(min-width: 900px) 40vw, 92vw"
            showFallbackNote
          />
          {images.length > 1 && (
            <div className="qv__thumbs" role="tablist" aria-label="Product images">
              {images.map((im, i) => (
                <button
                  key={im + i}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Image ${i + 1}`}
                  className={`qv__thumb ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <MediaImage image={im} alt="" ratio={1} sizes="80px" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="qv__body">
          <p className="eyebrow">{availabilityLabels[product.availability]} · {product.year}</p>
          <h2 id="qv-title" className="display display--md qv__title">
            {product.name}
          </h2>
          <p className="qv__sub serif-italic">{product.subtitle}</p>
          <p className="qv__price">{formatPrice(product.price, product.currency)}</p>
          <p className="body qv__desc">{product.description}</p>

          <dl className="specs specs--compact">
            {product.specifications.slice(0, 4).map((s) => (
              <div key={s.label} className="specs__row">
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>

          <BuyButton product={product} label="Buy on our store" onNavigate={onClose} />

          <div className="qv__foot">
            <FavButton productId={product.id} productName={product.name} variant="labelled" />
            <AppLink href={`/collection/${product.slug}`} className="btn btn--link qv__detail" onClick={onClose}>
              Full details
            </AppLink>
          </div>

          <p className="qv__data-note">Demo catalogue · {site.brand} — prices illustrative only.</p>        </div>
      </div>
    </Modal>
  )
}
