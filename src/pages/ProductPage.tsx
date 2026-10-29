import { useState } from 'react'
import { getProduct, getRelated, getGlaze, formatPrice, availabilityLabels } from '../data/products'
import { useDocumentMeta, useReveal } from '../lib/hooks'
import { MediaImage, AppLink } from '../components/ui/Media'
import { BuyButton } from '../components/ui/BuyButton'
import { FavButton } from '../components/ui/FavButton'
import { Lightbox } from '../components/ui/Lightbox'
import { ProductCard } from '../components/ui/ProductCard'
import { ArrowRight, Expand } from '../components/ui/Icons'
import type { Product } from '../data/types'

interface ProductPageProps {
  slug: string
  onQuickView: (p: Product) => void
}

export function ProductPage({ slug, onQuickView }: ProductPageProps) {
  const product = getProduct(slug)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)

  useDocumentMeta(
    product ? `${product.name} — ${formatPrice(product.price, product.currency)} | JIANZHAN` : 'Piece not found | JIANZHAN',
    product?.description.slice(0, 155),
  )
  useReveal([slug])

  if (!product) {
    return (
      <div className="shell not-found-page">
        <p className="eyebrow">Not Found</p>
        <h1 className="display display--lg">This piece is no longer listed</h1>
        <p className="body">
          It may have been archived or moved. The current catalogue is the best place to look next.
        </p>
        <AppLink href="/collection" className="btn btn--outline">
          Back to the collection
        </AppLink>
      </div>
    )
  }

  const related = getRelated(product, 3)
  const glaze = getGlaze(product.glaze)

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
              <MediaImage
                image={product.images[activeImage]}
                alt={`${product.name} — ${product.subtitle}, view ${activeImage + 1}`}
                ratio={1}
                sizes="(min-width: 1024px) 52vw, 92vw"
                priority
                showFallbackNote
              />
              <span className="product-gallery__zoom" aria-hidden="true">
                <Expand width={14} height={14} /> Zoom
              </span>
            </button>
          </div>

          <div className="product-gallery__thumbs" role="tablist" aria-label="Product images">
            {product.images.map((im, i) => (
              <button
                key={im + i}
                type="button"
                role="tab"
                aria-selected={i === activeImage}
                aria-label={`Show image ${i + 1}`}
                className={`product-gallery__thumb ${i === activeImage ? 'is-active' : ''}`}
                onClick={() => setActiveImage(i)}
              >
                <MediaImage image={im} alt="" ratio={1} sizes="120px" />
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="product-info">
          <div className="product-info__head">
            <div>
              <p className="eyebrow">
                {availabilityLabels[product.availability]} · {product.year}
              </p>
              <h1 className="display display--lg product-info__title">{product.name}</h1>
              <p className="serif-italic product-info__sub">{product.subtitle}</p>
            </div>
            <FavButton productId={product.id} productName={product.name} />
          </div>

          <div className="product-info__price-row">
            <p className="product-info__price">{formatPrice(product.price, product.currency)}</p>
            <p className="meta">Demo price — not live</p>
          </div>

          <p className="body product-info__desc">{product.description}</p>

          <BuyButton product={product} />

          <div className="product-info__meta">
            <AppLink href={`/collection?glaze=${product.glaze}`} className="tag">
              {glaze?.name ?? product.glaze}
            </AppLink>
            <span className="tag">{product.category.replace('-', ' ')}</span>
            <span className="tag">Single firing</span>
          </div>

          {/* Specifications */}
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
              <summary>Dimensions & materials</summary>
              <div className="accordion__body">
                <ul className="dot-list">
                  {product.specifications.map((s) => (
                    <li key={s.label}>
                      <span>{s.label}</span>
                      <span>{s.value}</span>
                    </li>
                  ))}
                </ul>
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
                  Packed in a linen-wrapped box with a firing note. Shipping options, lead times and
                  duties are shown on the product page in our store at checkout — this site does not
                  calculate or process orders.
                </p>
              </div>
            </details>
          </div>

          <p className="product-info__disclaimer">
            All purchasing is completed on our WordPress store. This page is a presentation
            catalogue; prices and availability are illustrative demo data.
          </p>
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
        images={product.images}
        alts={product.images.map(
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
