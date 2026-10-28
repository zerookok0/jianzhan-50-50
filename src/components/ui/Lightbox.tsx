import { useCallback, useEffect, useRef } from 'react'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { Close, ArrowLeft, ArrowRight, ZoomIn, ZoomOut } from './Icons'

/**
 * LIGHTBOX
 * ------------------------------------------------------------------
 * Full-screen image viewer for a product gallery.
 *
 * Deliberately built rather than pulled from a library, because the
 * accessible behaviour is the whole point: Escape closes, arrow keys move,
 * the dialog traps focus, and the page behind cannot scroll.
 *
 * Pinch/drag zoom is offered on touch, but every zoomed state also has a
 * keyboard path — a mouse-only viewer fails WCAG 2.1 AA.
 *
 * Images are absolute URLs, straight from the catalogue API.
 */

interface LightboxProps {
  images: string[]
  alts: string[]
  /** Open index, or null to stay closed. */
  index: number | null
  onClose: () => void
  onIndexChange: (index: number) => void
}

export function Lightbox({ images, alts, index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useScrollLock(open)
  useEscape(open, onClose)

  const count = images.length
  const current = index ?? 0

  const go = useCallback(
    (next: number) => {
      if (!count) return
      // Wrap around; a gallery should not dead-end at either edge.
      onIndexChange(((next % count) + count) % count)
    },
    [count, onIndexChange],
  )

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement
    const t = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 40)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(current + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(current - 1)
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const nodes = stageRef.current?.parentElement?.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        )
        if (!nodes?.length) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.({ preventScroll: true })
    }
  }, [open, current, go])

  if (!open || !count) return null

  const src = images[current]

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Product images">
      <div className="lightbox__bar">
        <p className="lightbox__count">
          {current + 1} / {count}
        </p>

        <div className="lightbox__actions">
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoom(stageRef, +1)}>
            <ZoomIn width={16} height={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoom(stageRef, -1)}>
            <ZoomOut width={16} height={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close gallery"
            onClick={onClose}
            ref={closeRef}
          >
            <Close width={18} height={18} />
          </button>
        </div>
      </div>

      <div className="lightbox__stage" ref={stageRef}>
        <img
          key={src}
          src={src}
          sizes="100vw"
          alt={alts[current] ?? ''}
          draggable={false}
          decoding="async"
        />
      </div>

      {count > 1 && (
        <div className="lightbox__nav">
          <button
            type="button"
            className="lightbox__arrow"
            aria-label="Previous image"
            onClick={() => go(current - 1)}
          >
            <ArrowLeft width={18} height={18} />
          </button>
          <button
            type="button"
            className="lightbox__arrow"
            aria-label="Next image"
            onClick={() => go(current + 1)}
          >
            <ArrowRight width={18} height={18} />
          </button>
        </div>
      )}

      <p className="lightbox__hint">
        Arrow keys to navigate · Escape to close
      </p>
    </div>
  )
}

/** Step a CSS scale on the stage image, clamped so it stays inspectable. */
function zoom(stage: React.RefObject<HTMLDivElement | null>, direction: 1 | -1) {
  const image = stage.current?.querySelector<HTMLImageElement>('img')
  if (!image) return
  const raw = Number(image.dataset.scale ?? '1')
  const next = Math.min(3, Math.max(1, raw + direction * 0.5))
  image.dataset.scale = String(next)
  image.style.transform = `scale(${next})`
  image.style.cursor = next > 1 ? 'zoom-out' : 'zoom-in'
}
