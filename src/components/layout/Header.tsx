import { useEffect, useState } from 'react'
import { navigation, site, announcement } from '../../data/site'
import { useRoute, useScrollLock } from '../../lib/hooks'
import { useCart } from '../../lib/cart'
import { AppLink } from '../ui/Media'
import { Cart, Close, Search } from '../ui/Icons'
import { SearchOverlay } from './SearchOverlay'

/**
 * Header: transparent over the hero, then settles into a dark bar.
 * Mobile menu is a full-height dark panel with staggered links.
 */
export function Header() {
  const route = useRoute()
  const { count, openCart } = useCart()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useScrollLock(menuOpen)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [route.path])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const isActive = (href: string) =>
    href === '/' ? route.path === '/' : route.path === href || route.path.startsWith(`${href}/`)

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <div className="announce" role="status">
        <span>{announcement}</span>
      </div>

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
                    ariaLabel={item.label}
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
              <Search width={16} height={16} />
            </button>

            <button
              type="button"
              className="icon-btn cart-btn"
              onClick={openCart}
              aria-label={count > 0 ? `Open cart, ${count} items` : 'Open cart, empty'}
            >
              <Cart width={16} height={16} />
              {count > 0 && (
                <span className="cart-btn__count" aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>

            <button
              type="button"
              className="menu-btn"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="menu-btn__bars" aria-hidden="true">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile / tablet menu */}
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
              <li key={item.href} style={{ transitionDelay: `${0.06 + i * 0.05}s` }}>
                <AppLink
                  href={item.href}
                  className={`mobile-menu__link ${isActive(item.href) ? 'is-active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="mobile-menu__index">0{i + 1}</span>
                  <span>{item.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mobile-menu__foot">
          <p className="mobile-menu__tag">{site.tagline}</p>
          <p className="meta">
            {site.email} · {site.phone}
          </p>
        </div>
      </div>

      {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
