import { useDocumentMeta, useReveal } from '../lib/hooks'
import { MediaImage, AppLink } from '../components/ui/Media'
import { visual } from '../styles/visual'
import { ArrowRight } from '../components/ui/Icons'
import { site } from '../data/site'

export function About() {
  useDocumentMeta(
    'About — The Studio | JIANZHAN',
    'JIANZHAN is a studio project presenting Jian ware tea bowls as collectible objects. A short statement of intent, materials and approach.',
  )
  useReveal()

  return (
    <div className="about-page">
      <header className="page-hero page-hero--tall" aria-labelledby="about-hero-title">
        <div className="page-hero__media" aria-hidden="true">
          <img src={visual.aboutHero} alt="" fetchPriority="high" decoding="async" />
        </div>
        <div className="shell page-hero__inner">
          <p className="eyebrow reveal">About</p>
          <h1 id="about-hero-title" className="display display--lg page-hero__title reveal" data-delay="1">
            {site.brand}
            <span className="about-page__cn cn-mark">{site.brandCn}</span>
          </h1>
          <p className="lede reveal" data-delay="2">
            A studio project concerned with one narrow question: what can a single bowl tell you
            about the fire that made it?
          </p>
        </div>
      </header>

      <section className="section" aria-labelledby="about-statement">
        <div className="shell about-grid">
          <div className="about-grid__lead">
            <p className="eyebrow reveal">Statement</p>
            <h2 id="about-statement" className="display display--md reveal" data-delay="1">
              Quiet luxury is a restraint, not an aesthetic
            </h2>
          </div>
          <div className="about-grid__text">
            <p className="body reveal" data-delay="1">
              We work with a small number of shapes and a limited set of glazes. The interest is not
              in novelty but in repetition: making the same form until the differences between
              individual pieces become the point.
            </p>
            <p className="body reveal" data-delay="2">
              Every bowl in this catalogue came out of a wood firing. Some are conventionally
              beautiful; others are quieter or more uneven. We present them together because the
              variation is honest, and because pretending each firing can be standardised would be a
              lie about the material.
            </p>
            <p className="body reveal" data-delay="3">
              This website is a gallery, not a shop. Transactions are handled by our WordPress store;
              we keep them separate so that neither experience has to compromise the other.
            </p>
          </div>
        </div>
      </section>

      <section className="about-figures" aria-label="Studio images">
        <div className="shell about-figures__inner">
          <figure className="about-figures__a reveal">
            <MediaImage
              image="kiln-hands-3"
              alt="An artisan shaping a vessel at the wheel in low light"
              ratio={3 / 4}
              sizes="(min-width: 900px) 34vw, 92vw"
            />
            <figcaption className="meta">At the wheel</figcaption>
          </figure>
          <figure className="about-figures__b reveal" data-delay="1">
            <MediaImage
              image="kiln-tools"
              alt="Workshop tools and materials in the studio"
              ratio={4 / 5}
              sizes="(min-width: 900px) 32vw, 92vw"
            />
            <figcaption className="meta">Studio bench</figcaption>
          </figure>
          <div className="about-figures__quote reveal" data-delay="2">
            <blockquote className="serif-italic">
              “The bowl is finished long before anyone decides whether it is beautiful.”
            </blockquote>
            <p className="meta">— Studio note</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="values-title">
        <div className="shell">
          <p className="eyebrow reveal">Principles</p>
          <h2 id="values-title" className="display display--md reveal" data-delay="1">
            Four things we hold to
          </h2>

          <ul className="values">
            {[
              {
                t: 'Materials first',
                d: 'Iron-rich clay from a known source, glaze mixed in the studio, no surface printed or transferred on.',
              },
              {
                t: 'One firing, one object',
                d: 'We do not clone a result. If a surface cannot be repeated, it is presented as a single work rather than a product line.',
              },
              {
                t: 'Describe, do not inflate',
                d: 'No invented certifications, no borrowed historical claims, no manufactured scarcity.',
              },
              {
                t: 'Made to be used',
                d: 'The pieces are functional vessels. Collecting them does not require keeping them in a cabinet.',
              },
            ].map((v, i) => (
              <li key={v.t} className="value reveal" data-delay={(i % 3) + 1}>
                <h3 className="value__title">{v.t}</h3>
                <p className="value__text">{v.d}</p>
              </li>
            ))}
          </ul>

          <div className="about-cta reveal">
            <AppLink href="/collection" className="btn btn--solid">
              Explore the collection
            </AppLink>
            <AppLink href="/journal" className="btn">
              Read the journal
              <ArrowRight width={16} height={16} className="btn__arrow" />
            </AppLink>
          </div>
        </div>
      </section>
    </div>
  )
}
