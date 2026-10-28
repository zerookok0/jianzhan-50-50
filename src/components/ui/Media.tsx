import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import { img, srcSet, type ImageKey } from '../../data/images'
import { navigate } from '../../lib/hooks'

/**
 * MEDIA & LINKS
 * ------------------------------------------------------------------
 * Two rules made explicit here:
 *
 *   • Images come from the central library in `src/data/images.ts`, so a
 *     swap happens in one file rather than across components.
 *   • Every image reserves its box via `ratio`, so nothing shifts while
 *     loading. A failed image shows a labelled fallback instead of a
 *     broken icon — a gallery that silently gapes is worse than one that
 *     admits the photo is missing.
 */

/* ------------------------------------------------------------------ */
/* AppLink                                                             */
/* ------------------------------------------------------------------ */

interface AppLinkProps {
  href: string
  children: ReactNode
  className?: string
  ariaLabel?: string
  onClick?: () => void
  'data-delay'?: string | number
}

/**
 * Internal navigation that does not reload the page. External links keep
 * native behaviour (and get the correct rel attributes).
 */
export function AppLink({
  href,
  children,
  className,
  ariaLabel,
  onClick,
  ...rest
}: AppLinkProps) {
  const external = /^(https?:)?\/\//.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')

  if (external) {
    return (
      <a
        href={href}
        className={className}
        aria-label={ariaLabel}
        onClick={onClick}
        rel="noopener noreferrer"
        target={href.startsWith('http') ? '_blank' : undefined}
        {...rest}
      >
        {children}
      </a>
    )
  }

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Preserve modifier clicks and middle clicks so new tabs still work.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    onClick?.()
    // A plain '#anchor' stays in-page.
    if (href.startsWith('#')) return
    e.preventDefault()
    navigate(href)
  }

  return (
    <a href={href} className={className} aria-label={ariaLabel} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* MediaImage                                                          */
/* ------------------------------------------------------------------ */

interface MediaImageProps {
  image: ImageKey
  alt: string
  /** width / height. Reserves the box so layout does not shift. */
  ratio?: number
  sizes?: string
  priority?: boolean
  className?: string
  /** Show the image key in the fallback, as a note to the editor. */
  showFallbackNote?: boolean
  width?: number
}

export function MediaImage({
  image,
  alt,
  ratio = 4 / 5,
  sizes = '100vw',
  priority = false,
  className = '',
  showFallbackNote = false,
}: MediaImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const baseWidth = 1200
  const src = img(image, baseWidth)

  return (
    <div
      className={`media media--reveal ${loaded ? 'is-loaded' : ''} ${
        failed ? 'is-error' : ''
      } ${className}`}
      style={{ aspectRatio: String(ratio) }}
    >
      {!failed && (
        <img
          src={src}
          srcSet={srcSet(image)}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}

      <div className="media__fallback">
        <span>{alt || 'Image unavailable'}</span>
        {showFallbackNote && <code>{image}</code>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ProductImage — absolute URL                                         */
/* ------------------------------------------------------------------ */

interface ProductImageProps {
  /** Absolute URL as returned by the catalogue API. */
  src: string | undefined
  alt: string
  ratio?: number
  sizes?: string
  priority?: boolean
  className?: string
}

/**
 * Why this exists alongside MediaImage: catalogue records carry absolute
 * URLs from D1 (or the CDN), not keys into the local image library. The
 * loading and failure behaviour is deliberately identical, so a photo
 * that 404s looks the same whichever source it came from — a labelled
 * fallback rather than a broken icon.
 */
export function ProductImage({
  src,
  alt,
  ratio = 4 / 5,
  sizes = '100vw',
  priority = false,
  className = '',
}: ProductImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reset the states when the source changes, so a stale "failed" flag
  // cannot hide a perfectly good second image.
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  return (
    <div
      className={`media media--reveal ${loaded ? 'is-loaded' : ''} ${
        failed || !src ? 'is-error' : ''
      } ${className}`}
      style={{ aspectRatio: String(ratio) }}
    >
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          sizes={sizes}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}

      <div className="media__fallback">
        <span>{alt || 'Image unavailable'}</span>
      </div>
    </div>
  )
}
