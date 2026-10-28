import { json, readJson } from '../lib/http.ts'
import { badRequest, conflict, notFound } from '../lib/errors.ts'
import { Ctx, validate, str, enumOf } from '../lib/validate.ts'
import { hmacSha256Hex } from '../lib/crypto.ts'
import type { Env } from '../env.ts'

/**
 * MOCK GATEWAY (test double)
 * ------------------------------------------------------------------
 * A local stand-in for a hosted payment page, so the whole checkout loop
 * can be exercised without a merchant account.
 *
 * WHAT THIS IS NOT
 * It is not a payment gateway, it cannot move money, and it must never be
 * reachable outside local development. It exists to prove one thing: that
 * the order → payment → webhook → fulfilment path is wired correctly.
 *
 * HOW IT STAYS HONEST
 * This endpoint does not mark an order paid. It behaves exactly like a
 * real provider would:
 *
 *   1. The customer picks an outcome (approve / decline / 3-D Secure).
 *   2. The server SIGNS an event with PAYMENT_MOCK_SECRET.
 *   3. The server POSTs that signed event to its own webhook endpoint,
 *      over the same HTTP handler a real provider would hit.
 *   4. The webhook verifies the signature, checks the amount and
 *      currency, then applies the transition.
 *
 * The important consequence: bypassing the webhook would not make an
 * order paid here, because nothing else in this file touches order state.
 * That is what makes the test meaningful rather than theatre.
 */

const PROVIDER_ID = 'mock'

interface MockSession {
  providerReference: string
  orderReference: string
  amount: number
  currency: string
  returnUrl: string
  cancelUrl: string
}

/**
 * What `POST /mock-payment/sessions` actually returns. Kept as its own
 * shape rather than an intersection over MockSession, because a session
 * read from the database carries authoritative state (order status,
 * payment status, environment) that the redirect parameters do not.
 */
interface MockSessionResponse extends Omit<MockSession, 'returnUrl' | 'cancelUrl'> {
  minorUnit: number
  orderStatus: string
  paymentStatus: string
  environment: string
}

/**
 * The mock provider keeps no database table of its own: the parameters it
 * needs travel in the redirect URL it issued. They are re-verified against
 * the database before use, so a tampered link cannot invent an order.
 */
interface MockEventPayload {
  id: string
  type: string
  data: {
    provider_reference: string
    order_reference: string
    status: string
    amount: number
    currency: string
  }
}

export type MockOutcome = 'paid' | 'failed' | 'requires_action'

/* ------------------------------------------------------------------ */
/* POST /api/v1/mock-payment/sessions                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve the pending session that the redirect carried, and confirm it
 * matches a real, still-pending order before letting the customer act.
 */
export async function mockSessionHandler(env: Env, request: Request): Promise<Response> {
  requireDevelopment(env)

  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      providerReference: str(ctx, obj.providerReference, 'providerReference', { max: 200 }),
      orderReference: str(ctx, obj.orderReference, 'orderReference', { max: 40 }),
    }
  })

  const order = await env.DB
    .prepare(
      `SELECT id, public_reference, status, grand_total, currency, minor_unit
         FROM orders WHERE public_reference = ?1`,
    )
    .bind(input.orderReference.toUpperCase())
    .first<{
      id: string
      public_reference: string
      status: string
      grand_total: number
      currency: string
      minor_unit: number
    }>()

  if (!order) throw notFound('That order reference does not exist.')

  // The provider reference is derived from the order id by the mock
  // provider, so a mismatched pair means the link was tampered with.
  const attempt = await env.DB
    .prepare(
      `SELECT provider, provider_reference, amount, currency, status
         FROM payment_attempts WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(order.id)
    .first<{
      provider: string
      provider_reference: string
      amount: number
      currency: string
      status: string
    }>()

  if (!attempt || attempt.provider !== PROVIDER_ID) {
    throw conflict('This order was not created by the test gateway.')
  }

  if (attempt.provider_reference !== input.providerReference) {
    throw conflict('This payment link does not match the order it claims to belong to.')
  }

  return json({
    session: {
      providerReference: attempt.provider_reference,
      orderReference: order.public_reference,
      amount: attempt.amount,
      currency: attempt.currency,
      minorUnit: order.minor_unit,
      /** Authoritative, from the database — not from the URL. */
      orderStatus: order.status,
      paymentStatus: attempt.status,
      /** The mock cannot be used unless it is genuinely development. */
      environment: env.ENVIRONMENT,
    } satisfies MockSessionResponse,
  })
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/mock-payment/complete                                  */
/* ------------------------------------------------------------------ */

/**
 * Finish the simulated payment.
 *
 * The only way an order becomes paid is the signed webhook this function
 * delivers to our own endpoint — the same code path a real provider uses.
 */
export async function mockCompleteHandler(env: Env, request: Request): Promise<Response> {
  requireDevelopment(env)

  if (!env.PAYMENT_MOCK_SECRET) {
    throw badRequest('PAYMENT_MOCK_SECRET is not set, so the test gateway cannot sign events.')
  }

  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      providerReference: str(ctx, obj.providerReference, 'providerReference', { max: 200 }),
      orderReference: str(ctx, obj.orderReference, 'orderReference', { max: 40 }),
      outcome: enumOf(ctx, obj.outcome, 'outcome', ['paid', 'failed', 'requires_action'] as const),
    }
  })

  /* ---- Re-verify the pair, never trust the browser ---- */

  const order = await env.DB
    .prepare(
      `SELECT id, public_reference, status, grand_total, currency, minor_unit
         FROM orders WHERE public_reference = ?1`,
    )
    .bind(input.orderReference.toUpperCase())
    .first<{
      id: string
      public_reference: string
      status: string
      grand_total: number
      currency: string
      minor_unit: number
    }>()

  if (!order) throw notFound('That order reference does not exist.')

  const attempt = await env.DB
    .prepare(
      `SELECT provider, provider_reference, amount, currency, status
         FROM payment_attempts WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(order.id)
    .first<{
      provider: string
      provider_reference: string
      amount: number
      currency: string
      status: string
    }>()

  if (!attempt || attempt.provider !== PROVIDER_ID) {
    throw conflict('This order was not created by the test gateway.')
  }

  if (attempt.provider_reference !== input.providerReference) {
    throw conflict('This payment link does not match the order it belongs to.')
  }

  if (order.status === 'paid' && input.outcome !== 'failed') {
    return json({
      ok: true,
      alreadyPaid: true,
      message: 'This order is already paid. Nothing was charged again.',
      order: { reference: order.public_reference, status: order.status },
    })
  }

  /* ---- Build the event exactly as a provider would ---- */

  const statusForOutcome = {
    paid: 'paid',
    failed: 'failed',
    requires_action: 'pending',
  } as const

  const event: MockEventPayload = {
    id: `evt_${crypto.randomUUID()}`,
    type:
      input.outcome === 'paid'
        ? 'payment.succeeded'
        : input.outcome === 'failed'
          ? 'payment.failed'
          : 'payment.requires_action',
    data: {
      provider_reference: attempt.provider_reference,
      order_reference: order.public_reference,
      status: statusForOutcome[input.outcome],
      // The AMOUNT IS TAKEN FROM THE ORDER, not from the request. A real
      // provider reports what it actually charged; simulating a mismatch
      // would only be useful to test the rejection path.
      amount: attempt.amount,
      currency: attempt.currency,
    },
  }

  const rawBody = JSON.stringify(event)
  const signature = await hmacSha256Hex(env.PAYMENT_MOCK_SECRET, rawBody)

  /* ---- Deliver to the real webhook endpoint ---- */

  const origin = new URL(request.url).origin
  const webhookUrl = `${origin}/api/v1/payments/${PROVIDER_ID}/webhook`

  const delivery = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mock-Signature': signature,
    },
    body: rawBody,
  })

  const deliveryBody = await delivery.text()
  let deliveryJson: unknown = null
  try {
    deliveryJson = JSON.parse(deliveryBody)
  } catch {
    deliveryJson = deliveryBody
  }

  if (!delivery.ok) {
    // Surfacing the webhook's own refusal is the point: if verification
    // fails, the tester must see that, not a cheerful redirect.
    return json(
      {
        ok: false,
        stage: 'webhook',
        webhookStatus: delivery.status,
        webhookResponse: deliveryJson,
        message:
          'The gateway delivered a signed event but the webhook rejected it. The order was not marked paid.',
      },
      { status: 502 },
    )
  }

  /* ---- Re-read the authoritative state ---- */

  const after = await env.DB
    .prepare('SELECT status, fulfilment_status FROM orders WHERE id = ?1')
    .bind(order.id)
    .first<{ status: string; fulfilment_status: string }>()

  return json({
    ok: delivery.ok,
    outcome: input.outcome,
    stage: 'complete',
    session: {
      providerReference: attempt.provider_reference,
      orderReference: order.public_reference,
      amount: attempt.amount,
      currency: attempt.currency,
      minorUnit: order.minor_unit,
    },
    order: {
      reference: order.public_reference,
      status: after?.status ?? order.status,
      fulfilmentStatus: after?.fulfilment_status ?? 'unfulfilled',
    },
    webhook: deliveryJson,
  })
}

/* ------------------------------------------------------------------ */

/**
 * Hard gate. The mock must not be reachable anywhere a customer could
 * reach it, because its only security property is that it is local.
 */
function requireDevelopment(env: Env): void {
  if (env.ENVIRONMENT !== 'development') {
    throw notFound('Not found.')
  }
}
