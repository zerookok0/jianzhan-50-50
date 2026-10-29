import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEscape, useScrollLock } from '../../lib/hooks'
import { useCart } from '../../lib/cart'
import { formatPrice } from '../../data/products'
import { checkout } from '../../lib/wordpress'
import { AppLink } from '../ui/Media'
import { ArrowUpRight, Close, Minus, Plus } from '../ui/Icons'

/**
 * CART DRAWER
 * ------------------------------------------------------------------
 * A right-hand panel listing what the visitor picked. It deliberately
 * holds no payment or address fields: "Checkout" hands the list to the
 * WordPress store, which owns the rest of the purchase.
 */
export function CartDrawer() {
  const { lines, isOpen, closeCart, count, subtotal, currency, setQty, removeItem } = useCart()
  const panelRef = useRef<HTMLDivElement>(null)

  useScrollLock(isOpen)
  useEscape(isOpen, closeCart)

  // Move focus into the panel when it opens so keyboard users land here.
  useEffect(() => {
    if (!isOpen) return
    const first = panelRef.current?.querySelector<HTMLElement>('button, a[href]')
    first?.focus({ preventScroll: true })
  }, [isOpen])

  if (!isOpen) return null

  const handleCheckout = () => {
    const ok = checkout(
      lines.map((line) => ({
        id: line.wooId,
        qty: line.qty,
        variationId: line.variationId,
      })),
    )
    if (ok) closeCart()
  }

  return createPortal(
    <div className="cart-drawer" role="presentation">
      <div className="cart-drawer__scrim" onClick={closeCart} aria-hidden="true" />

      <div
        className="cart-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="cart-drawer__head">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 id="cart-title" className="display display--sm">
              Cart{count > 0 && <span className="cart-drawer__count"> ({count})</span>}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={closeCart}
            aria-label="Close cart"
          >
            <Close width={18} height={18} />
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="cart-drawer__empty">
            <p className="serif-italic cart-drawer__empty-line">Nothing chosen yet.</p>
            <p className="body">
              Pieces you select will gather here. Checkout, payment and shipping all happen on our
              store.
            </p>
            <AppLink href="/collection" className="btn btn--outline" onClick={closeCart}>
              Browse the collection
            </AppLink>
          </div>
        ) : (
          <>
            <ul className="cart-lines">
              {lines.map((line) => (
                <li key={line.key} className="cart-line">
                  <AppLink
                    href={`/collection/${line.slug}`}
                    className="cart-line__media"
                    onClick={closeCart}
                    ariaLabel={`View ${line.name}`}
                  >
                    <img src={line.image} alt="" loading="lazy" width={80} height={96} />
                  </AppLink>

                  <div className="cart-line__body">
                    <AppLink
                      href={`/collection/${line.slug}`}
                      className="cart-line__name"
                      onClick={closeCart}
                    >
                      {line.name}
                    </AppLink>

                    {line.variantLabel && (
                      <p className="cart-line__variant">{line.variantLabel}</p>
                    )}

                    <p className="cart-line__unit">
                      {formatPrice(line.price, line.currency)} <span>each</span>
                    </p>

                    <div className="cart-line__foot">
                      <div className="qty">
                        <button
                          type="button"
                          className="qty__btn"
                          onClick={() => setQty(line.key, line.qty - 1)}
                          aria-label={`Decrease quantity of ${line.name}`}
                          disabled={line.qty <= 1}
                        >
                          <Minus width={12} height={12} />
                        </button>
                        <span className="qty__value" aria-live="polite">
                          {line.qty}
                        </span>
                        <button
                          type="button"
                          className="qty__btn"
                          onClick={() => setQty(line.key, line.qty + 1)}
                          aria-label={`Increase quantity of ${line.name}`}
                          disabled={line.qty >= 99}
                        >
                          <Plus width={12} height={12} />
                        </button>
                      </div>

                      <button
                        type="button"
                        className="cart-line__remove"
                        onClick={() => removeItem(line.key)}
                        aria-label={`Remove ${line.name} from cart`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <p className="cart-line__total">
                    {formatPrice(line.price * line.qty, line.currency)}
                  </p>
                </li>
              ))}
            </ul>

            <footer className="cart-drawer__foot">
              <div className="cart-drawer__subtotal">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal, currency)}</strong>
              </div>

              <button type="button" className="btn btn--solid btn--block" onClick={handleCheckout}>
                <span>Checkout on our store</span>
                <ArrowUpRight width={14} height={14} />
              </button>

              <p className="cart-drawer__note">
                Shipping and taxes are calculated at checkout. Prices here are illustrative demo
                data — your store is the source of truth.
              </p>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
