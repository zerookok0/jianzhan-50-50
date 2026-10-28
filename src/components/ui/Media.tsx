import { useState, type MouseEvent, type ReactNode } from 'react'
import { img, srcSet, type ImageKey } from '../../data/images'
import { navigate } from '../../lib/hooks'

interface MediaProps {
  image: ImageKey
  alt: string
  /** Aspect ratio as width / height, e.g. 3/4 */
  ratio?: number
  sizes?: string
  priority?: boolean
  className?: string
  imgClassName?: string
  overlay?: ReactNode
  /** Show the source path when the file cannot be loaded */
  showFallbackNote?: boolean
}

/**
 * Responsive image with a gentle fade-in and a visible fallback if the
 * photo cannot be loaded (so a missing asset is obvious, never silent).
 */
export function MediaImage({
  image,
  alt,
  ratio = 3 / 4,
  sizes = '100vw',
  priority = false,
  className = '',
  imgClassName = '',
  overlay,
  showFallbackNote = false,
}: MediaProps) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  return (
    <div
      className={`media media--reveal ${loaded ? 'is-loaded' : ''} ${errored ? 'is-error' : ''} ${className}`}
      style={{ aspectRatio: String(ratio) }}
    >
      {!errored && (
        <img
          src={img(image, priority ? 1600 : 1200)}
          srcSet={srcSet(image) || undefined}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : 'auto'}
          width={1200}
          height={Math.round(1200 / ratio)}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={imgClassName}
        />
      )}
      <div className="media__fallback" aria-hidden={!errored}>
        <span>Image unavailable</span>
        {showFallbackNote && <code>src/data/images.ts → {image}</code>}
      </div>
      {overlay}
    </div>
  )
}

interface AppLinkProps {
  href: string
  children: ReactNode
  className?: string
  onClick?: () => void
  ariaLabel?: string
  /** Force normal browser navigation (needed for WordPress checkout) */
  external?: boolean
  title?: string
}

/**
 * Internal links are handled by the lightweight router; external links use
 * ordinary browser navigation so WordPress receives the visitor normally.
 */
export function AppLink({
  href,
  children,
  className,
  onClick,
  ariaLabel,
  external,
  title,
}: AppLinkProps) {
  const isExternal =
    external ||
    /^https?:\/\//i.test(href) ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:')

  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (isExternal) {
      onClick?.()
      return
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    onClick?.()
    navigate(href)
  }

  return (
    <a
      href={href}
      className={className}
      onClick={handle}
      aria-label={ariaLabel}
      title={title}
      {...(isExternal && href.startsWith('http')
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
    >
      {children}
    </a>
  )
}
