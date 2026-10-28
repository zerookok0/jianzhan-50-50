import { useCallback, useEffect, useState } from 'react'
import { store, storeLive, storeEnabled, storeUrl, currentOrigin } from '../config/store'
import { ApiError, getCart, listProducts } from '../lib/api/client'
import { useDocumentMeta, useReveal } from '../lib/hooks'
import { AppLink } from '../components/ui/Media'
import { Check, Close, Info } from '../components/ui/Icons'

/**
 * STORE DIAGNOSTICS
 * ------------------------------------------------------------------
 * Probes the real Worker API from the browser. Nothing is simulated: what
 * this page reports is what checkout will experience.
 *
 * It exists because headless-store failures are usually invisible — an
 * empty cart with no explanation. Here the failure is named and paired
 * with the exact fix.
 */

type State = 'idle' | 'pass' | 'fail' | 'warn' | 'skip'

interface Probe {
  label: string
  detail: string
  state: State
  hint?: string
}

export function Diagnostics() {
  useDocumentMeta(
    'Store diagnostics — JIANZHAN',
    'Connection report for the store API: configuration, catalogue, cart session and CORS.',
  )
  useReveal()

  const [probes, setProbes] = useState<Probe[]>([])
  const [running, setRunning] = useState(false)
  const [ranAt, setRanAt] = useState<string | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setProbes([])

    const add = (p: Probe) => setProbes((prev) => [...prev, p])
    const origin = currentOrigin()

    /* ---- 1. Mode ---- */
    if (!storeEnabled()) {
      add({
        label: 'Store mode',
        detail: 'demo — static catalogue, no API calls',
        state: 'skip',
        hint: 'Set VITE_STORE_MODE=live to connect the cart and checkout.',
      })
      setRunning(false)
      setRanAt(new Date().toLocaleTimeString())
      return
    }

    add({
      label: 'Store mode',
      detail: `live → ${store.apiBaseUrl || origin} (same origin)`,
      state: 'pass',
    })

    add({
      label: 'Origin',
      detail: origin || '—',
      state: 'pass',
      hint: 'This exact origin must appear in the Worker ALLOWED_ORIGINS.',
    })

    add({
      label: 'HTTPS',
      detail: window.location.protocol === 'https:' ? 'Secure' : 'Not secure',
      state: window.location.protocol === 'https:' ? 'pass' : 'warn',
      hint:
        window.location.protocol === 'https:'
          ? undefined
          : 'Fine for localhost. Production must be HTTPS or payment will be blocked.',
    })

    /* ---- 2. Catalogue (unauthenticated read) ---- */
    let catalogueOk = false
    try {
      const { products, total } = await listProducts({ perPage: 1 })
      catalogueOk = true
      add({
        label: 'Catalogue reachable',
        detail: `GET /products returned ${products.length} of ${total} product(s)`,
        state: 'pass',
      })
      if (total === 0) {
        add({
          label: 'Catalogue contents',
          detail: 'No products are published',
          state: 'warn',
          hint: 'Seed the D1 database, then publish products from the admin panel.',
        })
      }
    } catch (err) {
      const e = err as ApiError
      add({
        label: 'Catalogue reachable',
        detail: e.message,
        state: 'fail',
        hint:
          e.status === 0
            ? `The browser could not reach the API. Check that ${origin} is in ALLOWED_ORIGINS on the Worker.`
            : 'Check that migrations have been applied to this environment’s D1 database.',
      })
    }

    /* ---- 3. Cart session ---- */
    if (catalogueOk) {
      try {
        const { cart } = await getCart()
        add({
          label: 'Cart session',
          detail: `OK — ${cart.itemCount} item(s), total ${formatMinor(
            cart.totals.grandTotal,
            cart.currency,
            cart.minorUnit,
          )}`,
          state: 'pass',
        })
        add({
          label: 'Server currency',
          detail: `${cart.currency} (minor unit ${cart.minorUnit})`,
          state:
            store.displayCurrency && store.displayCurrency !== cart.currency ? 'warn' : 'pass',
          hint:
            store.displayCurrency && store.displayCurrency !== cart.currency
              ? `VITE_ALLOWED_CURRENCY is ${store.displayCurrency} but the server charges in ${cart.currency}. The server wins.`
              : undefined,
        })
        add({
          label: 'Tax & shipping rules',
          detail: cart.needsShipping
            ? cart.shipping.available
              ? `${cart.shipping.options.length} delivery option(s) for ${
                  cart.destination.country ?? 'an unknown destination'
                }`
              : (cart.shipping.reason ?? 'No delivery option available yet')
            : 'No shippable items in the cart',
          state: 'pass',
        })
      } catch (err) {
        const e = err as ApiError
        add({
          label: 'Cart session',
          detail: e.message,
          state: 'fail',
          hint: 'Cart creation writes to D1. Verify the carts table exists in this environment.',
        })
      }
    }

    setRunning(false)
    setRanAt(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const worst: State = probes.some((p) => p.state === 'fail')
    ? 'fail'
    : probes.some((p) => p.state === 'warn')
      ? 'warn'
      : probes.length && !running
        ? 'pass'
        : 'idle'

  return (
    <div className="shell diagnostics">
      <header className="diagnostics__head">
        <p className="eyebrow">Diagnostics</p>
        <h1 className="display display--lg">Store connection</h1>
        <p className="body">
          Runs real requests against the store API from this browser. Nothing here is simulated.
        </p>
      </header>

      <dl className="diagnostics__meta">
        <div>
          <dt>Mode</dt>
          <dd>{store.mode}</dd>
        </div>
        <div>
          <dt>API base</dt>
          <dd>{store.apiBaseUrl || 'same origin'}</dd>
        </div>
        <div>
          <dt>Origin</dt>
          <dd>{currentOrigin() || '—'}</dd>
        </div>
        <div>
          <dt>Products endpoint</dt>
          <dd className="diagnostics__url">{storeUrl('/products')}</dd>
        </div>
      </dl>

      <div className="diagnostics__actions">
        <button type="button" className="btn btn--outline" onClick={() => void run()} disabled={running}>
          {running ? 'Running checks…' : 'Re-run checks'}
        </button>
        {ranAt && <span className="meta">Last run {ranAt}</span>}
      </div>

      <div className={`diagnostics__summary is-${worst}`} role="status">
        {worst === 'pass' && 'All checks passed.'}
        {worst === 'warn' && 'Connected with warnings — review the notes below.'}
        {worst === 'fail' && 'Connection failed. Fix the items marked below.'}
        {worst === 'idle' && 'Running…'}
      </div>

      <ul className="diagnostics__list">
        {probes.map((p, i) => (
          <li key={`${p.label}-${i}`} className={`diag-row is-${p.state}`}>
            <span className="diag-row__icon" aria-hidden="true">
              {p.state === 'pass' ? (
                <Check width={15} height={15} />
              ) : p.state === 'fail' ? (
                <Close width={15} height={15} />
              ) : (
                <Info width={15} height={15} />
              )}
            </span>
            <div className="diag-row__body">
              <p className="diag-row__label">{p.label}</p>
              <p className="diag-row__detail">{p.detail}</p>
              {p.hint && <p className="diag-row__hint">{p.hint}</p>}
            </div>
          </li>
        ))}
      </ul>

      <div className="diagnostics__foot">
        <p className="body">
          Setup steps are in <code>docs/deployment.md</code>; payment status is in{' '}
          <code>docs/payment-provider-integration.md</code>.
        </p>
        <AppLink href="/collection" className="btn btn--link">
          Back to the collection
        </AppLink>
      </div>

      {!storeLive() && (
        <p className="diagnostics__note">
          Demo mode: no API calls were made, so a pass here does not prove the store is reachable.
        </p>
      )}
    </div>
  )
}

function formatMinor(amount: number, currency: string, minorUnit: number): string {
  const value = amount / Math.pow(10, minorUnit)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit,
    }).format(value)
  } catch {
    return `${value.toFixed(minorUnit)} ${currency}`
  }
}

export default Diagnostics
