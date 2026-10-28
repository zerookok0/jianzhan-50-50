import { useEffect, useMemo, useState } from 'react'
import { useCatalogue } from '../lib/catalogue'
import { formatMinor } from '../lib/api/client'
import { useDocumentMeta, useReveal, useRoute } from '../lib/hooks'
import { ProductCard } from '../components/ui/ProductCard'
import { MediaImage } from '../components/ui/Media'
import { visual } from '../styles/visual'
import { Close } from '../components/ui/Icons'
import type { CatalogueProduct } from '../lib/catalogue'

type SortKey = 'curated' | 'price-asc' | 'price-desc' | 'newest'

interface CollectionProps {
  onQuickView: (p: CatalogueProduct) => void
}

const PAGE = 9

export function Collection({ onQuickView }: CollectionProps) {
  useDocumentMeta(
    'Collection — Jian Ware Tea Bowls & Vessels | JIANZHAN',
    'Browse the JIANZHAN collection of Jian ware tea bowls and vessels: oil spot, hare’s fur, iridescent and jade glazes. Filter by glaze and category and buy directly from the studio.',
  )
  useReveal()

  const { products, glazes, categories, loading, error, source } = useCatalogue()
  const route = useRoute()

  const [glazeFilter, setGlazeFilter] = useState<string | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('curated')
  const [visible, setVisible] = useState(PAGE)
  const [filtersOpen, setFiltersOpen] = useState(false)

  /* Honour ?glaze= from the home page explorer */
  useEffect(() => {
    const g = route.query.get('glaze')
    if (g && glazes.some((gl) => gl.id === g)) setGlazeFilter(g)
  }, [route.query, glazes])

  const filtered = useMemo(() => {
    const list = products.filter(
      (p) =>
        (glazeFilter === 'all' || p.glaze === glazeFilter) &&
        (categoryFilter === 'all' || p.category === categoryFilter),
    )
    switch (sort) {
      case 'price-asc':
        return [...list].sort((a, b) => a.fromPrice - b.fromPrice)
      case 'price-desc':
        return [...list].sort((a, b) => b.fromPrice - a.fromPrice)
      case 'newest':
        return [...list].sort((a, b) => Number(b.year) - Number(a.year))
      default:
        return [...list].sort((a, b) => Number(b.featured) - Number(a.featured))
    }
  }, [products, glazeFilter, categoryFilter, sort])

  const shown = filtered.slice(0, visible)
  const activeCount = (glazeFilter === 'all' ? 0 : 1) + (categoryFilter === 'all' ? 0 : 1)

  const cheapest = useMemo(
    () => (products.length ? Math.min(...products.map((p) => p.fromPrice)) : 0),
    [products],
  )
  const currency = products[0]?.currency ?? 'USD'
  const minorUnit = products[0]?.minorUnit ?? 2

  const reset = () => {
    setGlazeFilter('all')
    setCategoryFilter('all')
    setSort('curated')
    setVisible(PAGE)
  }

  return (
    <div className="collection-page">
      <header className="collection-hero" aria-labelledby="collection-title">
        <div className="collection-hero__media" aria-hidden="true">
          <img src={visual.collectionHero} alt="" fetchPriority="high" decoding="async" />
        </div>
        <div className="shell collection-hero__inner">
          <p className="eyebrow reveal">The Collection</p>
          <h1 id="collection-title" className="display display--lg collection-hero__title reveal" data-delay="1">
            Works in clay,
            <br />
            fire and glaze
          </h1>
          <p className="lede reveal" data-delay="2">
            A working catalogue of Jian ware pieces. Each bowl is fired individually; surfaces differ
            from piece to piece and cannot be reordered to specification.
          </p>
          <dl className="collection-hero__facts reveal" data-delay="3">
            <div>
              <dt>Pieces</dt>
              <dd>{loading ? '—' : products.length}</dd>
            </div>
            <div>
              <dt>Glaze families</dt>
              <dd>{glazes.length}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{products.length ? formatMinor(cheapest, currency, minorUnit) : '—'}</dd>
            </div>
          </dl>

          {/* Honest provenance line — never claims live stock it does not have. */}
          <p className="collection-hero__demo">
            {loading
              ? 'Reading live stock and prices from our store…'
              : source === 'api'
                ? 'Live stock and pricing from our store'
                : 'Offline catalogue · prices not live'}
          </p>
        </div>
      </header>

      <div className="shell collection-body">
        <div className="collection-toolbar">
          <button
            type="button"
            className="chip collection-toolbar__toggle"
            aria-expanded={filtersOpen}
            aria-controls="collection-filters"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>

          <p className="collection-toolbar__count" role="status" aria-live="polite">
            {loading ? 'Loading…' : `${filtered.length} piece${filtered.length === 1 ? '' : 's'}`}
          </p>

          <div className="collection-toolbar__sort">
            <label htmlFor="sort" className="meta">
              Sort
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey)
                setVisible(PAGE)
              }}
              className="select"
            >
              <option value="curated">Curated</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price — low to high</option>
              <option value="price-desc">Price — high to low</option>
            </select>
          </div>
        </div>

        <div id="collection-filters" className={`collection-filters ${filtersOpen ? 'is-open' : ''}`}>
          <div className="filter-group">
            <p className="eyebrow">Glaze</p>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${glazeFilter === 'all' ? 'is-active' : ''}`}
                aria-pressed={glazeFilter === 'all'}
                onClick={() => {
                  setGlazeFilter('all')
                  setVisible(PAGE)
                }}
              >
                All
              </button>
              {glazes.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`chip ${glazeFilter === g.id ? 'is-active' : ''}`}
                  aria-pressed={glazeFilter === g.id}
                  onClick={() => {
                    setGlazeFilter(g.id)
                    setVisible(PAGE)
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <p className="eyebrow">Category</p>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${categoryFilter === 'all' ? 'is-active' : ''}`}
                aria-pressed={categoryFilter === 'all'}
                onClick={() => {
                  setCategoryFilter('all')
                  setVisible(PAGE)
                }}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${categoryFilter === c.id ? 'is-active' : ''}`}
                  aria-pressed={categoryFilter === c.id}
                  onClick={() => {
                    setCategoryFilter(c.id)
                    setVisible(PAGE)
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {activeCount > 0 && (
            <button type="button" className="btn btn--link collection-filters__reset" onClick={reset}>
              Clear filters
              <Close width={12} height={12} />
            </button>
          )}
        </div>

        {activeCount > 0 && (
          <div className="active-filters" aria-live="polite">
            {glazeFilter !== 'all' && (
              <button type="button" className="tag tag--removable" onClick={() => setGlazeFilter('all')}>
                {glazes.find((g) => g.id === glazeFilter)?.name}
                <Close width={10} height={10} />
              </button>
            )}
            {categoryFilter !== 'all' && (
              <button type="button" className="tag tag--removable" onClick={() => setCategoryFilter('all')}>
                {categories.find((c) => c.id === categoryFilter)?.label}
                <Close width={10} height={10} />
              </button>
            )}
          </div>
        )}

        {/* ---- Loading ---- */}

        {loading && products.length === 0 && (
          <div className="empty-state" aria-busy="true">
            <p className="display display--sm">Loading the collection…</p>
            <p className="body">Reading live prices and stock from our store.</p>
          </div>
        )}

        {/* ---- Store unreachable ---- */}

        {!loading && error && source === 'static' && (
          <div className="empty-state" role="alert">
            <p className="display display--sm">The store could not be reached</p>
            <p className="body">{error} Showing a cached catalogue, so prices and stock may be out of date and items cannot be bought until it reconnects.</p>
            <button type="button" className="btn btn--outline" onClick={reset}>
              Show all pieces
            </button>
          </div>
        )}

        {shown.length > 0 && (
          <div className="card-grid card-grid--collection">
            {shown.map((p, i) => (
              <ProductCard key={p.id} product={p} onQuickView={onQuickView} index={i} />
            ))}
          </div>
        )}

        {!loading && shown.length === 0 && !(error && source === 'static') && (
          <div className="empty-state">
            <p className="display display--sm">No pieces match these filters</p>
            <p className="body">
              Try a different glaze or category — the full catalogue holds {products.length} works.
            </p>
            <button type="button" className="btn btn--outline" onClick={reset}>
              Show all pieces
            </button>
          </div>
        )}

        {visible < filtered.length && (
          <div className="collection-more">
            <button type="button" className="btn btn--outline" onClick={() => setVisible((v) => v + PAGE)}>
              Load more — {filtered.length - visible} remaining
            </button>
          </div>
        )}

        <aside className="collection-note">
          <MediaImage image="kiln-studio" alt="Pottery tools on a workshop table" ratio={16 / 9} sizes="92vw" />
          <div className="collection-note__body">
            <p className="eyebrow">How buying works</p>
            <p className="body">
              Pieces are bought directly here: choose one, add it to the cart, and pay at checkout.
              Stock is confirmed by the store each time an item is added, because each firing
              produces only a handful of objects.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
