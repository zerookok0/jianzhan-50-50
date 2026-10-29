import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { ProductImage, AppLink } from './Media'
import { BuyButton } from './BuyButton'
import { formatMinor } from '../../lib/api/client'
import type { CatalogueProduct } from '../../lib/catalogue'

interface QuickViewProps {
  product: CatalogueProduct | null
  onClose: () => void
}

/**
 * QUICK VIEW
 * ------------------------------------------------------------------
 * A short, fast look at a piece without leaving the grid.
 *
 * It deliberately does not duplicate the product page: no specification
 * table, no accordions, no related pieces. Those belong to the full page,
 * and reproducing them here would make the panel as heavy as the page it
 * is meant to save you from visiting.
 *
 * The buy control is the real one, so adding from here carries the same
 * server checks as adding from anywhere else.
 */
export function QuickView({ product, onClose }: QuickViewProps) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive(0)
  }, [product?.id])

  if (!product) return null

  const images = product.images.length ? product.images : ['']

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      label={`${product.name} quick view`}
      variant="center"
      labelledBy="qv-title"
    >
      <div className="qv">
        <div className="qv__media">
          <ProductImage
            src={images[active]}
            alt={`${product.name} — ${product.subtitle}`}
            ratio={1}
            sizes="(min-width: 860px) 46vw, 92vw"
            priority
          />

          {images.length > 1 && (
            <div className="qv__thumbs" role="tablist" aria-label="Piece images">
              {images.slice(0, 4).map((image, i) => (
                <button
                  key={`${image}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Show image ${i + 1}`}
                  className={`qv__thumb ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <ProductImage src={image} alt="" ratio={1} sizes="90px" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="qv__body">
          <p className="eyebrow">
            {String(product.glaze).replace('-', ' ')}
            {product.year ? ` · ${product.year}` : ''}
          </p>

          <h2 className="display display--md qv__title" id="qv-title">
            {product.name}
          </h2>

          <p className="serif-italic qv__sub">{product.subtitle}</p>

          <p className="qv__price">
            {product.variants.length > 1 && product.fromPrice !== product.price ? 'From ' : ''}
            {formatMinor(product.fromPrice, product.currency, product.minorUnit)}
          </p>

          <p className="body qv__desc">{product.description}</p>

          <BuyButton product={product} compact />

          <div className="qv__foot">
            <AppLink
              href={`/collection/${product.slug}`}
              className="btn btn--link qv__detail"
              onClick={onClose}
            >
              Full details
            </AppLink>
            <span className="qv__data-note">
              {product.source === 'api' ? 'Live stock' : 'Offline catalogue'}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default QuickView
