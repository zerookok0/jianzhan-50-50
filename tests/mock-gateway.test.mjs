/**
 * MOCK GATEWAY → WEBHOOK → PAID
 *
 * What this proves: an order only becomes `paid` when a correctly signed
 * event travels through the real webhook handler. Nothing here calls
 * markOrderPaid directly, and nothing here re-implements the webhook.
 *
 * The handlers under test are the shipped ones:
 *   worker/routes/mock-gateway.ts   (mockCompleteHandler)
 *   worker/routes/webhooks.ts       (webhookHandler)
 *   worker/services/orders.ts       (markOrderPaid / markOrderFailed)
 *   worker/services/inventory.ts    (commitReservation / releaseReservation)
 *
 * Delivery to our own webhook is intercepted by stubbing globalThis.fetch,
 * because a Worker cannot make a real HTTP request to itself in tests. The
 * stub calls webhookHandler with the SAME request body and headers, so the
 * signature is genuinely verified.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { makeFakeD1 } from './helpers/fake-d1.mjs'
import { installBranches } from './helpers/fake-d1-sql.mjs'
import { mockCompleteHandler } from '../worker/routes/mock-gateway.ts'
import { webhookHandler } from '../worker/routes/webhooks.ts'
import { hmacSha256Hex } from '../worker/lib/crypto.ts'
import { createRouter, errorResponse } from '../worker/lib/http.ts'

const SECRET = 'test-mock-secret-do-not-use-anywhere-real'
const ORDER_REF = 'JZ-AAAA-BBBB-CCCC'
const PROVIDER_REF = 'mock_ord1:1'

let realFetch

beforeEach(() => {
  realFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/** A database seeded with one pending order holding one reserved unit. */
function seed() {
  const db = makeFakeD1({
    orders: [
      {
        id: 'ord1',
        public_reference: ORDER_REF,
        status: 'pending',
        fulfilment_status: 'unfulfilled',
        grand_total: 43500,
        currency: 'USD',
        minor_unit: 2,
        stock_committed: 0,
        expires_at: Date.now() + 60_000,
        created_at: 1000,
      },
    ],
    payment_attempts: [
      {
        id: 'att1',
        order_id: 'ord1',
        provider: 'mock',
        provider_reference: PROVIDER_REF,
        amount: 43500,
        currency: 'USD',
        status: 'pending',
        created_at: 1000,
      },
    ],
    inventory: [
      {
        id: 'inv1',
        product_id: 'p1',
        variant_id: null,
        on_hand: 5,
        reserved: 1,
        sellable: 4,
        is_tracked: 1,
        allow_backorder: 0,
      },
    ],
    inventory_reservations: [
      {
        id: 'res1',
        inventory_id: 'inv1',
        holder_type: 'order',
        holder_id: 'ord1',
        quantity: 1,
        status: 'active',
      },
    ],
  })

  return db
}

function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    ENVIRONMENT: 'development',
    APP_ORIGIN: 'https://store.test',
    ALLOWED_ORIGINS: 'https://store.test',
    DEFAULT_CURRENCY: 'USD',
    ORDER_RESERVATION_MINUTES: '30',
    CART_TTL_DAYS: '30',
    PAYMENT_MOCK_SECRET: SECRET,
    ...overrides,
  }
}

function completeRequest(body) {
  return new Request('https://store.test/api/v1/mock-payment/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Route the mock gateway's own delivery into the real webhook handler. */
function installWebhookDelivery(env) {
  globalThis.fetch = async (url, init) => {
    const request = new Request(url, init)
    return webhookHandler(env, request, 'mock')
  }
}

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

test('a signed event from the mock gateway marks the order paid', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)
  installWebhookDelivery(env)

  const res = await mockCompleteHandler(
    env,
    completeRequest({
      providerReference: PROVIDER_REF,
      orderReference: ORDER_REF,
      outcome: 'paid',
    }),
  )

  assert.equal(res.status, 200, 'the mock gateway must report success')
  const body = await res.json()

  assert.equal(body.ok, true)
  assert.equal(body.order.status, 'paid', 'the order is paid')
  assert.equal(body.order.fulfilmentStatus, 'processing')

  /* ---- the database agrees, and stock was committed ---- */

  const order = api.state.orders.find((o) => o.id === 'ord1')
  assert.equal(order.status, 'paid')
  assert.equal(order.stock_committed, 1)
  assert.equal(order.expires_at, null, 'a paid order must stop expiring')

  const attempt = api.state.payment_attempts.find((a) => a.id === 'att1')
  assert.equal(attempt.status, 'captured')

  const inv = api.state.inventory.find((i) => i.id === 'inv1')
  assert.equal(inv.on_hand, 4, 'physical stock is reduced exactly once')
  assert.equal(inv.reserved, 0, 'the hold is cleared')

  const reservation = api.state.inventory_reservations.find((r) => r.id === 'res1')
  assert.equal(reservation.status, 'committed')

  const webhook = api.state.webhook_events[0]
  assert.equal(webhook.processed, 1, 'the event is recorded as handled')
  assert.equal(webhook.signature_ok, 1)
})

/* ------------------------------------------------------------------ */
/* Paying twice                                                        */
/* ------------------------------------------------------------------ */

test('paying an already-paid order charges nothing again', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)
  installWebhookDelivery(env)

  const payload = {
    providerReference: PROVIDER_REF,
    orderReference: ORDER_REF,
    outcome: 'paid',
  }

  const first = await mockCompleteHandler(env, completeRequest(payload))
  assert.equal(first.status, 200)

  const invAfterFirst = { ...api.state.inventory[0] }

  const second = await mockCompleteHandler(env, completeRequest(payload))
  const secondBody = await second.json()

  assert.equal(second.status, 200)
  assert.equal(secondBody.alreadyPaid, true)

  const invAfterSecond = api.state.inventory[0]
  assert.equal(invAfterSecond.on_hand, invAfterFirst.on_hand, 'stock must not fall twice')
  assert.equal(invAfterSecond.reserved, 0)
})

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

test('a replayed webhook body is acknowledged but not reprocessed', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)

  const event = JSON.stringify({
    id: 'evt_fixed',
    type: 'payment.succeeded',
    data: {
      provider_reference: PROVIDER_REF,
      order_reference: ORDER_REF,
      status: 'paid',
      amount: 43500,
      currency: 'USD',
    },
  })
  const signature = await hmacSha256Hex(SECRET, event)

  const makeRequest = () =>
    new Request('https://store.test/api/v1/payments/mock/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': signature },
      body: event,
    })

  const first = await webhookHandler(env, makeRequest(), 'mock')
  assert.equal(first.status, 200)
  assert.equal(api.state.inventory[0].on_hand, 4)

  const second = await webhookHandler(env, makeRequest(), 'mock')
  const body = await second.json()

  assert.equal(second.status, 200, 'the provider is told to stop retrying')
  assert.equal(body.duplicate, true)
  assert.equal(api.state.inventory[0].on_hand, 4, 'stock is not committed again')
})

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

test('an unsigned webhook is rejected and changes nothing', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)

  const request = new Request('https://store.test/api/v1/payments/mock/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { order_reference: ORDER_REF, status: 'paid' } }),
  })

  const res = await webhookHandler(env, request, 'mock')

  assert.equal(res.status, 400)
  assert.equal(api.state.orders[0].status, 'pending', 'the order stays pending')
  assert.equal(api.state.inventory[0].on_hand, 5, 'no stock moved')

  const logged = api.state.webhook_events[0]
  assert.equal(logged.signature_ok, 0)
  assert.equal(logged.processed, 0)
})

test('a forged signature is rejected', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)

  const event = JSON.stringify({
    id: 'evt_forged',
    type: 'payment.succeeded',
    data: { order_reference: ORDER_REF, status: 'paid', amount: 43500, currency: 'USD' },
  })
  const wrongSignature = await hmacSha256Hex('the-wrong-secret', event)

  const res = await webhookHandler(
    env,
    new Request('https://store.test/api/v1/payments/mock/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': wrongSignature },
      body: event,
    }),
    'mock',
  )

  assert.equal(res.status, 400)
  assert.equal(api.state.orders[0].status, 'pending')
})

test('a signed event with the wrong amount is refused', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)

  // Correctly signed — so verification passes — but claiming $10.00.
  const event = JSON.stringify({
    id: 'evt_undervalued',
    type: 'payment.succeeded',
    data: {
      provider_reference: PROVIDER_REF,
      order_reference: ORDER_REF,
      status: 'paid',
      amount: 1000,
      currency: 'USD',
    },
  })
  const signature = await hmacSha256Hex(SECRET, event)

  const res = await webhookHandler(
    env,
    new Request('https://store.test/api/v1/payments/mock/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': signature },
      body: event,
    }),
    'mock',
  )

  const body = await res.json()

  assert.equal(res.status, 200, 'acknowledged so the provider stops retrying')
  assert.equal(body.ignored, 'amount_mismatch')
  assert.equal(api.state.orders[0].status, 'pending', 'never fulfil on a mismatch')
  assert.equal(api.state.inventory[0].on_hand, 5)
})

test('an unknown provider is a 404, not a silent success', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)

  const res = await webhookHandler(
    env,
    new Request('https://store.test/api/v1/payments/coopmartvn/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    'coopmartvn',
  )

  assert.equal(res.status, 404)
})

/* ------------------------------------------------------------------ */
/* Decline                                                             */
/* ------------------------------------------------------------------ */

test('a declined payment fails the order and returns the stock', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)
  installWebhookDelivery(env)

  const res = await mockCompleteHandler(
    env,
    completeRequest({
      providerReference: PROVIDER_REF,
      orderReference: ORDER_REF,
      outcome: 'failed',
    }),
  )

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.order.status, 'failed')

  const inv = api.state.inventory[0]
  assert.equal(inv.on_hand, 5, 'a failed payment must not consume stock')
  assert.equal(inv.reserved, 0, 'the hold is released')

  const reservation = api.state.inventory_reservations[0]
  assert.equal(reservation.status, 'released')
})

/* ------------------------------------------------------------------ */
/* The development gate                                                */
/* ------------------------------------------------------------------ */

test('the mock gateway is invisible outside development', async () => {
  const api = seed()
  installBranches(api)
  installWebhookDelivery(makeEnv(api))

  // `requireDevelopment` throws an AppError(404) rather than returning a
  // response; the router's catch-all turns that into the 404 a caller sees.
  // Asserting the thrown error keeps the test honest about where the gate
  // lives instead of pretending the handler returns a Response.
  for (const environment of ['production', 'preview']) {
    const env = makeEnv(api, { ENVIRONMENT: environment })

    await assert.rejects(
      () =>
        mockCompleteHandler(
          env,
          completeRequest({
            providerReference: PROVIDER_REF,
            orderReference: ORDER_REF,
            outcome: 'paid',
          }),
        ),
      (err) => err.status === 404,
      `${environment} must not expose the test gateway`,
    )
  }

  assert.equal(api.state.orders[0].status, 'pending')
  assert.equal(api.state.inventory[0].on_hand, 5, 'no stock moved')
})

/* ------------------------------------------------------------------ */
/* A tampered payment link                                             */
/* ------------------------------------------------------------------ */

test('a payment link that does not match its order is refused', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)
  installWebhookDelivery(env)

  // `mockCompleteHandler` REFUSES by throwing an AppError, exactly like the
  // rest of the API: business rules raise, and `errorResponse` renders the
  // status. Asserting a returned Response here would be testing a contract
  // the code never offered — and would pass or fail for the wrong reason.
  await assert.rejects(
    () =>
      mockCompleteHandler(
        env,
        completeRequest({
          providerReference: 'mock_someone-elses-order',
          orderReference: ORDER_REF,
          outcome: 'paid',
        }),
      ),
    (err) => {
      assert.equal(err.name, 'AppError')
      assert.equal(err.code, 'conflict')
      assert.equal(err.status, 409, 'the pair is re-verified against the database')
      return true
    },
  )

  assert.equal(api.state.orders[0].status, 'pending', 'a tampered link pays nothing')
})

test('a tampered payment link surfaces as a 409 through the router', async () => {
  const api = seed()
  installBranches(api)
  const env = makeEnv(api)
  installWebhookDelivery(env)

  // The same refusal, but observed the way a caller sees it: the router lets
  // the AppError escape and the entry point's catch-all converts it. Running
  // it through the real router proves the 409 is produced by shipped code
  // rather than by an assertion in this file.
  const route = createRouter([
    {
      method: 'POST',
      pattern: '/api/v1/mock-payment/complete',
      handler: (c) => mockCompleteHandler(env, c.request),
    },
  ])

  const request = completeRequest({
    providerReference: 'mock_someone-elses-order',
    orderReference: ORDER_REF,
    outcome: 'paid',
  })

  let response
  try {
    response = await route(request, env)
    assert.fail('the router must not absorb the refusal')
  } catch (err) {
    response = errorResponse(err)
  }

  assert.equal(response.status, 409)

  const body = await response.json()
  assert.equal(body.error.code, 'conflict')
  assert.equal(api.state.orders[0].status, 'pending')
  assert.equal(api.state.inventory[0].on_hand, 5, 'no stock moved')
})
