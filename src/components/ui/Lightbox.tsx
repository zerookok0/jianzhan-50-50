import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, srcSet, type ImageKey } from '../../data/images'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { ArrowRight, Close, Minus, Plus } from './Icons'

interface LightboxProps {
  images: ImageKey[]
  alts?: string[]
  index: number | null
  onClose: () => void
  onIndexChange: (i: number) => void
}

/**
 * Full-screen image viewer with zoom, pan-when-zoomed, keyboard support
 * (arrows, Escape, +/-, 0 to reset) and touch gestures (pinch / drag).
 * Zoom is a smooth transform — we never imply a 360° view we don't have.
 */
export function Lightbox({ images, alts = [], index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)

  useScrollLock(open)
  useEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [index, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.4))
      if (e.key === '-') setZoom((z) => Math.max(1, z - 0.4))
      if (e.key === '0') {
        setZoom(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  if (!open || index === null) return null

  const next = () => onIndexChange((index + 1) % images.length)
  const prev = () => onIndexChange((index - 1 + images.length) % images.length)
  const current = images[index]

  const clampOffset = (x: number, y: number, z: number) => {
    const limit = ((z - 1) / z) * 320
    return {
      x: Math.max(-limit, Math.min(limit, x)),
      y: Math.max(-limit, Math.min(limit, y)),
    }
  }

  const toggleZoom = () => {
    if (zoom > 1) {
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    } else {
      setZoom(2.2)
    }
  }

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div className="lightbox__bar">
        <span className="lightbox__count">
          {String(index + 1).padStart(2, '0')} / {String(images.length).padStart(2, '0')}
        </span>
        <div className="lightbox__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom((z) => Math.max(1, z - 0.4))}
            aria-label="Zoom out"
            disabled={zoom <= 1}
          >
            <Minus />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom((z) => Math.min(4, z + 0.4))}
            aria-label="Zoom in"
            disabled={zoom >= 4}
          >
            <Plus />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer">
            <Close />
          </button>
        </div>
      </div>

      <div
        className="lightbox__stage"
        onDoubleClick={toggleZoom}
        onPointerDown={(e) => {
          if (zoom <= 1) return
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (!d) return
          setOffset(clampOffset(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), zoom))
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const [a, b] = Array.from(e.touches)
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
            pinchRef.current = { dist, zoom }
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchRef.current) {
            const [a, b] = Array.from(e.touches)
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
            const ratio = dist / pinchRef.current.dist
            setZoom(Math.max(1, Math.min(4, pinchRef.current.zoom * ratio)))
          }
        }}
        onTouchEnd={() => {
          pinchRef.current = null
        }}
      >
        <img
          key={current + index}
          src={img(current, 2000)}
          srcSet={srcSet(current) || undefined}
          sizes="100vw"
          alt={alts[index] ?? `Photograph ${index + 1}`}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? 'grab' : 'zoom-in',
          }}
          onClick={zoom === 1 ? toggleZoom : undefined}
          draggable={false}
        />
      </div>

      {images.length > 1 && (
        <div className="lightbox__nav">
          <button type="button" className="lightbox__arrow" onClick={prev} aria-label="Previous image">
            <ArrowRight style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" className="lightbox__arrow" onClick={next} aria-label="Next image">
            <ArrowRight />
          </button>
        </div>
      )}

      <p className="lightbox__hint">Double-click or pinch to zoom · Arrow keys to browse · Esc to close</p>
    </div>,
    document.body,
  )
}
