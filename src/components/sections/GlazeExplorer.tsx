import { useState } from 'react'
import { AppLink, MediaImage } from '../ui/Media'
import { ArrowRight } from '../ui/Icons'
import type { Glaze } from '../../data/products'
import { useCatalogue } from '../../lib/catalogue'

interface GlazeExplorerProps {
  glazes: Glaze[]
}

/**
 * GLAZE EXPLORER
 * ------------------------------------------------------------------
 * A tab panel, not a carousel. Carousels hide content and reset on every
 * mistaken swipe; tabs let you compare glazes directly.
 *
 * Implemented as a proper ARIA tablist with roving arrow-key focus, so the
 * whole widget is usable from the keyboard without touching the mouse.
 */
export function GlazeExplorer({ glazes }: GlazeExplorerProps) {
  const [activeId, setActiveId] = useState(glazes[0]?.id ?? '')
  const { products } = useCatalogue()

  const active = glazes.find((g) => g.id === activeId) ?? glazes[0]
  if (!active) return null

  const count = products.filter((p) => p.glaze === active.id).length

  const move = (delta: number) => {
    const index = glazes.findIndex((g) => g.id === active.id)
    const next = (index + delta + glazes.length) % glazes.length
    setActiveId(glazes[next].id)
    document.getElementById(`glaze-tab-${glazes[next].id}`)?.focus()
  }

  return (
    <section className="section" aria-labelledby="glaze-title">
      <div className="shell">
        <header className="glaze-explorer__head">
          <p className="eyebrow reveal">The Glazes</p>
          <h2 id="glaze-title" className="display display--md reveal" data-delay="1">
            Five surfaces, one kiln
          </h2>
          <p className="body reveal" data-delay="2">
            The difference between these families is not pigment but chemistry: how iron
            crystallises, how a thin film refracts light, how ash settles as the flame slows.
          </p>
        </header>

        <div className="glaze-explorer__body">
          <div className="glaze-explorer__visual reveal">
            <MediaImage
              image={active.image}
              alt={`${active.name} glaze detail`}
              ratio={4 / 3}
              sizes="(min-width: 900px) 50vw, 92vw"
            />
            <span className="glaze-explorer__cn cn-mark" aria-hidden="true">
              {active.cn}
            </span>
          </div>

          <div>
            <div className="chip-row glaze-explorer__tabs" role="tablist" aria-label="Glaze families">
              {glazes.map((glaze) => {
                const selected = glaze.id === active.id
                return (
                  <button
                    key={glaze.id}
                    id={`glaze-tab-${glaze.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`glaze-panel-${glaze.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={`chip ${selected ? 'is-active' : ''}`}
                    onClick={() => setActiveId(glaze.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight') {
                        event.preventDefault()
                        move(1)
                      } else if (event.key === 'ArrowLeft') {
                        event.preventDefault()
                        move(-1)
                      } else if (event.key === 'Home') {
                        event.preventDefault()
                        setActiveId(glazes[0].id)
                      } else if (event.key === 'End') {
                        event.preventDefault()
                        setActiveId(glazes[glazes.length - 1].id)
                      }
                    }}
                  >
                    {glaze.name}
                  </button>
                )
              })}
            </div>

            <div
              id={`glaze-panel-${active.id}`}
              role="tabpanel"
              aria-labelledby={`glaze-tab-${active.id}`}
              tabIndex={0}
              className="glaze-explorer__text"
            >
              <p className="meta glaze-explorer__count">
                {count} piece{count === 1 ? '' : 's'} in this glaze
              </p>

              <h3 className="display display--sm glaze-explorer__name">
                {active.name}
                <span className="sr-only"> — {active.cn}</span>
              </h3>

              <p className="serif-italic glaze-explorer__tagline">{active.tagline}</p>
              <p className="body">{active.description}</p>

              <AppLink
                href={`/collection?glaze=${active.id}`}
                className="btn glaze-explorer__link"
              >
                View {active.name} pieces
                <ArrowRight width={16} height={16} className="btn__arrow" />
              </AppLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default GlazeExplorer
