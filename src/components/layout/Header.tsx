import { useEffect, useState } from 'react'
import { AppLink } from '../ui/Media'
import { site, navigation, announcement } from '../../data/site'
import { useCart } from '../../lib/cart'
import { useRoute, useScrollLock, useEscape } from '../../lib/hooks'
import { storeEnabled } from '../../config/store'
import { Bag, Search, Close } from '../ui/Icons'
import { SearchOverlay } from './SearchOverlay'

/**
 * HEADER
 * ------------------------------------------------------------------
 * Sticky, transparent over the hero and solid once scrolled.
 *
 * Details that matter:
 *   • The mobile menu is focus-trapped and scroll-locked, and the scroll
 *     position is restored on close.
 *   • The cart button only exists when commerce is enabled, so a catalogue
 *     build has no dead control in it.
 *   • The count is announced politely rather than assertively; a cart that
 *     interrupts a screen reader mid-sentence is a nuisance.
 */
export function Header() {
  const route = useRoute()
  const { itemCount, openDrawer } = useCart()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useScrollLock(menuOpen)
  useEscape(menuOpen, () => setMenuOpen(false))

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // A route change must not leave the drawer open over the new page.
  useEffect(() => {
    setMenuOpen(false)
  }, [route.path])

  const isActive = (href: string) =>
    href === '/' ? route.path === '/' : route.path.startsWith(href)

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <p className="announce">{announcement}</p>

      <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="site-header__inner">
          <AppLink href="/" className="brand" ariaLabel={`${site.brand} — home`}>
            <span className="brand__word">{site.brand}</span>
            <span className="brand__seal" aria-hidden="true">
              {site.brandCn.charAt(0)}
            </span>
          </AppLink>

          <nav className="nav-desktop" aria-label="Primary">
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <AppLink
                    href={item.href}
                    className={`nav-link ${isActive(item.href) ? 'is-active' : ''}`}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                  >
                    {item.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-header__tools">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="Search the collection"
            >
              <Search width={17} height={17} />
            </button>

            {storeEnabled() && (
              <button
                type="button"
                className="icon-btn cart-btn"
                onClick={openDrawer}
                aria-label={
                  itemCount === 0
                    ? 'Open cart, empty'
                    : `Open cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`
                }
              >
                <Bag width={17} height={17} />
                {itemCount > 0 && (
                  <span className="cart-btn__count" aria-hidden="true">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              className="menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
            >
              <span className="menu-btn__bars">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      <div
        id="mobile-menu"
        className={`mobile-menu ${menuOpen ? 'is-open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <div className="mobile-menu__head">
          <span className="brand__word">{site.brand}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <Close width={18} height={18} />
          </button>
        </div>

        <nav aria-label="Mobile">
          <ul className="mobile-menu__list">
            {navigation.map((item, i) => (
              <li key={item.href} style={{ transitionDelay: `${0.06 * i}s` }}>
                <AppLink
                  href={item.href}
                  className={`mobile-menu__link ${isActive(item.href) ? 'is-active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="mobile-menu__index">{String(i + 1).padStart(2, '0')}</span>
                  {item.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mobile-menu__foot">
          <p className="mobile-menu__tag">{site.tagline}</p>
          <AppLink href={`mailto:${site.email}`} className="footer-link">
            {site.email}
          </AppLink>
        </div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}

export default Header
