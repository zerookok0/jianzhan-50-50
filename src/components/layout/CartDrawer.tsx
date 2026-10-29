import { useEffect, useRef, useState } from 'react'
import { useCart } from '../../lib/cart'
import { formatMinor, errorLabel } from '../../lib/api/client'
import { useEscape, useScrollLock, navigate } from '../../lib/hooks'
import { AppLink } from '../ui/Media'
import { Alert, Close, Minus, Plus } from '../ui/Icons'

/**
 * CART DRAWER
 * ------------------------------------------------------------------
 * Slide-over cart. Every number in it came from the server on the last
 * mutation; nothing is recalculated here.
 *
 * Behaviour worth stating explicitly:
 *   • Focus is trapped while open, and returns to the cart button on close.
 *   • The quantity stepper disables "+" at the server's stated availability
 *     rather than letting the user discover the limit through a 409.
 *   • An out-of-stock line blocks checkout and says which line it is. A
 *     silent 409 at payment time is the worst possible moment to learn.
 */
export function CartDrawer() {
  const {
    cart,
    drawerOpen,
    closeDrawer,
    setQuantity,
    remove,
    busyKey,
    error,
    clearError,
    applyCoupon,
    removeCoupon,
    couponError,
    clearCouponError,
    loading,
  } = useCart()

  const [code, setCode] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useScrollLock(drawerOpen)
  useEscape(drawerOpen, closeDrawer)

  /* Focus management: in on open, back to the trigger on close. */
  useEffect(() => {
    if (!drawerOpen) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus({
        preventScroll: true,
      })
    })
    return () => {
      window.cancelAnimationFrame(id)
      restoreRef.current?.focus?.({ preventScroll: true })
    }
  }, [drawerOpen])

  /* Focus trap. */
  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null)
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const currency = cart?.currency ?? 'USD'
  const minorUnit = cart?.minorUnit ?? 2
  const money = (amount: number) => formatMinor(amount, currency, minorUnit)

  const items = cart?.items ?? []
  const hasIssues = items.some((item) => !item.inStock)
  const empty = items.length === 0

  const submitCoupon = async () => {
    const trimmed = code.trim()
    if (!trimmed) return
    const ok = await applyCoupon(trimmed)
    if (ok) setCode('')
  }

  return (
    <>
      <div
        className={`cart-scrim ${drawerOpen ? 'is-open' : ''}`}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <aside
        className={`cart-drawer ${drawerOpen ? 'is-open' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        aria-hidden={!drawerOpen}
      >
        <div className="cart-drawer__head">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 className="cart-drawer__title">
              {empty ? 'Cart is empty' : `${items.length} piece${items.length === 1 ? '' : 's'}`}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={closeDrawer}
            aria-label="Close cart"
          >
            <Close width={18} height={18} />
          </button>
        </div>

        {error && (
          <p className="cart-drawer__alert" role="alert">
            <Alert width={14} height={14} aria-hidden="true" />
            <span>{errorLabel(error)}</span>
            <button type="button" className="cart-drawer__dismiss" onClick={clearError}>
              Dismiss
            </button>
          </p>
        )}

        <div className="cart-drawer__body">
          {loading && empty && <p className="meta">Loading your cart…</p>}

          {empty && !loading && (
            <div className="cart-drawer__empty">
              <p className="cart-drawer__note">
                No pieces selected yet. Each firing produces only a handful of bowls, so the
                collection changes often.
              </p>
              <AppLink
                href="/collection"
                className="btn btn--outline"
                onClick={closeDrawer}
              >
                Browse the collection
              </AppLink>
            </div>
          )}

          {!empty && (
            <ul className="cart-lines">
              {items.map((item) => {
                const busy = busyKey === item.itemId
                const atMax =
                  item.available !== null && item.quantity >= item.available

                return (
                  <li className="cart-line" key={item.itemId}>
                    {item.imageUrl && (
                      <img
                        className="cart-line__img"
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                      />
                    )}

                    <div className="cart-line__body">
                      <p className="cart-line__name">{item.name}</p>
                      {item.variantLabel && (
                        <p className="cart-line__variant">{item.variantLabel}</p>
                      )}
                      <p className="cart-line__price">
                        {money(item.unitPrice)} each
                      </p>

                      {!item.inStock && (
                        <p className="cart-line__variant" style={{ color: '#ef4444' }}>
                          No longer available — remove to continue
                        </p>
                      )}

                      <div className="cart-line__actions">
                        <div className="qty">
                          <button
                            type="button"
                            onClick={() => void setQuantity(item.itemId, item.quantity - 1)}
                            disabled={busy}
                            aria-label={`Decrease quantity of ${item.name}`}
                          >
                            <Minus width={12} height={12} />
                          </button>
                          <span aria-live="polite" aria-label={`Quantity ${item.quantity}`}>
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => void setQuantity(item.itemId, item.quantity + 1)}
                            disabled={busy || atMax}
                            aria-label={`Increase quantity of ${item.name}`}
                            title={atMax ? 'No more units available' : undefined}
                          >
                            <Plus width={12} height={12} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="cart-line__remove"
                          onClick={() => void remove(item.itemId)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <p className="summary-item__price">{money(item.lineSubtotal)}</p>
                  </li>
                )
              })}
            </ul>
          )}

          {!empty && (
            <div className="cart-coupon-group" style={{ display: 'grid', gap: 10 }}>
              <form
                className="cart-coupon"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitCoupon()
                }}
              >
                <label className="sr-only" htmlFor="coupon-code">
                  Discount code
                </label>
                <input
                  id="coupon-code"
                  className="field__input"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    if (couponError) clearCouponError()
                  }}
                  placeholder="Discount code"
                  autoComplete="off"
                />
                <button type="submit" className="btn btn--outline" disabled={!code.trim()}>
                  Apply
                </button>
              </form>

              {couponError && (
                <p className="field__error" role="alert">
                  {couponError}
                </p>
              )}

              {cart && cart.coupons.length > 0 && (
                <ul className="cart-coupons">
                  {cart.coupons.map((applied) => (
                    <li key={applied}>
                      <span>{applied}</span>
                      <button
                        type="button"
                        onClick={() => void removeCoupon(applied)}
                        aria-label={`Remove discount code ${applied}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {!empty && cart && (
          <div className="cart-drawer__foot">
            <dl className="summary-totals summary-totals--compact">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(cart.totals.subtotal)}</dd>
              </div>

              {cart.totals.discountTotal > 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd>−{money(cart.totals.discountTotal)}</dd>
                </div>
              )}

              {cart.totals.shippingTotal > 0 && (
                <div>
                  <dt>Shipping</dt>
                  <dd>{money(cart.totals.shippingTotal)}</dd>
                </div>
              )}

              {cart.totals.taxTotal > 0 && (
                <div>
                  <dt>{cart.tax.label ?? 'Tax'}</dt>
                  <dd>{money(cart.totals.taxTotal)}</dd>
                </div>
              )}

              <div className="summary-totals__grand">
                <dt>Total</dt>
                <dd>{money(cart.totals.grandTotal)}</dd>
              </div>
            </dl>

            <p className="cart-drawer__hint">
              {cart.totals.shippingTotal === 0 && cart.needsShipping
                ? 'Delivery is calculated at checkout once the destination is known.'
                : 'Tax and delivery are confirmed by our store at checkout.'}
            </p>

            <button
              type="button"
              className="btn btn--solid btn--block"
              disabled={hasIssues}
              onClick={() => {
                closeDrawer()
                navigate('/checkout')
              }}
            >
              Proceed to checkout
            </button>

            <button
              type="button"
              className="cart-drawer__alt"
              onClick={closeDrawer}
            >
              Continue browsing
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

export default CartDrawer
