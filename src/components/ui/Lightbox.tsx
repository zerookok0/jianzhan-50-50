import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { ChevronLeft, ChevronRight, Close, Expand } from './Icons'

interface LightboxProps {
  images: string[]
  alts: string[]
  /** Open when this is a number; closed when null. */
  index: number | null
  onClose: () => void
  onIndexChange: (index: number) => void
}

const SWIPE_THRESHOLD = 48

/**
 * LIGHTBOX
 * ------------------------------------------------------------------
 * Full-screen image viewer with keyboard, swipe and pinch-free zoom.
 *
 * Why a portal: the product page mounts it deep inside a grid, and at
 * `position: fixed` a transformed ancestor would break the overlay. A
 * portal to `document.body` sidesteps that entirely.
 *
 * Controls: ← → to move, Escape to close, + / − to zoom, double-tap to
 * toggle zoom on touch.
 */
export function Lightbox({ images, alts, index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useScrollLock(open)
  useEscape(open, onClose)

  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Reset the view whenever the picture changes: carrying a 2x zoom onto
  // the next image makes the gallery feel broken.
  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [index])

  const step = useCallback(
    (delta: number) => {
      if (index === null || images.length === 0) return
      const next = (index + delta + images.length) % images.length
      onIndexChange(next)
    },
    [index, images.length, onIndexChange],
  )

  /* Keyboard: arrows, escape, zoom. */
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom((z) => Math.min(3, z + 0.5))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom((z) => {
          const next = Math.max(1, z - 0.5)
          if (next === 1) setOffset({ x: 0, y: 0 })
          return next
        })
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, step])

  /* Swipe to navigate, drag to pan when zoomed. */
  const onPointerDown = (event: React.PointerEvent) => {
    if (zoom > 1) {
      dragRef.current = {
        x: offset.x,
        y: offset.y,
        startX: event.clientX,
        startY: event.clientY,
      }
    } else {
      dragRef.current = { x: 0, y: 0, startX: event.clientX, startY: event.clientY }
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (zoom > 1) {
      setOffset({ x: drag.x + dx, y: drag.y + dy })
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || zoom > 1) return

    const dx = event.clientX - drag.startX
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    step(dx < 0 ? 1 : -1)
  }

  if (!open || index === null) return null

  const current = images[index] ?? ''
  const total = images.length

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} of ${total}`}
    >
      <div className="lightbox__bar">
        <p className="lightbox__count">
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </p>

        <div className="lightbox__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
            aria-label={zoom === 1 ? 'Zoom in' : 'Zoom out'}
            aria-pressed={zoom > 1}
          >
            <Expand width={16} height={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer">
            <Close width={16} height={16} />
          </button>
        </div>
      </div>

      <div
        className="lightbox__stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
      >
        <img
          src={current}
          alt={alts[index] ?? ''}
          draggable={false}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
            transition: dragRef.current ? 'none' : undefined,
          }}
        />
      </div>

      {total > 1 && (
        <div className="lightbox__nav">
          <button
            type="button"
            className="lightbox__arrow"
            onClick={() => step(-1)}
            aria-label="Previous image"
          >
            <ChevronLeft width={18} height={18} />
          </button>
          <button
            type="button"
            className="lightbox__arrow"
            onClick={() => step(1)}
            aria-label="Next image"
          >
            <ChevronRight width={18} height={18} />
          </button>
        </div>
      )}

      <p className="lightbox__hint">
        {zoom > 1 ? 'Drag to pan · − to reset' : '← → to browse · + to zoom · Esc to close'}
      </p>
    </div>,
    document.body,
  )
}

export default Lightbox
