import { useEffect, useMemo, useRef, useState } from 'react'
import { posts } from '../../data/posts'
import { useCatalogue } from '../../lib/catalogue'
import { formatMinor } from '../../lib/api/client'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { navigate } from '../../lib/hooks'
import { Close, Search } from '../ui/Icons'
import { ProductImage } from '../ui/Media'

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

/**
 * Lightweight client-side search across pieces and journal entries.
 *
 * It searches the catalogue already loaded by the provider rather than
 * firing a request per keystroke: the collection is small, and a search
 * box that debounces against the network feels broken on a slow link.
 * The catalogue's own `search` parameter exists for when it outgrows this.
 */
export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const { products } = useCatalogue()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useScrollLock(open)
  useEscape(open, onClose)

  useEffect(() => {
    if (open) {
      setQuery('')
      const t = window.setTimeout(() => inputRef.current?.focus(), 60)
      return () => window.clearTimeout(t)
    }
  }, [open])

  const q = query.trim().toLowerCase()

  const productHits = useMemo(() => {
    if (!q) return products.slice(0, 3)
    return products
      .filter((p) =>
        [p.name, p.subtitle, p.glaze, p.description, p.category, p.sku]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 5)
  }, [q, products])

  const postHits = useMemo(() => {
    if (!q) return []
    return posts.filter((p) => `${p.title} ${p.excerpt} ${p.kicker}`.toLowerCase().includes(q)).slice(0, 3)
  }, [q])

  if (!open) return null

  return (
    <div className="search" role="dialog" aria-modal="true" aria-label="Search">
      <div className="search__head">
        <Search width={18} height={18} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pieces, glazes, journal…"
          aria-label="Search pieces, glazes and journal"
          className="search__input"
        />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
          <Close width={18} height={18} />
        </button>
      </div>

      <div className="search__results">
        <p className="eyebrow">{q ? 'Pieces' : 'Selected pieces'}</p>
        {productHits.length === 0 && (
          <p className="search__empty">
            {products.length === 0 ? 'The catalogue is still loading.' : `No pieces match “${query}”.`}
          </p>
        )}
        <ul className="search__list">
          {productHits.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="search__item"
                onClick={() => {
                  onClose()
                  navigate(`/collection/${p.slug}`)
                }}
              >
                <ProductImage
                  src={p.images[0]}
                  alt=""
                  ratio={1}
                  sizes="56px"
                  className="search__thumb"
                />
                <span className="search__item-text">
                  <span className="search__item-name">{p.name}</span>
                  <span className="search__item-sub">{p.subtitle}</span>
                </span>
                <span className="search__item-price">
                  {formatMinor(p.fromPrice, p.currency, p.minorUnit)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {postHits.length > 0 && (
          <>
            <p className="eyebrow search__group">Journal</p>
            <ul className="search__list">
              {postHits.map((post) => (
                <li key={post.slug}>
                  <button
                    type="button"
                    className="search__item"
                    onClick={() => {
                      onClose()
                      navigate(`/journal/${post.slug}`)
                    }}
                  >
                    <span className="search__item-text">
                      <span className="search__item-name">{post.title}</span>
                      <span className="search__item-sub">{post.kicker}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
