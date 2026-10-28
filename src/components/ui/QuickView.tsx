import { useEffect, useRef, useState } from 'react'
import type { CatalogueProduct } from '../../lib/catalogue'
import { formatMinor } from '../../lib/api/client'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { ProductImage, AppLink } from './Media'
import { FavButton } from './FavButton'
import { Close, ArrowRight } from './Icons'

/**
 * QUICK VIEW
 * ------------------------------------------------------------------
 * A preview, not a second product page. It shows enough to decide whether
 * to open the full page — and it deliberately does not sell. Adding to a
 * cart from a grid is how people buy the wrong piece.
 *
 * Focus is moved into the dialog on open and returned to the trigger on
 * close; Escape and a scrim click both dismiss.
 *
 * Every figure here comes from the catalogue record, which in live mode
 * is the API's own answer in minor units. The "demo" wording is derived
 * from where that record came from, not hard-coded.
 */

interface QuickViewProps {
  product: CatalogueProduct | null
  onClose: () => void
}

/** Human words for the availability state, shared by the dialog. */
const AVAILABILITY_LABEL: Record<string, string> = {
  available: 'Available',
  'made-to-order': 'Made to order',
  'sold-out': 'Sold — archive',
  enquire: 'Enquire',
}

export function QuickView({ product, onClose }: QuickViewProps) {
  const [active, setActive] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  const open = product !== null

  useScrollLock(open)
  useEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    setActive(0)
    previouslyFocused.current = document.activeElement as HTMLElement
    const t = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 40)
    return () => {
      window.clearTimeout(t)
      previouslyFocused.current?.focus?.({ preventScroll: true })
    }
  }, [open, product?.id])

  if (!product) return null

  const images = product.images.length ? product.images : [undefined]
  const status = AVAILABILITY_LABEL[product.availability] ?? product.availability

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qv-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <div className="qv">
          <button type="button" className="qv__close" onClick={onClose} aria-label="Close preview">
            <Close width={18} height={18} />
          </button>

          <div className="qv__media">
            <ProductImage
              src={images[active]}
              alt={`${product.name} — ${product.subtitle}`}
              ratio={1}
              sizes="(min-width: 860px) 48vw, 100vw"
              priority
            />

            {images.length > 1 && (
              <div className="qv__thumbs" role="tablist" aria-label="Preview images">
                {images.map((im, i) => (
                  <button
                    key={`${im ?? 'image'}-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={i === active}
                    aria-label={`Show image ${i + 1}`}
                    className={`qv__thumb ${i === active ? 'is-active' : ''}`}
                    onClick={() => setActive(i)}
                  >
                    <ProductImage src={im} alt="" ratio={1} sizes="90px" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="qv__body">
            <p className="eyebrow">
              {status}
              {product.year ? ` · ${product.year}` : ''}
            </p>

            <h2 id="qv-title" className="display display--md qv__title">
              {product.name}
            </h2>

            <p className="serif-italic qv__sub">{product.subtitle}</p>

            <p className="qv__price">
              {product.variants.length > 1 && product.fromPrice !== product.price ? 'From ' : ''}
              {formatMinor(product.fromPrice, product.currency, product.minorUnit)}
            </p>

            <p className="body qv__desc">{product.description}</p>

            <dl className="specs specs--compact">
              {product.specifications.slice(0, 4).map((s) => (
                <div key={s.label} className="specs__row">
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>

            <div className="qv__foot">
              <AppLink
                href={`/collection/${product.slug}`}
                className="btn btn--solid"
                onClick={onClose}
              >
                Full details
                <ArrowRight width={15} height={15} className="btn__arrow" />
              </AppLink>

              <FavButton
                productId={product.id}
                productName={product.name}
                variant="labelled"
              />
            </div>

            <p className="qv__data-note">
              {product.glaze.replace('-', ' ')}
              {product.sku ? ` · ${product.sku}` : ''} ·{' '}
              {product.source === 'api'
                ? 'Live stock and price from our store'
                : 'Offline catalogue — the store could not be reached'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
