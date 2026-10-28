import { site, navigation } from '../../data/site'
import { AppLink } from '../ui/Media'
import { visual } from '../../styles/visual'

/**
 * Footer — brand mark, navigation, contact placeholders, policies, social.
 * Replace every href in src/data/site.ts when the real store is ready.
 */
export function Footer() {
  return (
    <footer className="site-footer grain" style={{ position: 'relative' }}>
      <div className="site-footer__bg" style={{ backgroundImage: `url(${visual.footer})` }} aria-hidden="true" />

      <div className="shell site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <AppLink href="/" className="brand brand--footer" ariaLabel={`${site.brand} — home`}>
              <span className="brand__word">{site.brand}</span>
              <span className="brand__seal" aria-hidden="true">
                {site.brandCn.charAt(0)}
              </span>
            </AppLink>
            <p className="site-footer__tag">{site.tagline}</p>
          </div>

          <nav className="site-footer__nav" aria-label="Footer">
            <p className="eyebrow">Explore</p>
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <AppLink href={item.href} className="footer-link">
                    {item.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-footer__nav">
            <p className="eyebrow">Studio</p>
            <ul>
              <li>
                <AppLink href={`mailto:${site.email}`} className="footer-link">
                  {site.email}
                </AppLink>
              </li>
              <li>
                <AppLink href={`tel:${site.phone.replace(/\s|\(|\)/g, '')}`} className="footer-link">
                  {site.phone}
                </AppLink>
              </li>
              <li className="footer-address">{site.studio}</li>
              <li className="footer-address">{site.hours}</li>
            </ul>
          </div>


          <div className="site-footer__nav">
            <p className="eyebrow">Policies</p>
            <ul>
              {site.policies.map((p) => (
                <li key={p.label}>
                  <AppLink href={p.href} className="footer-link">
                    {p.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="site-footer__bottom">
          <p className="site-footer__legal">
            © {new Date().getFullYear()} {site.legalName}. All rights reserved.
          </p>

          <ul className="site-footer__social" aria-label="Social links">
            {site.social.map((s) => (
              <li key={s.label}>
                <AppLink href={s.href} className="footer-link footer-link--social" external={s.href.startsWith('http')}>
                  {s.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>

        <p className="site-footer__note">
          Demo catalogue for presentation purposes. Prices, availability and copy are illustrative;
          all purchases are completed on our WordPress store.
        </p>
      </div>
    </footer>
  )
}
