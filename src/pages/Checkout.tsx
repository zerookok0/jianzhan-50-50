import { useCallback, useEffect, useState } from 'react'
import { useCart } from '../lib/cart'
import {
  ApiError,
  formatMinor,
  quoteCheckout,
  submitCheckout,
  type ApiAddress,
  type ApiCart,
} from '../lib/api/client'
import { storeEnabled, storeLive } from '../config/store'
import { AppLink } from '../components/ui/Media'
import { useDocumentMeta, useReveal } from '../lib/hooks'
import { Info } from '../components/ui/Icons'

/**
 * CHECKOUT
 * ------------------------------------------------------------------
 * Guest checkout against the first-party Worker API.
 *
 * Money rules enforced here:
 *   • No arithmetic. Every figure comes from the server's `quote`.
 *   • The displayed total is re-quoted whenever the destination or
 *     shipping method changes, so what the customer approves is what the
 *     server will charge.
 *   • An idempotency key is generated once per checkout attempt and sent
 *     as a header, so a double-click cannot create two orders.
 *
 * Payment is never confirmed on this page. The provider redirects the
 * customer away, and only a verified webhook marks the order paid.
 */

type Address = {
  firstName: string
  lastName: string
  company: string
  line1: string
  line2: string
  city: string
  region: string
  postcode: string
  country: string
  phone: string
}

const EMPTY: Address = {
  firstName: '',
  lastName: '',
  company: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postcode: '',
  country: 'US',
  phone: '',
}

const COUNTRIES = [
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['JP', 'Japan'],
  ['CN', 'China'],
  ['HK', 'Hong Kong'],
  ['SG', 'Singapore'],
] as const

export function Checkout() {
  useDocumentMeta(
    'Checkout — JIANZHAN',
    'Complete your order. Payment is processed by our payment provider.',
  )
  useReveal()

  const { cart, loading, refresh } = useCart()

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [billing, setBilling] = useState<Address>(EMPTY)
  const [shipToBilling, setShipToBilling] = useState(true)
  const [shipping, setShipping] = useState<Address>(EMPTY)
  const [note, setNote] = useState('')
  const [methodId, setMethodId] = useState<string>('')

  const [quote, setQuote] = useState<ApiCart | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  /**
   * One key per checkout attempt. Regenerated only after a terminal
   * failure, so an honest retry of the same order reuses the key and the
   * server returns the SAME order rather than charging again.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const effectiveShipping = shipToBilling ? billing : shipping
  const country = effectiveShipping.country

  /* ---- Re-quote whenever destination or method changes ---- */

  const runQuote = useCallback(async () => {
    if (!storeLive() || !country) return
    setQuoting(true)
    setQuoteError(null)
    try {
      const { quote: next } = await quoteCheckout({
        country,
        region: effectiveShipping.region,
        postcode: effectiveShipping.postcode,
        email: email || undefined,
        shippingMethodId: methodId || undefined,
      })
      setQuote(next)
      // Adopt the server's own default selection if we had none.
      if (!methodId && next.shipping.selected) {
        setMethodId(next.shipping.selected.methodId)
      }
    } catch (err) {
      setQuoteError(err instanceof ApiError ? err.message : 'Could not price this order.')
    } finally {
      setQuoting(false)
    }
  }, [country, effectiveShipping.region, effectiveShipping.postcode, email, methodId])

  useEffect(() => {
    if (!cart?.items.length) return
    const t = window.setTimeout(() => void runQuote(), 350)
    return () => window.clearTimeout(t)
  }, [runQuote, cart?.items.length])

  const view: ApiCart | null = quote ?? cart
  const totals = view?.totals
  const currency = view?.currency ?? 'USD'
  const minorUnit = view?.minorUnit ?? 2
  const money = (n: number) => formatMinor(n, currency, minorUnit)

  /* ---- Validation ---- */

  const validate = (): boolean => {
    const next: Record<string, string> = {}

    if (!email.trim()) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      next.email = 'Enter a valid email address.'

    const need = (obj: Address, prefix: string) => {
      if (!obj.firstName.trim()) next[`${prefix}firstName`] = 'Required.'
      if (!obj.lastName.trim()) next[`${prefix}lastName`] = 'Required.'
      if (!obj.line1.trim()) next[`${prefix}line1`] = 'Required.'
      if (!obj.city.trim()) next[`${prefix}city`] = 'Required.'
      if (!obj.postcode.trim()) next[`${prefix}postcode`] = 'Required.'
      if (!obj.country.trim()) next[`${prefix}country`] = 'Required.'
    }
    need(billing, 'billing')
    if (!shipToBilling) need(shipping, 'shipping')

    if (view?.needsShipping && !methodId) {
      next.method = 'Choose a delivery option.'
    }

    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  /* ---- Submit ---- */

  const submit = async () => {
    setSubmitError(null)
    if (!validate()) {
      const first = Object.keys(fieldErrors)[0]
      if (first) document.getElementById(`f-${first}`)?.focus()
      return
    }

    // A cart with an out-of-stock line must not proceed.
    if (view?.items.some((i) => !i.inStock)) {
      setSubmitError('An item in your cart is no longer available. Please update the cart.')
      return
    }

    setSubmitting(true)
    try {
      const { order, payment } = await submitCheckout(
        {
          email: email.trim(),
          phone: phone.trim() || undefined,
          billingAddress: toApi(billing),
          shippingSameAsBilling: shipToBilling,
          shippingAddress: shipToBilling ? undefined : toApi(shipping),
          shippingMethodId: methodId || undefined,
          customerNote: note.trim() || undefined,
        },
        idempotencyKey,
      )

      if (payment.redirectUrl) {
        // Hand off to the provider. A return to /order/:ref proves nothing
        // on its own — the webhook is what marks the order paid.
        window.location.assign(payment.redirectUrl)
        return
      }

      // No redirect (e.g. a provider that settles synchronously).
      window.location.assign(`/order/${order.reference}`)
    } catch (err) {
      // Only rotate the key after a terminal failure, so the same order is
      // never duplicated by a retry of a request that actually succeeded.
      if (err instanceof ApiError && err.status === 409) {
        await refresh()
        await runQuote()
      }
      setSubmitError(
        err instanceof ApiError ? err.message : 'Could not place the order. Please try again.',
      )
      if (err instanceof ApiError && err.code === 'payment_unconfigured') {
        setSubmitError(
          'Payment is not configured yet, so orders cannot be placed. Please contact the studio.',
        )
      }
      setIdempotencyKey(crypto.randomUUID())
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------------- Disabled states ---------------- */

  if (!storeEnabled()) {
    return (
      <div className="shell checkout-page">
        <p className="eyebrow">Checkout</p>
        <h1 className="display display--lg checkout-page__title">Store not connected</h1>
        <p className="body">
          This site is running as a catalogue. Set <code>VITE_STORE_MODE=live</code> to enable the
          cart and checkout.
        </p>
        <AppLink href="/collection" className="btn btn--outline">
          Back to the collection
        </AppLink>
      </div>
    )
  }

  if (!loading && (cart?.items.length ?? 0) === 0) {
    return (
      <div className="shell checkout-page">
        <p className="eyebrow">Checkout</p>
        <h1 className="display display--lg checkout-page__title">Your cart is empty</h1>
        <p className="body">Add a piece before continuing to checkout.</p>
        <AppLink href="/collection" className="btn btn--outline">
          Browse the collection
        </AppLink>
      </div>
    )
  }

  /* ---------------- Field helpers ---------------- */

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { type?: string; autoComplete?: string; required?: boolean; half?: boolean } = {},
  ) => (
    <div className={`field ${opts.half ? 'field--half' : ''}`}>
      <label className="field__label" htmlFor={`f-${id}`}>
        {label}
        {opts.required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={`f-${id}`}
        className={`field__input ${fieldErrors[id] ? 'is-invalid' : ''}`}
        type={opts.type ?? 'text'}
        value={value}
        autoComplete={opts.autoComplete}
        aria-invalid={Boolean(fieldErrors[id])}
        aria-describedby={fieldErrors[id] ? `e-${id}` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          if (fieldErrors[id]) setFieldErrors((f) => ({ ...f, [id]: '' }))
        }}
      />
      {fieldErrors[id] && (
        <p className="field__error" id={`e-${id}`} role="alert">
          {fieldErrors[id]}
        </p>
      )}
    </div>
  )

  const setB = (k: keyof Address) => (v: string) => setBilling((b) => ({ ...b, [k]: v }))
  const setS = (k: keyof Address) => (v: string) => setShipping((s) => ({ ...s, [k]: v }))

  const countrySelect = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    half = true,
  ) => (
    <div className={`field ${half ? 'field--half' : ''}`}>
      <label className="field__label" htmlFor={`f-${id}`}>
        Country <span aria-hidden="true">*</span>
      </label>
      <select
        id={`f-${id}`}
        className={`field__input ${fieldErrors[id] ? 'is-invalid' : ''}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (fieldErrors[id]) setFieldErrors((f) => ({ ...f, [id]: '' }))
        }}
      >
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {fieldErrors[id] && (
        <p className="field__error" role="alert">
          {fieldErrors[id]}
        </p>
      )}
    </div>
  )

  const cannotPay = view?.items.some((i) => !i.inStock) ?? false

  return (
    <div className="checkout-page shell">
      <header className="checkout-page__head">
        <p className="eyebrow">Checkout</p>
        <h1 className="display display--lg checkout-page__title">Complete your order</h1>
        <p className="body">
          Payment is handled by our payment provider. Card details are entered on their secure page
          — never on this site.
        </p>
      </header>

      <div className="checkout-grid">
        <form
          className="checkout-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          noValidate
        >
          <section className="checkout-block" aria-labelledby="contact-title">
            <h2 id="contact-title" className="checkout-block__title">
              Contact
            </h2>
            <div className="field-grid">
              {field('email', 'Email', email, setEmail, {
                type: 'email',
                autoComplete: 'email',
                required: true,
              })}
              {field('phone', 'Phone (optional)', phone, setPhone, {
                type: 'tel',
                autoComplete: 'tel',
                half: true,
              })}
            </div>
          </section>

          <section className="checkout-block" aria-labelledby="billing-title">
            <h2 id="billing-title" className="checkout-block__title">
              Billing address
            </h2>
            <div className="field-grid">
              {field('billingfirstName', 'First name', billing.firstName, setB('firstName'), {
                autoComplete: 'given-name',
                required: true,
                half: true,
              })}
              {field('billinglastName', 'Last name', billing.lastName, setB('lastName'), {
                autoComplete: 'family-name',
                required: true,
                half: true,
              })}
              {field('billingline1', 'Address', billing.line1, setB('line1'), {
                autoComplete: 'address-line1',
                required: true,
              })}
              {field('billingline2', 'Apartment, suite (optional)', billing.line2, setB('line2'), {
                autoComplete: 'address-line2',
              })}
              {field('billingcity', 'City', billing.city, setB('city'), {
                autoComplete: 'address-level2',
                required: true,
                half: true,
              })}
              {field('billingpostcode', 'Postcode', billing.postcode, setB('postcode'), {
                autoComplete: 'postal-code',
                required: true,
                half: true,
              })}
              {countrySelect('billingcountry', billing.country, setB('country'))}
              {field('billingregion', 'State / region (optional)', billing.region, setB('region'), {
                autoComplete: 'address-level1',
                half: true,
              })}
            </div>
          </section>

          <section className="checkout-block" aria-labelledby="shipping-title">
            <h2 id="shipping-title" className="checkout-block__title">
              Delivery
            </h2>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={shipToBilling}
                onChange={(e) => setShipToBilling(e.target.checked)}
              />
              <span>Deliver to my billing address</span>
            </label>

            {!shipToBilling && (
              <div className="field-grid checkout-block__spaced">
                {field('shippingfirstName', 'First name', shipping.firstName, setS('firstName'), {
                  required: true,
                  half: true,
                })}
                {field('shippinglastName', 'Last name', shipping.lastName, setS('lastName'), {
                  required: true,
                  half: true,
                })}
                {field('shippingline1', 'Address', shipping.line1, setS('line1'), { required: true })}
                {field('shippingline2', 'Apartment, suite (optional)', shipping.line2, setS('line2'), {})}
                {field('shippingcity', 'City', shipping.city, setS('city'), {
                  required: true,
                  half: true,
                })}
                {field('shippingpostcode', 'Postcode', shipping.postcode, setS('postcode'), {
                  required: true,
                  half: true,
                })}
                {countrySelect('shippingcountry', shipping.country, setS('country'))}
                {field('shippingregion', 'State / region (optional)', shipping.region, setS('region'), {
                  half: true,
                })}
              </div>
            )}

            {/* Shipping options come from the server, priced for this address. */}
            {view?.needsShipping && (
              <div className="checkout-block__spaced">
                {quoting && <p className="meta">Calculating delivery…</p>}

                {quoteError && (
                  <p className="checkout-alert" role="alert">
                    {quoteError}
                  </p>
                )}

                {!quoting && !quoteError && view.shipping.options.length > 0 && (
                  <fieldset className="payments">
                    <legend className="field__label">Delivery method</legend>
                    {view.shipping.options.map((o) => (
                      <label
                        key={o.methodId}
                        className={`payment ${methodId === o.methodId ? 'is-active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="shipping"
                          value={o.methodId}
                          checked={methodId === o.methodId}
                          onChange={() => {
                            setMethodId(o.methodId)
                            setFieldErrors((f) => ({ ...f, method: '' }))
                          }}
                        />
                        <span className="payment__body">
                          <span className="payment__title">
                            {o.name} — {o.amount === 0 ? 'Free' : money(o.amount)}
                          </span>
                          {o.deliveryTime && (
                            <span className="payment__desc">{o.deliveryTime}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}

                {!quoting && !quoteError && view.shipping.available === false && (
                  <p className="checkout-alert" role="alert">
                    {view.shipping.reason ?? 'We cannot deliver to this address.'}
                  </p>
                )}

                {fieldErrors.method && (
                  <p className="field__error" role="alert">
                    {fieldErrors.method}
                  </p>
                )}
              </div>
            )}

            <div className="field-grid checkout-block__spaced">
              {field('note', 'Order note (optional)', note, setNote, {})}
            </div>
          </section>

          {submitError && (
            <p className="checkout-alert" role="alert">
              {submitError}
            </p>
          )}

          {cannotPay && (
            <p className="checkout-alert" role="alert">
              <Info width={14} height={14} aria-hidden="true" /> An item in your cart is no longer
              available. Remove it to continue.
            </p>
          )}

          <button
            type="submit"
            className="btn btn--solid btn--block checkout-submit"
            disabled={submitting || loading || quoting || cannotPay}
          >
            {submitting ? 'Creating order…' : quoting ? 'Calculating total…' : 'Continue to payment'}
          </button>

          <p className="checkout-legal">
            By placing this order you agree to our terms and refund policy. All amounts are
            calculated and confirmed by our store.
          </p>
        </form>

        <aside className="checkout-summary" aria-labelledby="summary-title">
          <h2 id="summary-title" className="checkout-block__title">
            Order summary
          </h2>

          <ul className="summary-items">
            {(view?.items ?? []).map((it) => (
              <li key={it.itemId} className="summary-item">
                {it.imageUrl && (
                  <img src={it.imageUrl} alt="" className="summary-item__img" loading="lazy" />
                )}
                <div className="summary-item__body">
                  <p className="summary-item__name">{it.name}</p>
                  {it.variantLabel && <p className="summary-item__qty">{it.variantLabel}</p>}
                  <p className="summary-item__qty">Qty {it.quantity}</p>
                </div>
                <p className="summary-item__price">{money(it.lineSubtotal)}</p>
              </li>
            ))}
          </ul>

          {totals && (
            <dl className="summary-totals">
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
              {totals.shippingTotal > 0 && (
                <div>
                  <dt>Shipping</dt>
                  <dd>{money(totals.shippingTotal)}</dd>
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
          )}

          <p className="checkout-summary__note">
            Totals are calculated by our store and re-checked when the order is placed.
          </p>
        </aside>
      </div>
    </div>
  )
}

/* ---------------- Mapping ---------------- */

function toApi(a: Address): ApiAddress {
  return {
    firstName: a.firstName.trim(),
    lastName: a.lastName.trim(),
    company: a.company.trim(),
    line1: a.line1.trim(),
    line2: a.line2.trim(),
    city: a.city.trim(),
    region: a.region.trim(),
    postcode: a.postcode.trim(),
    country: a.country.trim().toUpperCase(),
    phone: a.phone.trim(),
  }
}

export default Checkout
