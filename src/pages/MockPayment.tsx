import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../config/store'
import { useDocumentMeta, useReveal, navigate } from '../lib/hooks'
import { AppLink } from '../components/ui/Media'
import { Check, Info, Alert, Close } from '../components/ui/Icons'

/**
 * MOCK PAYMENT PAGE  (development only)
 * ------------------------------------------------------------------
 * A stand-in for a hosted payment page, so the full purchase loop can be
 * tested without a merchant account.
 *
 * THREE THINGS THIS PAGE IS NOT
 *   1. It is not a payment form. There is no card number, no expiry, no
 *      CVV field anywhere — a fake card input teaches the wrong habit and
 *      would be copied into production sooner or later.
 *   2. It cannot mark an order paid. It asks the Worker's test gateway to
 *      emit a *signed* webhook, which then travels the same verification
 *      path a real provider's webhook would. If that path is broken, this
 *      page reports the failure instead of hiding it.
 *   3. It does not exist in production. The API returns 404 outside
 *      `development`, and this page says so rather than pretending.
 *
 * The URL carries the provider reference and order reference from the
 * redirect. Both are re-verified server-side against the database, so
 * editing them in the address bar produces an error, not a free order.
 */

interface Session {
  providerReference: string
  orderReference: string
  amount: number
  currency: string
  minorUnit: number
  orderStatus: string
  paymentStatus: string
  environment: string
}

type Phase = 'loading' | 'ready' | 'submitting' | 'done' | 'error'

interface CompletionResult {
  ok: boolean
  outcome?: 'paid' | 'failed' | 'requires_action'
  order?: { reference: string; status: string; fulfilmentStatus: string }
  /** The webhook's own JSON body, echoed back for inspection. */
  webhook?: unknown
  message?: string
  alreadyPaid?: boolean
  /** Which stage the gateway stopped at. `webhook` means it was refused. */
  stage?: 'complete' | 'webhook'
  webhookStatus?: number
  /**
   * The refused webhook's response body. Present only when `stage` is
   * `webhook` and the delivery did not return 2xx — the mock gateway sends
   * this so a failed verification can be diagnosed instead of guessed at.
   */
  webhookResponse?: unknown
}

export function MockPayment() {
  useDocumentMeta(
    'Test payment gateway — JIANZHAN',
    'Local development only. This page simulates a payment provider so the order webhook path can be tested.',
  )
  useReveal()

  const params = new URLSearchParams(window.location.search)
  const providerReference = params.get('ref') ?? ''
  const orderReference = params.get('order') ?? ''
  const returnUrl = params.get('return') ?? ''
  const cancelUrl = params.get('cancel') ?? ''

  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [result, setResult] = useState<CompletionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* ---- Load the authoritative session ---- */

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!providerReference || !orderReference) {
        setPhase('error')
        setError('This page needs both a payment reference and an order reference.')
        return
      }

      try {
        const res = await fetch(apiUrl('/mock-payment/sessions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerReference, orderReference }),
        })

        const body = await res.json().catch(() => null)

        if (cancelled) return

        if (!res.ok) {
          setPhase('error')
          setError(
            body?.error?.message ??
              'The test gateway could not find this payment. It may have expired, or this is not a development build.',
          )
          return
        }

        setSession(body.session as Session)
        setPhase('ready')
      } catch {
        if (cancelled) return
        setPhase('error')
        setError('Could not reach the store API. Check that the Worker is running.')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [providerReference, orderReference])

  /* ---- Choose an outcome ---- */

  const complete = useCallback(
    async (outcome: 'paid' | 'failed' | 'requires_action') => {
      setPhase('submitting')
      setError(null)

      try {
        const res = await fetch(apiUrl('/mock-payment/complete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerReference, orderReference, outcome }),
        })

        const body = (await res.json().catch(() => null)) as CompletionResult | null

        if (!res.ok) {
          setPhase('error')
          setError(
            body?.message ??
              'The gateway could not complete this payment. The order was not changed.',
          )
          setResult(body)
          return
        }

        setResult(body)
        setPhase('done')
      } catch {
        setPhase('error')
        setError('Could not reach the store API, so nothing was charged or confirmed.')
      }
    },
    [providerReference, orderReference],
  )

  /* ---------------- Render ---------------- */

  const money = (amount: number, currency: string, minorUnit: number) => {
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

  return (
    <div className="checkout-page shell mock-pay">
      <header className="checkout-page__head">
        <p className="eyebrow">Test gateway · development only</p>
        <h1 className="display display--lg checkout-page__title">
          Simulated payment
        </h1>
        <p className="body">
          No card is collected and no money moves. Choosing an outcome makes this page deliver a
          signed webhook to the store, so the real verification path runs.
        </p>
      </header>

      {/* ---- Hard warning that this is not real ---- */}

      <p className="buy__notice" role="note">
        <Info width={14} height={14} aria-hidden="true" />
        <span>
          This is a <strong>test double</strong>, not a payment provider. It only exists in local
          development and is disabled everywhere else.
        </span>
      </p>

      {/* ---- Session summary ---- */}

      {session && (
        <dl className="specs mock-pay__facts">
          <div className="specs__row">
            <dt>Order</dt>
            <dd>{session.orderReference}</dd>
          </div>
          <div className="specs__row">
            <dt>Amount</dt>
            <dd>{money(session.amount, session.currency, session.minorUnit)}</dd>
          </div>
          <div className="specs__row">
            <dt>Payment reference</dt>
            <dd>{session.providerReference}</dd>
          </div>
          <div className="specs__row">
            <dt>Order status</dt>
            <dd>{session.orderStatus}</dd>
          </div>
          <div className="specs__row">
            <dt>Environment</dt>
            <dd>{session.environment}</dd>
          </div>
        </dl>
      )}

      {/* ---- Loading ---- */}

      {phase === 'loading' && <p className="meta">Loading payment session…</p>}

      {/* ---- Error ---- */}

      {phase === 'error' && error && (
        <p className="checkout-alert" role="alert">
          <Alert width={14} height={14} aria-hidden="true" /> {error}
        </p>
      )}

      {/* ---- Outcome buttons ---- */}

      {(phase === 'ready' || phase === 'submitting') && (
        <div className="mock-pay__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={phase === 'submitting'}
            onClick={() => void complete('paid')}
          >
            <Check width={15} height={15} aria-hidden="true" />
            {phase === 'submitting' ? 'Signing webhook…' : 'Approve payment'}
          </button>

          <button
            type="button"
            className="btn btn--outline"
            disabled={phase === 'submitting'}
            onClick={() => void complete('requires_action')}
          >
            Send to 3-D Secure
          </button>

          <button
            type="button"
            className="btn btn--outline"
            disabled={phase === 'submitting'}
            onClick={() => void complete('failed')}
          >
            <Close width={14} height={14} aria-hidden="true" />
            Decline payment
          </button>
        </div>
      )}

      {/* ---- Result ---- */}

      {phase === 'done' && result && (
        <section className="mock-pay__result" aria-live="polite">
          {result.alreadyPaid ? (
            <p className="buy__notice">
              <Info width={14} height={14} aria-hidden="true" />
              <span>{result.message ?? 'This order was already paid.'}</span>
            </p>
          ) : (
            <p className="meta">
              Outcome <strong>{result.outcome}</strong> · webhook accepted
            </p>
          )}

          {result.order && (
            <dl className="specs">
              <div className="specs__row">
                <dt>Order reference</dt>
                <dd>{result.order.reference}</dd>
              </div>
              <div className="specs__row">
                <dt>Order status</dt>
                <dd>{result.order.status}</dd>
              </div>
              <div className="specs__row">
                <dt>Fulfilment</dt>
                <dd>{result.order.fulfilmentStatus}</dd>
              </div>
            </dl>
          )}

          <details className="accordion">
            <summary>Webhook response</summary>
            <div className="accordion__body">
              <pre className="mock-pay__json">{JSON.stringify(result.webhook, null, 2)}</pre>
            </div>
          </details>

          <div className="mock-pay__actions">
            {result.order && (
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => navigate(`/order/${result.order!.reference}`)}
              >
                View the order
              </button>
            )}
            {returnUrl && (
              <button type="button" className="btn btn--outline" onClick={() => navigate(returnUrl)}>
                Return to store
              </button>
            )}
          </div>
        </section>
      )}

      {/* ---- Failure from the webhook stage ---- */}

      {result && !result.ok && result.stage === 'webhook' && (
        <section className="mock-pay__result">
          <p className="checkout-alert" role="alert">
            <Alert width={14} height={14} aria-hidden="true" /> The webhook rejected the event
            (HTTP {result.webhookStatus}). The order was <strong>not</strong> marked paid. This is
            the correct behaviour when verification fails — check that PAYMENT_MOCK_SECRET matches
            between the gateway and the Worker.
          </p>
          <pre className="mock-pay__json">{JSON.stringify(result.webhookResponse, null, 2)}</pre>
        </section>
      )}

      {/* ---- Cancel ---- */}

      <div className="mock-pay__foot">
        {cancelUrl ? (
          <button type="button" className="btn btn--link" onClick={() => navigate(cancelUrl)}>
            Cancel and return to checkout
          </button>
        ) : (
          <AppLink href="/checkout" className="btn btn--link">
            Back to checkout
          </AppLink>
        )}
        <p className="meta">
          Test double · reachable only when ENVIRONMENT=development
        </p>
      </div>
    </div>
  )
}

export default MockPayment
