import {
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { img, srcSet, PHOTOS, type ImageKey } from '../../data/images'
import { navigate } from '../../lib/hooks'

/* ================================================================== */
/* AppLink — internal navigation without a full reload                */
/* ================================================================== */

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  children: ReactNode
  /** Accessible name, when the visible text is not enough. */
  ariaLabel?: string
  /** Treat as external even when the href looks internal. */
  external?: boolean
}

const isExternal = (href: string) =>
  /^(https?:)?\/\//.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')

/**
 * Internal links go through the client router; anything else is a normal
 * navigation. Modifier clicks (new tab, save, middle-click) are left alone
 * so the browser's own behaviour is never broken.
 */
export function AppLink({ href, children, ariaLabel, external, onClick, ...rest }: AppLinkProps) {
  const absolute = isExternal(href) || external === true

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    if (absolute) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return

    event.preventDefault()
    navigate(href)
  }

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      onClick={handleClick}
      {...(absolute && href.startsWith('http') ? { rel: 'noreferrer noopener' } : {})}
      {...rest}
    >
      {children}
    </a>
  )
}

/* ================================================================== */
/* MediaImage — a photo by registry key, with reserved space          */
/* ================================================================== */

interface MediaImageProps {
  image: ImageKey
  alt: string
  /** width / height. Reserving the box prevents layout shift. */
  ratio?: number
  sizes?: string
  className?: string
  priority?: boolean
}

/**
 * The aspect-ratio box is set inline rather than in CSS because the value
 * varies per usage and a fixed class per ratio would multiply the stylesheet
 * for no gain. `object-fit: cover` lives in `.media img`.
 */
export function MediaImage({
  image,
  alt,
  ratio = 4 / 5,
  sizes = '(min-width: 900px) 45vw, 92vw',
  className = '',
  priority = false,
}: MediaImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div
      className={`media media--reveal ${loaded ? 'is-loaded' : ''} ${
        failed ? 'is-error' : ''
      } ${className}`}
      style={{ aspectRatio: `${ratio}` }}
    >
      <img
        src={img(image, 1200)}
        srcSet={srcSet(image)}
        sizes={sizes}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />

      {/* Shown only if the photo cannot be fetched: names the slot so the
          gap is diagnosable rather than a silent grey rectangle. */}
      <div className="media__fallback" aria-hidden="true">
        <span>Image unavailable</span>
        <code>{String(image)}</code>
      </div>
    </div>
  )
}

/* ================================================================== */
/* ProductImage — the same contract, but from an absolute URL          */
/* ================================================================== */

interface ProductImageProps {
  /** Absolute URL from the API, or '' when a piece has no photo yet. */
  src: string
  alt: string
  ratio?: number
  sizes?: string
  className?: string
  priority?: boolean
}

/**
 * Product photographs come from `product_images.url`, which the API serves
 * as an absolute URL — they are not in the local registry, so `img()` and
 * `srcSet()` cannot be used here. The CDN handles resizing for the Pexels
 * URLs we seed; an R2 URL serves one size.
 */
export function ProductImage({
  src,
  alt,
  ratio = 1,
  sizes = '(min-width: 900px) 45vw, 92vw',
  className = '',
  priority = false,
}: ProductImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(!src)

  return (
    <div
      className={`media media--reveal ${loaded ? 'is-loaded' : ''} ${
        failed ? 'is-error' : ''
      } ${className}`}
      style={{ aspectRatio: `${ratio}` }}
    >
      {src && !failed && (
        <img
          src={src}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}

      <div className="media__fallback" aria-hidden="true">
        <span>{failed ? 'Photograph pending' : 'Loading'}</span>
        {failed && <code>no image</code>}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Credit line (Pexels attribution, optional)                          */
/* ================================================================== */

export function PhotoCredit({ image }: { image: ImageKey }) {
  return (
    <span className="meta" style={{ fontSize: 9, opacity: 0.55 }}>
      {PHOTOS[image].note} · Pexels
    </span>
  )
}
