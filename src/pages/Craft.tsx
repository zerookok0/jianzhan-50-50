import { useDocumentMeta, useReveal } from '../lib/hooks'
import { MediaImage, AppLink } from '../components/ui/Media'
import { visual } from '../styles/visual'
import { ArrowRight } from '../components/ui/Icons'

const steps = [
  {
    n: '01',
    title: 'The clay',
    text: 'Iron-rich local clay is wedged by hand and left to rest. The high iron content is what later feeds the glaze’s crystals and colour.',
  },
  {
    n: '02',
    title: 'Throwing',
    text: 'Each bowl is thrown individually on the wheel — rim, wall and foot formed in one sitting. Thickness is judged by touch rather than measured.',
  },
  {
    n: '03',
    title: 'Glazing',
    text: 'Glaze is applied in thin layers, often unevenly by intention. Where the layer is thinner, the surface will later read darker; where thicker, it pools.',
  },
  {
    n: '04',
    title: 'Firing',
    text: 'Wood firing runs for days, watched in shifts. Ash settles, atmosphere shifts, and the kiln is left to cool slowly — often the decisive stage.',
  },
  {
    n: '05',
    title: 'Selection',
    text: 'After cooling, most pieces are set aside. The ones that survive are judged for surface, form and usefulness rather than novelty.',
  },
]

export function Craft() {
  useDocumentMeta(
    'Our Craft — Fire, Clay and Time | JIANZHAN',
    'How Jian ware bowls are made: iron-rich clay, hand throwing, layered glaze and multi-day wood firing. A plain account of process, without inflated claims.',
  )
  useReveal()

  return (
    <div className="craft-page">
      <header className="page-hero" aria-labelledby="craft-hero-title">
        <div className="page-hero__media" aria-hidden="true">
          <img src={visual.craftFire} alt="" fetchPriority="high" decoding="async" />
        </div>
        <div className="shell page-hero__inner">
          <p className="eyebrow reveal">Our Craft</p>
          <h1 id="craft-hero-title" className="display display--lg page-hero__title reveal" data-delay="1">
            Nothing here
            <br />
            is hurried
          </h1>
          <p className="lede reveal" data-delay="2">
            Jian ware depends on a handful of variables that cannot be fully separated: the clay, the
            thickness of the glaze, the path of heat, and the speed at which the kiln cools.
          </p>
        </div>
      </header>

      <section className="section" aria-labelledby="process-title">
        <div className="shell">
          <div className="craft-intro">
            <div>
              <p className="eyebrow reveal">Process</p>
              <h2 id="process-title" className="display display--md reveal" data-delay="1">
                Five stages, one object
              </h2>
            </div>
            <p className="body reveal" data-delay="2">
              The sequence below is the ordinary one. It is not a performance: each stage exists
              because skipping it changes the outcome in ways that cannot be corrected later.
            </p>
          </div>

          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.n} className="step reveal" data-delay={(i % 3) + 1}>
                <span className="step__n">{s.n}</span>
                <h3 className="step__title">{s.title}</h3>
                <p className="step__text">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="split-feature" aria-labelledby="kiln-title">
        <div className="split-feature__media">
          <MediaImage
            image="kiln-glow"
            alt="Glowing embers visible through the openings of a wood kiln"
            ratio={4 / 3}
            sizes="(min-width: 900px) 50vw, 92vw"
          />
        </div>
        <div className="split-feature__text">
          <p className="eyebrow reveal">The Kiln</p>
          <h2 id="kiln-title" className="display display--md reveal" data-delay="1">
            A firing decides more than the maker does
          </h2>
          <p className="body reveal" data-delay="2">
            Two bowls from the same batch, thrown to the same dimensions, can leave the kiln looking
            like they came from different workshops. Position in the chamber, airflow and cooling rate
            all leave marks. This is not decoration added afterwards — it is the material recording
            what happened to it.
          </p>
          <AppLink href="/collection" className="btn reveal" data-delay="3">
            See the results
            <ArrowRight width={16} height={16} className="btn__arrow" />
          </AppLink>
        </div>
      </section>

      <section className="section section--tight" aria-labelledby="hands-title">
        <div className="shell">
          <header className="section-head">
            <div>
              <p className="eyebrow reveal">In the studio</p>
              <h2 id="hands-title" className="display display--md reveal" data-delay="1">
                Hands, not moulds
              </h2>
            </div>
          </header>

          <div className="craft-gallery">
            <figure className="craft-gallery__a reveal">
              <MediaImage image="kiln-hands" alt="Hands forming a bowl on the wheel" ratio={4 / 5} sizes="(min-width: 900px) 34vw, 92vw" />
              <figcaption className="meta">Forming — wall thickness judged by touch</figcaption>
            </figure>
            <figure className="craft-gallery__b reveal" data-delay="1">
              <MediaImage image="kiln-hands-4" alt="A potter shaping clay with both hands" ratio={1} sizes="(min-width: 900px) 30vw, 92vw" />
            </figure>
            <figure className="craft-gallery__c reveal" data-delay="2">
              <MediaImage image="kiln-studio" alt="Glaze and pottery tools on a workshop bench" ratio={3 / 4} sizes="(min-width: 900px) 30vw, 92vw" />
              <figcaption className="meta">Glaze — mixed and tested on offcuts</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="section closing-band" aria-labelledby="honest-title">
        <div className="shell closing-band__inner">
          <p className="eyebrow">A note on claims</p>
          <h2 id="honest-title" className="display display--md reveal">
            What we do not say
          </h2>
          <p className="body reveal" data-delay="1">
            We do not describe our work as museum-equivalent, certified, or produced by a named
            historical lineage. What we can state plainly is the material, the method, the firing and
            the year — and let the object speak for the rest.
          </p>
          <AppLink href="/about" className="btn reveal" data-delay="2">
            About the studio
            <ArrowRight width={16} height={16} className="btn__arrow" />
          </AppLink>
        </div>
      </section>

      <div className="visually-hidden-link">
        <img src={visual.craftDetail} alt="" loading="lazy" decoding="async" />
      </div>
    </div>
  )
}
