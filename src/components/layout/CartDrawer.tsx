import { useEffect, useRef, useState } from 'react'
import { useCart } from '../../lib/cart'
import { formatMinor } from '../../lib/api/client'
import { AppLink } from '../ui/Media'
import { Close, Minus, Plus, Info } from '../ui/Icons'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { storeEnabled } from '../../config/store'

/**
 * Slide-over cart. Renders only in live mode, so the catalogue-only build
 * carries no dead UI.
 *
 * Everything displayed comes from the server's cart object — the drawer
 * performs no price arithmetic of its own.
 */
export function CartDrawer() {
  const {
    cart,
    drawerOpen,
    closeDrawer,
    setQuantity,
    remove,
    busyKey,
    loading,
    error,
    clearError,
    applyCoupon,
    removeCoupon,
    couponError,
    clearCouponError,
  } = useCart()

  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [coupon, setCoupon] = useState('')

  useScrollLock(drawerOpen)
  useEscape(drawerOpen, closeDrawer)

  useEffect(() => {
    if (!drawerOpen) return
    previouslyFocused.current = document.activeElement as HTMLElement
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, a[href], input, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus({ preventScroll: true })
    return () => previouslyFocused.current?.focus?.({ preventScroll: true })
  }, [drawerOpen])

  if (!storeEnabled()) return null

  const items = cart?.items ?? []
  const totals = cart?.totals
  const currency = cart?.currency ?? 'USD'
  const minorUnit = cart?.minorUnit ?? 2
  const coupons = cart?.coupons ?? []

  const money = (n: number) => formatMinor(n, currency, minorUnit)

  return (
    <>
      <div
        className={`cart-scrim ${drawerOpen ? 'is-open' : ''}`}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <aside
        className={`cart-drawer ${drawerOpen ? 'is-open' : ''}`}
        aria-hidden={!drawerOpen}
        aria-label="Shopping cart"
        ref={panelRef}
      >
        <header className="cart-drawer__head">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 className="cart-drawer__title">
              Cart{cart?.itemCount ? ` (${cart.itemCount})` : ''}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={closeDrawer} aria-label="Close cart">
            <Close width={18} height={18} />
          </button>
        </header>

        {error && (
          <div className="cart-drawer__alert" role="alert">
            <Info width={14} height={14} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={clearError} className="cart-drawer__dismiss">
              Dismiss
            </button>
          </div>
        )}

        <div className="cart-drawer__body">
          {loading && items.length === 0 && <p className="cart-drawer__note">Loading cart…</p>}

          {!loading && items.length === 0 && (
            <div className="cart-drawer__empty">
              <p className="cart-drawer__note">Your cart is empty.</p>
              <AppLink href="/collection" className="btn btn--outline" onClick={closeDrawer}>
                Browse the collection
              </AppLink>
            </div>
          )}

          {items.length > 0 && (
            <ul className="cart-lines">
              {items.map((it) => (
                <li key={it.itemId} className="cart-line">
                  {it.imageUrl && (
                    <img
                      src={it.imageUrl}
                      alt=""
                      className="cart-line__img"
                      loading="lazy"
                      width={72}
                      height={90}
                    />
                  )}
                  <div className="cart-line__body">
                    <p className="cart-line__name">{it.name}</p>
                    {it.variantLabel && <p className="cart-line__variant">{it.variantLabel}</p>}
                    <p className="cart-line__price">{money(it.lineSubtotal)}</p>

                    <div className="cart-line__actions">
                      <div className="qty">
                        <button
                          type="button"
                          onClick={() => void setQuantity(it.itemId, it.quantity - 1)}
                          disabled={busyKey === it.itemId}
                          aria-label={`Decrease quantity of ${it.name}`}
                        >
                          <Minus width={12} height={12} />
                        </button>
                        <span aria-live="polite">{it.quantity}</span>
                        <button
                          type="button"
                          onClick={() => void setQuantity(it.itemId, it.quantity + 1)}
                          disabled={
                            busyKey === it.itemId ||
                            (it.maxQuantity !== null && it.quantity >= it.maxQuantity)
                          }
                          aria-label={`Increase quantity of ${it.name}`}
                        >
                          <Plus width={12} height={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="cart-line__remove"
                        onClick={() => void remove(it.itemId)}
                        disabled={busyKey === it.itemId}
                      >
                        Remove
                      </button>
                    </div>

                    {!it.inStock && (
                      <p className="cart-line__warn">
                        {it.available === 0
                          ? 'Sold out — remove to continue.'
                          : `Only ${it.available} available.`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {items.length > 0 && (
            <form
              className="cart-coupon"
              onSubmit={(e) => {
                e.preventDefault()
                if (coupon.trim()) void applyCoupon(coupon).then((ok) => ok && setCoupon(''))
              }}
            >
              <label className="sr-only" htmlFor="coupon">
                Discount code
              </label>
              <input
                id="coupon"
                className="field__input"
                placeholder="Discount code"
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value)
                  if (couponError) clearCouponError()
                }}
              />
              <button type="submit" className="btn btn--outline">
                Apply
              </button>
            </form>
          )}

          {couponError && (
            <p className="field__error" role="alert">
              {couponError}
            </p>
          )}

          {coupons.length > 0 && (
            <ul className="cart-coupons">
              {coupons.map((c) => (
                <li key={c.code} className={c.accepted ? '' : 'is-rejected'}>
                  <span>{c.code}</span>
                  {c.accepted ? (
                    <button type="button" onClick={() => void removeCoupon(c.code)}>
                      Remove
                    </button>
                  ) : (
                    <em>{c.message ?? 'Not applied'}</em>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && totals && (
          <footer className="cart-drawer__foot">
            <dl className="summary-totals summary-totals--compact">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(totals.subtotal)}</dd>
              </div>
              {totals.discountTotal > 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd>−{money(totals.discountTotal)}</dd>
                </div>
              )}
              {totals.taxTotal > 0 && (
                <div>
                  <dt>Tax</dt>
                  <dd>{money(totals.taxTotal)}</dd>
                </div>
              )}
              <div className="summary-totals__grand">
                <dt>Total</dt>
                <dd>{money(totals.grandTotal)}</dd>
              </div>
            </dl>

            <p className="cart-drawer__hint">
              Shipping is calculated at checkout once we know the destination.
            </p>

            <AppLink href="/checkout" className="btn btn--solid btn--block" onClick={closeDrawer}>
              Checkout
            </AppLink>
          </footer>
        )}
      </aside>
    </>
  )
}
