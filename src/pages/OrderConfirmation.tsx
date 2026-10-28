import { useCallback, useEffect, useState } from 'react'
import { getOrder, ApiError, type ApiOrder } from '../lib/api/client'
import { formatMinor } from '../lib/api/client'
import { useCart } from '../lib/cart'
import { useDocumentMeta, useReveal, navigate } from '../lib/hooks'
import { storeEnabled } from '../config/store'
import { AppLink } from '../components/ui/Media'
import { Check, Info, Alert } from '../components/ui/Icons'

/**
 * ORDER CONFIRMATION
 * ------------------------------------------------------------------
 * The page the provider returns the customer to, and the permanent record
 * of the order.
 *
 * THE ONE RULE HERE
 * Arriving at this URL proves nothing. A customer can type it, bookmark it,
 * or be sent back by a provider that then fails to settle. So this page
 * reads the order's state from the server and says what it actually found:
 *
 *   pending  → "Payment is being confirmed"  (and it keeps polling)
 *   paid     → "Payment confirmed"           (webhook verified it)
 *   failed   → "Payment did not complete"    (with a way to try again)
 *
 * It never renders a success screen based on the URL alone.
 */

type LoadState = 'loading' | 'ready' | 'error'

const POLL_MS = 3000
const POLL_LIMIT = 20 // ~1 minute, then stop and offer a manual refresh

export function OrderConfirmation({ reference }: { reference: string }) {
  const { refresh: refreshCart } = useCart()

  const [order, setOrder] = useState<ApiOrder | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)
  const [attempts, setAttempts] = useState(0)

  useDocumentMeta(
    `Order ${reference} — JIANZHAN`,
    'Order confirmation and status for a recent purchase.',
  )
  useReveal()

  /* ---- Load, and keep checking while unpaid ---- */

  const load = useCallback(
    async (isInitial = false) => {
      if (!storeEnabled()) {
        setState('error')
        setError('This build is not connected to a store, so there is no order to display.')
        return
      }

      try {
        const { order: found } = await getOrder(reference)
        setOrder(found)
        setState('ready')
        setError(null)

        // Paid or failed is terminal; stop polling.
        if (found.status !== 'pending') {
          setPolling(false)
          // The cart that produced this order has been converted, so
          // refresh it to clear the drawer.
          if (found.status === 'paid' && isInitial) void refreshCart()
        }
      } catch (err) {
        if (isInitial) {
          setState('error')
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load this order. Please check the reference and try again.',
          )
        }
        // A failed poll is not fatal: the webhook may still arrive.
      }
    },
    [reference, refreshCart],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (!polling || state !== 'ready' || order?.status !== 'pending') return
    if (attempts >= POLL_LIMIT) {
      setPolling(false)
      return
    }

    const t = window.setTimeout(() => {
      setAttempts((n) => n + 1)
      void load()
    }, POLL_MS)

    return () => window.clearTimeout(t)
  }, [polling, state, order?.status, attempts, load])

  /* ---------------- Loading / error ---------------- */

  if (state === 'loading') {
    return (
      <div className="checkout-page shell">
        <p className="eyebrow">Order</p>
        <h1 className="display display--lg checkout-page__title">Loading your order…</h1>
        <p className="body">Checking the status of {reference} with our store.</p>
      </div>
    )
  }

  if (state === 'error' || !order) {
    return (
      <div className="checkout-page shell">
        <p className="eyebrow">Order</p>
        <h1 className="display display--lg checkout-page__title">We could not find that order</h1>
        <p className="checkout-alert" role="alert">
          <Alert width={14} height={14} aria-hidden="true" />{' '}
          {error ?? 'That order reference is not valid.'}
        </p>
        <p className="body">
          Order references look like <code>JZ-XXXX-XXXX-XXXX</code>. Check the link in your
          confirmation email, or contact the studio and we will look it up.
        </p>
        <div className="not-found-page__links">
          <AppLink href="/collection" className="btn btn--outline">
            Back to the collection
          </AppLink>
          <AppLink href="/" className="btn">
            Home
          </AppLink>
        </div>
      </div>
    )
  }

  /* ---------------- Status copy ---------------- */

  const money = (n: number) => formatMinor(n, order.currency, order.minorUnit)

  const paid = order.status === 'paid'
  const failed = order.status === 'failed' || order.status === 'cancelled'
  const pending = !paid && !failed

  const headline = paid
    ? 'Payment confirmed'
    : failed
      ? 'Payment did not complete'
      : 'Waiting for payment to confirm'

  const explain = paid
    ? 'Your payment was verified by our store and the order is now being prepared.'
    : failed
      ? 'The payment was declined or did not go through. Nothing was charged, and the stock held for this order has been released.'
      : 'Our payment provider has not confirmed this payment yet. This page checks again every few seconds — it is safe to leave it open.'

  const created = new Date(order.createdAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="checkout-page shell order-page">
      <header className="checkout-page__head">
        <p className="eyebrow">
          {paid ? 'Order confirmed' : pending ? 'Order received' : 'Order not completed'}
        </p>
        <h1 className="display display--lg checkout-page__title">{headline}</h1>
        <p className="body">{explain}</p>
      </header>

      {/* ---- Status banner ---- */}

      <div
        className={`order-status ${paid ? 'is-paid' : failed ? 'is-failed' : 'is-pending'}`}
        role="status"
        aria-live="polite"
      >
        {paid ? (
          <Check width={16} height={16} aria-hidden="true" />
        ) : failed ? (
          <Alert width={16} height={16} aria-hidden="true" />
        ) : (
          <Info width={16} height={16} aria-hidden="true" />
        )}
        <div className="order-status__body">
          <p className="order-status__label">{headline}</p>
          <p className="order-status__detail">
            {paid
              ? `Order ${order.reference} · ${order.fulfilmentStatus}`
              : failed
                ? `Order ${order.reference} · status ${order.status}`
                : polling
                  ? `Checking again… (${attempts}/${POLL_LIMIT})`
                  : 'Still unconfirmed. Use “Check again” below, or contact the studio.'}
          </p>
        </div>

        {pending && (
          <button
            type="button"
            className="btn btn--outline order-status__refresh"
            onClick={() => {
              setAttempts(0)
              setPolling(true)
              void load()
            }}
          >
            Check again
          </button>
        )}
      </div>

      <div className="checkout-grid">
        {/* ---- Items ---- */}

        <section className="checkout-block" aria-labelledby="items-title">
          <h2 id="items-title" className="checkout-block__title">
            What you ordered
          </h2>

          <ul className="summary-items">
            {order.items.map((item, i) => (
              <li key={`${item.sku}-${i}`} className="summary-item">
                <div className="summary-item__body">
                  <p className="summary-item__name">{item.name}</p>
                  {item.variantLabel && <p className="summary-item__qty">{item.variantLabel}</p>}
                  <p className="summary-item__qty">
                    Qty {item.quantity} · {money(item.unitPrice)} each
                  </p>
                </div>
                <p className="summary-item__price">{money(item.lineTotal)}</p>
              </li>
            ))}
          </ul>

          <dl className="specs">
            <div className="specs__row">
              <dt>Order reference</dt>
              <dd>{order.reference}</dd>
            </div>
            <div className="specs__row">
              <dt>Placed</dt>
              <dd>{created}</dd>
            </div>
            <div className="specs__row">
              <dt>Email</dt>
              <dd>{order.email}</dd>
            </div>
            <div className="specs__row">
              <dt>Delivery</dt>
              <dd>{order.shipping.methodName || '—'}</dd>
            </div>
            <div className="specs__row">
              <dt>Fulfilment</dt>
              <dd>{order.fulfilmentStatus}</dd>
            </div>
          </dl>
        </section>

        {/* ---- Totals ---- */}

        <aside className="checkout-summary" aria-labelledby="totals-title">
          <h2 id="totals-title" className="checkout-block__title">
            Total
          </h2>

          <dl className="summary-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(order.subtotal)}</dd>
            </div>
            {order.discountTotal > 0 && (
              <div>
                <dt>Discount</dt>
                <dd>−{money(order.discountTotal)}</dd>
              </div>
            )}
            {order.shippingTotal > 0 && (
              <div>
                <dt>Shipping</dt>
                <dd>{money(order.shippingTotal)}</dd>
              </div>
            )}
            {order.taxTotal > 0 && (
              <div>
                <dt>Tax</dt>
                <dd>{money(order.taxTotal)}</dd>
              </div>
            )}
            <div className="summary-totals__grand">
              <dt>{paid ? 'Paid' : 'Due'}</dt>
              <dd>{money(order.grandTotal)}</dd>
            </div>
          </dl>

          {order.payments.length > 0 && (
            <dl className="specs specs--compact">
              {order.payments.map((p, i) => (
                <div key={`${p.provider}-${i}`} className="specs__row">
                  <dt>{p.provider}</dt>
                  <dd>{p.status}</dd>
                </div>
              ))}
            </dl>
          )}

          {failed && (
            <button
              type="button"
              className="btn btn--solid btn--block"
              onClick={() => navigate('/checkout')}
            >
              Try again
            </button>
          )}

          <AppLink href="/collection" className="btn btn--outline">
            Continue browsing
          </AppLink>

          <p className="checkout-summary__note">
            Keep this reference: <strong>{order.reference}</strong>. A confirmation email is not
            sent yet — this page is the record.
          </p>
        </aside>
      </div>
    </div>
  )
}

export default OrderConfirmation
