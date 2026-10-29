import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export interface Route {
  path: string
  query: URLSearchParams
}

const RouteContext = createContext<Route>({ path: '/', query: new URLSearchParams() })

/**
 * DEPLOYMENT BASE
 * ------------------------------------------------------------------
 * This bundle is built to live inside a WordPress subdirectory
 * (e.g. https://example.com/site/), where the app must NOT assume it
 * owns the domain root.
 *
 * Two modes:
 *  - 'hash'    (default) real URL is /site/#/collection. Works with
 *              base './' at any depth, on any host, with no rewrites.
 *  - 'history' clean URLs like /site/collection. Requires an absolute
 *              base (VITE_BASE=/site/) and a server rewrite to index.html.
 *
 * Set at build time: VITE_ROUTER=history
 */
const ROUTER_MODE: 'hash' | 'history' =
  (import.meta.env.VITE_ROUTER as string | undefined) === 'history' ? 'history' : 'hash'

/**
 * Resolves the directory this app is served from, without a trailing slash:
 * '/site' (absolute base) or '/nested/site' (inferred from the built script).
 */
function detectBase(): string {
  const envBase = import.meta.env.BASE_URL || '/'

  if (envBase.startsWith('/')) {
    return envBase.replace(/\/+$/, '')
  }

  // Relative base ('./'): infer the folder from our own bundle URL.
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]')
  if (script) {
    try {
      const url = new URL(script.getAttribute('src') || '', window.location.href)
      const marker = url.pathname.indexOf('/assets/')
      if (marker >= 0) return url.pathname.slice(0, marker).replace(/\/+$/, '')
    } catch {
      /* fall through to root */
    }
  }

  return ''
}

const BASE = detectBase()

function readLocation(): Route {
  if (ROUTER_MODE === 'hash') {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const [pathname, search = ''] = raw.split('?')
    return {
      path: (pathname || '/').replace(/\/+$/, '') || '/',
      query: new URLSearchParams(search),
    }
  }

  const { pathname, search } = window.location
  let path = pathname.replace(/\/+$/, '')

  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length)
  path = path.replace(/\/index\.html$/, '').replace(/\/+$/, '')

  return {
    path: path || '/',
    query: new URLSearchParams(search),
  }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(readLocation)

  useEffect(() => {
    const onChange = () => setRoute(readLocation())
    window.addEventListener('popstate', onChange)
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('hashchange', onChange)
    }
  }, [])

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>
}

export function useRoute(): Route {
  return useContext(RouteContext)
}

/**
 * Builds the value for an anchor's href. In hash mode this is '#/collection',
 * which resolves correctly regardless of which folder the bundle sits in.
 */
export function toHref(href: string): string {
  if (ROUTER_MODE === 'hash') return href.startsWith('#') ? href : `#${href}`
  if (!BASE || href.startsWith(BASE)) return href
  return `${BASE}${href}`
}

/** Navigate without a full reload. Falls back to normal navigation for external URLs. */
export function navigate(href: string, opts: { replace?: boolean } = {}) {
  try {
    const url = new URL(href, window.location.origin)
    if (url.origin !== window.location.origin) {
      window.location.href = href
      return
    }
  } catch {
    window.location.href = href
    return
  }

  const target = ROUTER_MODE === 'hash' ? `#${href}` : href

  if (opts.replace) {
    window.history.replaceState({}, '', target)
  } else {
    window.history.pushState({}, '', target)
  }

  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

/* ------------------------------------------------------------------ */
/* Favourites — localStorage, this browser only                        */
/* ------------------------------------------------------------------ */

const FAV_KEY = 'jianzhan:favourites:v1'
const FavContext = createContext<{
  favourites: string[]
  toggle: (id: string) => void
  isFavourite: (id: string) => boolean
}>({ favourites: [], toggle: () => {}, isFavourite: () => false })

function readFavourites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const [favourites, setFavourites] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readFavourites(),
  )

  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === FAV_KEY) setFavourites(readFavourites())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const persist = useCallback((next: string[]) => {
    setFavourites(next)
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(next))
    } catch {
      /* storage may be unavailable (private mode) — state still works for the session */
    }
  }, [])

  const toggle = useCallback(
    (id: string) => {
      const current = readFavourites()
      const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id]
      persist(next)
    },
    [persist],
  )

  const isFavourite = useCallback((id: string) => favourites.includes(id), [favourites])

  return (
    <FavContext.Provider value={{ favourites, toggle, isFavourite }}>{children}</FavContext.Provider>
  )
}

export function useFavourites() {
  return useContext(FavContext)
}

/* ------------------------------------------------------------------ */
/* Reduced motion                                                      */
/* ------------------------------------------------------------------ */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

/* ------------------------------------------------------------------ */
/* Scroll reveal                                                       */
/* ------------------------------------------------------------------ */

export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) {
      const showAll = () =>
        document.querySelectorAll<HTMLElement>('.reveal:not(.is-in)').forEach((n) => n.classList.add('is-in'))
      showAll()
      const mo = new MutationObserver(showAll)
      mo.observe(document.body, { childList: true, subtree: true })
      return () => mo.disconnect()
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )

    const observeIn = (root: ParentNode) =>
      root.querySelectorAll<HTMLElement>('.reveal:not(.is-in)').forEach((n) => io.observe(n))

    observeIn(document)

    /*
     * Blocks rendered later — filtered cards, "load more", glaze tab panels —
     * must be observed too, otherwise they stay stuck at opacity 0.
     * childList only (never attributes) so marking a node as revealed cannot loop.
     */
    const mo = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return
          const el = node as HTMLElement
          if (el.classList.contains('reveal') && !el.classList.contains('is-in')) io.observe(el)
          observeIn(el)
        })
      })
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/* ------------------------------------------------------------------ */
/* Body scroll lock for dialogs / drawers                              */
/* ------------------------------------------------------------------ */

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [active])
}

/* ------------------------------------------------------------------ */
/* Escape key                                                          */
/* ------------------------------------------------------------------ */

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onEscape])
}

/* ------------------------------------------------------------------ */
/* Document title / meta description                                   */
/* ------------------------------------------------------------------ */

export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title
    if (description) {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'description'
        document.head.appendChild(meta)
      }
      meta.content = description
    }
  }, [title, description])
}
