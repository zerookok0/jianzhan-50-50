import { useEffect, useRef, type ReactNode } from 'react'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { Close } from './Icons'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Accessible name for the dialog. Required — an unnamed dialog is a trap. */
  label: string
  children: ReactNode
  /** Centred panel on desktop, bottom sheet on phones. */
  variant?: 'center' | 'sheet'
  labelledBy?: string
}

/**
 * MODAL
 * ------------------------------------------------------------------
 * A real dialog, not a styled div:
 *
 *   • Focus moves into the panel on open and returns to the trigger on
 *     close, so keyboard users do not lose their place.
 *   • Tab is trapped inside while it is open. Without the trap, tabbing
 *     walks invisibly through the page behind the overlay.
 *   • Escape closes, and the page behind cannot scroll.
 *   • `aria-modal` + `role="dialog"` so screen readers announce it.
 */
export function Modal({
  open,
  onClose,
  label,
  children,
  variant = 'center',
  labelledBy,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useScrollLock(open)
  useEscape(open, onClose)

  /* Remember what had focus, then move focus into the panel. */
  useEffect(() => {
    if (!open) return

    restoreRef.current = document.activeElement as HTMLElement | null

    // Wait a frame so the panel is mounted and focusable.
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const target =
        panel.querySelector<HTMLElement>(
          'input:not([type="hidden"]), button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? panel
      target.focus({ preventScroll: true })
    })

    return () => {
      window.cancelAnimationFrame(id)
      // Returning focus to the trigger is what makes Escape feel finished.
      restoreRef.current?.focus?.({ preventScroll: true })
    }
  }, [open])

  /* Focus trap. */
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return

      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement)

      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div
      className={`modal modal--${variant}`}
      role="dialog"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        // Close on a backdrop click, but not on a drag that ends outside.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <button
          type="button"
          className="qv__close"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
        >
          <Close width={16} height={16} />
        </button>
        {children}
      </div>
    </div>
  )
}

export default Modal
