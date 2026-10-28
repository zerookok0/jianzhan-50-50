import { useRef, useState } from 'react'
import type { Glaze } from '../../data/products'
import { MediaImage, AppLink } from '../ui/Media'
import { ArrowRight } from '../ui/Icons'

/**
 * GLAZE EXPLORER
 * ------------------------------------------------------------------
 * Five glazes, one at a time. Implemented as a proper ARIA tablist: arrow
 * keys move between tabs, Home/End jump to the ends, and only the active
 * panel is exposed to assistive technology.
 *
 * The image is keyed on the active glaze so it re-mounts and its
 * fade-in plays each time, rather than swapping silently in place.
 */

interface GlazeExplorerProps {
  glazes: Glaze[]
}

export function GlazeExplorer({ glazes }: GlazeExplorerProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  if (!glazes.length) return null

  const active = glazes[Math.min(activeIndex, glazes.length - 1)]

  const focusTab = (i: number) => {
    const next = ((i % glazes.length) + glazes.length) % glazes.length
    setActiveIndex(next)
    tabRefs.current[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusTab(activeIndex + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        focusTab(activeIndex - 1)
        break
      case 'Home':
        e.preventDefault()
        focusTab(0)
        break
      case 'End':
        e.preventDefault()
        focusTab(glazes.length - 1)
        break
      default:
        break
    }
  }

  return (
    <section className="section glaze-explorer" aria-labelledby="glaze-title">
      <div className="shell">
        <header className="glaze-explorer__head">
          <p className="eyebrow reveal">Glaze Families</p>
          <h2 id="glaze-title" className="display display--md reveal" data-delay="1">
            Five ways fire reads on iron
          </h2>
          <p className="body reveal" data-delay="2">
            Each family comes from the same clay body. What separates them is the rate of cooling and
            how much oxygen the kiln held at the moment the glaze set.
          </p>
        </header>

        <div className="glaze-explorer__body">
          <div className="glaze-explorer__visual reveal">
            <MediaImage
              key={active.id}
              image={active.image}
              alt={`${active.name} glaze — ${active.tagline}`}
              ratio={4 / 5}
              sizes="(min-width: 900px) 46vw, 92vw"
              priority
            />
            <span className="glaze-explorer__cn cn-mark" aria-hidden="true">
              {active.cn}
            </span>
          </div>

          <div className="glaze-explorer__text">
            <div
              className="glaze-explorer__tabs chip-row reveal"
              role="tablist"
              aria-label="Glaze families"
              onKeyDown={onKeyDown}
            >
              {glazes.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  id={`glaze-tab-${g.id}`}
                  aria-selected={i === activeIndex}
                  aria-controls="glaze-panel"
                  tabIndex={i === activeIndex ? 0 : -1}
                  className={`chip ${i === activeIndex ? 'is-active' : ''}`}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  onClick={() => setActiveIndex(i)}
                >
                  {g.name}
                </button>
              ))}
            </div>

            <div
              id="glaze-panel"
              role="tabpanel"
              aria-labelledby={`glaze-tab-${active.id}`}
              tabIndex={0}
              className="glaze-explorer__text"
            >
              <p className="meta glaze-explorer__count">
                {String(activeIndex + 1).padStart(2, '0')} / {String(glazes.length).padStart(2, '0')}
              </p>

              <h3 className="display display--sm glaze-explorer__name">{active.name}</h3>

              <p className="serif-italic glaze-explorer__tagline">{active.tagline}</p>

              <p className="body">{active.description}</p>

              <AppLink
                href={`/collection?glaze=${active.id}`}
                className="btn glaze-explorer__link"
              >
                See pieces in this glaze
                <ArrowRight width={16} height={16} className="btn__arrow" />
              </AppLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
