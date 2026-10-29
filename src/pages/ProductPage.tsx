import { useEffect, useState } from 'react'
import { useCatalogueProduct, useCatalogue } from '../lib/catalogue'
import { formatMinor } from '../lib/api/client'
import { useDocumentMeta, useReveal } from '../lib/hooks'
import { ProductImage, AppLink } from '../components/ui/Media'
import { BuyButton } from '../components/ui/BuyButton'
import { FavButton } from '../components/ui/FavButton'
import { Lightbox } from '../components/ui/Lightbox'
import { ProductCard } from '../components/ui/ProductCard'
import { ArrowRight, Expand } from '../components/ui/Icons'
import type { CatalogueProduct } from '../lib/catalogue'

interface ProductPageProps {
  slug: string
  onQuickView: (p: CatalogueProduct) => void
}

const AVAILABILITY_LABEL: Record<string, string> = {
  available: 'Available',
  'made-to-order': 'Made to order',
  'sold-out': 'Sold — archive',
  enquire: 'Enquire',
}

export function ProductPage({ slug, onQuickView }: ProductPageProps) {
  const { product, loading, error } = useCatalogueProduct(slug)
  const { related: getRelated } = useCatalogue()

  const [lightbox, setLightbox] = useState<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)

  useDocumentMeta(
    product
      ? `${product.name} — ${formatMinor(product.price, product.currency, product.minorUnit)} | JIANZHAN`
      : 'Piece not found | JIANZHAN',
    product?.description.slice(0, 155),
  )
  useReveal([slug, product?.id])

  // A new slug means a new gallery; without this the lightbox could open
  // on an index the previous product had but this one does not.
  useEffect(() => {
    setActiveImage(0)
    setLightbox(null)
  }, [slug])

  /* ---- Still loading the live catalogue ---- */

  if (loading && !product) {
    return (
      <div className="shell not-found-page" aria-busy="true">
        <p className="eyebrow">Loading</p>
        <h1 className="display display--lg">Fetching this piece…</h1>
        <p className="body">Reading the latest price and stock from our store.</p>
      </div>
    )
  }

  /* ---- Not in the catalogue ---- */

  if (!product) {
    return (
      <div className="shell not-found-page">
        <p className="eyebrow">Not Found</p>
        <h1 className="display display--lg">This piece is no longer listed</h1>
        <p className="body">
          {error
            ? 'The store could not be reached, so this page cannot show live stock or pricing.'
            : 'It may have been archived or sold. The current catalogue is the best place to look next.'}
        </p>
        <AppLink href="/collection" className="btn btn--outline">
          Back to the collection
        </AppLink>
      </div>
    )
  }

  const related = getRelated(product, 3)
  const status = AVAILABILITY_LABEL[product.availability] ?? product.availability
  const images = product.images.length ? product.images : ['']

  return (
    <div className="product-page" key={product.id}>
      {/* Breadcrumb */}
      <nav className="breadcrumb shell" aria-label="Breadcrumb">
        <AppLink href="/">Home</AppLink>
        <span aria-hidden="true">/</span>
        <AppLink href="/collection">Collection</AppLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="shell product-layout">
        {/* Gallery */}
        <div className="product-gallery">
          <div className="product-gallery__main">
            <button
              type="button"
              className="product-gallery__open"
              onClick={() => setLightbox(activeImage)}
              aria-label={`Open ${product.name} image ${activeImage + 1} full screen`}
            >
              <ProductImage
                src={images[activeImage]}
                alt={`${product.name} — ${product.subtitle}, view ${activeImage + 1}`}
                ratio={1}
                sizes="(min-width: 1024px) 52vw, 92vw"
                priority
              />
              <span className="product-gallery__zoom" aria-hidden="true">
                <Expand width={14} height={14} /> Zoom
              </span>
            </button>
          </div>

          {images.length > 1 && (
            <div className="product-gallery__thumbs" role="tablist" aria-label="Product images">
              {images.map((im, i) => (
                <button
                  key={`${im}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === activeImage}
                  aria-label={`Show image ${i + 1}`}
                  className={`product-gallery__thumb ${i === activeImage ? 'is-active' : ''}`}
                  onClick={() => setActiveImage(i)}
                >
                  <ProductImage src={im} alt="" ratio={1} sizes="120px" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="product-info">
          <div className="product-info__head">
            <div>
              <p className="eyebrow">
                {status}
                {product.year ? ` · ${product.year}` : ''}
              </p>
              <h1 className="display display--lg product-info__title">{product.name}</h1>
              <p className="serif-italic product-info__sub">{product.subtitle}</p>
            </div>
            <FavButton productId={product.id} productName={product.name} />
          </div>

          <div className="product-info__price-row">
            <p className="product-info__price">
              {product.variants.length > 1 && product.fromPrice !== product.price ? 'From ' : ''}
              {formatMinor(product.fromPrice, product.currency, product.minorUnit)}
            </p>
            <p className="meta">
              {product.source === 'api' ? 'Live price · server confirmed' : 'Offline price'}
            </p>
          </div>

          <p className="body product-info__desc">{product.description}</p>

          {/* The purchase boundary. The server owns the price from here. */}
          <BuyButton product={product} />

          <div className="product-info__meta">
            <AppLink href={`/collection?glaze=${product.glaze}`} className="tag">
              {product.glaze.replace('-', ' ')}
            </AppLink>
            <span className="tag">{String(product.category).replace('-', ' ')}</span>
            {product.sku && <span className="tag">{product.sku}</span>}
          </div>

          {/* Specifications */}
          {product.specifications.length > 0 && (
            <section className="product-specs" aria-labelledby="specs-title">
              <h2 id="specs-title" className="eyebrow">
                Specifications
              </h2>
              <dl className="specs">
                {product.specifications.map((s) => (
                  <div key={s.label} className="specs__row">
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Accordions */}
          <div className="accordions">
            <details className="accordion" open>
              <summary>The making</summary>
              <div className="accordion__body">
                <p>
                  Thrown by hand on the wheel, dried slowly, then glazed and fired in a wood kiln.
                  The final surface depends on how heat and ash moved through the chamber and on the
                  pace of cooling afterwards — factors the maker guides but does not control.
                </p>
              </div>
            </details>

            <details className="accordion">
              <summary>Care</summary>
              <div className="accordion__body">
                <p>
                  Hand wash with warm water and a soft cloth. Avoid abrasive pads and sudden
                  temperature change. Dry fully, upside down, before storing. Fine crackles and a
                  deepening of colour with use are normal.
                </p>
              </div>
            </details>

            <details className="accordion">
              <summary>Shipping</summary>
              <div className="accordion__body">
                <p>
                  Packed in a linen-wrapped box with a firing note. Delivery options and duties are
                  calculated by our store at checkout, once the destination is known.
                </p>
              </div>
            </details>
          </div>

          <p className="product-info__disclaimer">
            {product.source === 'api'
              ? 'Price, stock and totals are calculated by our store — this page displays them but never computes them.'
              : 'The store could not be reached, so this page is showing an offline record. Prices are not live and purchasing is unavailable until it reconnects.'}
          </p>

          {product.source === 'static' && (
            <p className="buy__notice" role="status">
              Offline catalogue — reconnect the store to buy this piece.
            </p>
          )}
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="section related" aria-labelledby="related-title">
          <div className="shell">
            <header className="section-head">
              <div>
                <p className="eyebrow">Continue</p>
                <h2 id="related-title" className="display display--md">
                  Related works
                </h2>
              </div>
              <AppLink href="/collection" className="btn section-head__link">
                All pieces
                <ArrowRight width={16} height={16} className="btn__arrow" />
              </AppLink>
            </header>
            <div className="card-grid">
              {related.map((p, i) => (
                <ProductCard key={p.id} product={p} onQuickView={onQuickView} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Lightbox
        images={images}
        alts={images.map(
          (_, i) => `${product.name} — ${product.subtitle}, view ${i + 1}`,
        )}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onIndexChange={(i) => {
          setLightbox(i)
          setActiveImage(i)
        }}
      />
    </div>
  )
}
