import { useState } from 'react'
import type { Glaze } from '../../data/products'
import { MediaImage } from '../ui/Media'
import { ArrowRight } from '../ui/Icons'
import { useReveal } from '../../lib/hooks'
import { AppLink } from '../ui/Media'

interface GlazeExplorerProps {
  glazes: Glaze[]
}

/**
 * Glaze Explorer — every option shown here has a real photograph behind it,
 * so switching tabs always changes image, name and description together.
 */
export function GlazeExplorer({ glazes }: GlazeExplorerProps) {
  const [active, setActive] = useState(0)
  useReveal([active])
  const glaze = glazes[active]

  return (
    <section className="section glaze-explorer" aria-labelledby="glaze-title">
      <div className="shell">
        <header className="glaze-explorer__head">
          <p className="eyebrow reveal">Glaze Explorer</p>
          <h2 id="glaze-title" className="display display--md reveal" data-delay="1">
            Five surfaces, one kiln
          </h2>
          <p className="body reveal" data-delay="2">
            The same clay and the same flame produce entirely different faces. Choose a glaze to see
            the piece it belongs to.
          </p>
        </header>

        <div className="glaze-explorer__body">
          <div className="glaze-explorer__visual">
            <MediaImage
              key={glaze.id}
              image={glaze.image}
              alt={`${glaze.name} glaze — ${glaze.tagline}`}
              ratio={4 / 5}
              sizes="(min-width: 900px) 52vw, 92vw"
              className="glaze-explorer__media"
              showFallbackNote
            />
            <span className="glaze-explorer__cn cn-mark" aria-hidden="true">
              {glaze.cn}
            </span>
          </div>

          <div className="glaze-explorer__panel">
            <div className="chip-row glaze-explorer__tabs" role="tablist" aria-label="Glaze types">
              {glazes.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-controls="glaze-panel"
                  id={`glaze-tab-${g.id}`}
                  className={`chip ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {g.name}
                </button>
              ))}
            </div>

            <div
              id="glaze-panel"
              role="tabpanel"
              aria-labelledby={`glaze-tab-${glaze.id}`}
              className="glaze-explorer__text"
              tabIndex={0}
            >
              <p className="meta glaze-explorer__count">
                {String(active + 1).padStart(2, '0')} / {String(glazes.length).padStart(2, '0')}
              </p>
              <h3 className="display display--sm glaze-explorer__name">{glaze.name}</h3>
              <p className="serif-italic glaze-explorer__tagline">{glaze.tagline}</p>
              <p className="body">{glaze.description}</p>

              <AppLink href={`/collection?glaze=${glaze.id}`} className="btn glaze-explorer__link">
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
