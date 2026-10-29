import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCatalogue } from '../../lib/catalogue'
import { formatMinor } from '../../lib/api/client'
import { useEscape, useScrollLock, navigate } from '../../lib/hooks'
import { posts } from '../../data/posts'
import { AppLink, ProductImage } from '../ui/Media'
import { Search, Close } from '../ui/Icons'

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

/**
 * SEARCH
 * ------------------------------------------------------------------
 * Searches the catalogue already in memory rather than calling the API
 * per keystroke: the store holds a handful of pieces, so a second round
 * of latency and a rate-limit budget would buy nothing.
 *
 * Both products and journal entries are searched, because a customer
 * looking for "hare's fur" may want either the bowl or the essay about it.
 */
export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const { products } = useCatalogue()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useScrollLock(open)
  useEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (term.length < 2) return { products: [], posts: [] }

    const matchProducts = products
      .filter((p) =>
        [p.name, p.subtitle, p.description, String(p.glaze), String(p.category)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 6)

    const matchPosts = posts
      .filter((p) =>
        [p.title, p.excerpt, p.kicker, ...p.body.map((b) => `${b.heading ?? ''} ${b.text}`)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 4)

    return { products: matchProducts, posts: matchPosts }
  }, [query, products])

  const total = results.products.length + results.posts.length
  const searching = query.trim().length >= 2

  if (!open) return null

  return createPortal(
    <div className="search" role="dialog" aria-modal="true" aria-label="Search the site">
      <div className="search__head">
        <Search width={20} height={20} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="search__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pieces, glazes, journal…"
          aria-label="Search pieces, glazes and journal entries"
          autoComplete="off"
        />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
          <Close width={18} height={18} />
        </button>
      </div>

      <div className="search__results">
        <p className="meta" role="status" aria-live="polite">
          {!searching
            ? 'Type at least two characters'
            : total === 0
              ? `No matches for “${query.trim()}”`
              : `${total} result${total === 1 ? '' : 's'} for “${query.trim()}”`}
        </p>

        {results.products.length > 0 && (
          <section className="search__group" aria-labelledby="search-pieces">
            <h2 className="eyebrow" id="search-pieces">
              Pieces
            </h2>
            <ul className="search__list">
              {results.products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="search__item"
                    onClick={() => {
                      onClose()
                      navigate(`/collection/${p.slug}`)
                    }}
                  >
                    <span className="search__thumb">
                      <ProductImage src={p.images[0] ?? ''} alt="" ratio={1} sizes="56px" />
                    </span>
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
          </section>
        )}

        {results.posts.length > 0 && (
          <section className="search__group" aria-labelledby="search-journal">
            <h2 className="eyebrow" id="search-journal">
              Journal
            </h2>
            <ul className="search__list">
              {results.posts.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    className="search__item"
                    onClick={() => {
                      onClose()
                      navigate(`/journal/${p.slug}`)
                    }}
                  >
                    <span className="search__item-text">
                      <span className="search__item-name">{p.title}</span>
                      <span className="search__item-sub">{p.excerpt}</span>
                    </span>
                    <span className="search__item-price">
                      {p.readMinutes} min
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {searching && total === 0 && (
          <p className="search__empty">
            Nothing matched. The collection is small by design — try a glaze name such as
            “iridescent”, or <AppLink href="/collection">browse everything</AppLink>.
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default SearchOverlay
