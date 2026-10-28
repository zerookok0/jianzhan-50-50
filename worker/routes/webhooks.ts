import { json } from '../lib/http.ts'
import { AppError } from '../lib/errors.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { buildProviders } from '../payments/provider.ts'
import { markOrderPaid, markOrderFailed } from '../services/orders.ts'
import type { Env } from '../env.ts'

/**
 * PAYMENT WEBHOOK
 * ------------------------------------------------------------------
 * The ONLY path that may mark an order paid.
 *
 * Defences, in order:
 *   1. Provider signature over the raw body. An unsigned or badly signed
 *      request is rejected before any parsing.
 *   2. Replay protection: the payload hash is unique per provider, so a
 *      retried delivery cannot double-process.
 *   3. Order correlation: the referenced order must exist and be pending.
 *   4. Amount and currency cross-check against our own record.
 *   5. Idempotent state transition: marking an already-paid order is a
 *      no-op, not an error and not a second fulfilment.
 *
 * A browser redirect back from the provider proves nothing and is not
 * trusted here.
 */

export async function webhookHandler(
  env: Env,
  request: Request,
  providerId: string,
): Promise<Response> {
  const rawBody = await request.text()

  const { providers } = buildProviders({
    environment: env.ENVIRONMENT,
    mockSecret: env.PAYMENT_MOCK_SECRET,
    publicOrigin: env.APP_ORIGIN,
  })

  const provider = providers.find((p) => p.id === providerId)
  if (!provider) {
    // Unknown provider: 404 without revealing which providers exist.
    return json({ error: { code: 'not_found', message: 'Unknown provider.' } }, { status: 404 })
  }

  const payloadHash = await sha256Hex(rawBody)

  /* ---- 1. Verify signature ---- */

  const verification = await provider.verifyWebhook({
    rawBody,
    headers: request.headers,
    url: request.url,
  })

  const webhookId = crypto.randomUUID()
  const now = Date.now()

  if (!verification.ok) {
    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: false,
      processed: false,
      error: verification.reason ?? 'Signature verification failed.',
      receivedAt: now,
    })

    // 400, not 401: the provider should not retry a forged payload forever,
    // but operators need it in the log.
    return json(
      { error: { code: 'invalid_signature', message: 'Signature verification failed.' } },
      { status: 400 },
    )
  }

  /* ---- 2. Replay protection ---- */

  const existing = await env.DB
    .prepare('SELECT id, processed FROM webhook_events WHERE provider = ?1 AND payload_hash = ?2')
    .bind(providerId, payloadHash)
    .first<{ id: string; processed: number }>()

  if (existing?.processed === 1) {
    // Already handled. Answer 200 so the provider stops retrying.
    return json({ received: true, duplicate: true })
  }

  /* ---- 3. Correlate the order ---- */

  if (!verification.orderReference) {
    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: true,
      processed: false,
      error: 'No order reference in payload.',
      receivedAt: now,
    })
    return json({ received: true, ignored: 'no_order_reference' })
  }

  const order = await env.DB
    .prepare(
      `SELECT id, status, grand_total, currency FROM orders WHERE public_reference = ?1`,
    )
    .bind(verification.orderReference)
    .first<{ id: string; status: string; grand_total: number; currency: string }>()

  if (!order) {
    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: true,
      processed: false,
      error: `Order ${verification.orderReference} not found.`,
      receivedAt: now,
    })
    return json({ received: true, ignored: 'unknown_order' })
  }

  /* ---- 4. Amount and currency check ---- */

  const amountMismatch =
    verification.amount !== null && verification.amount !== order.grand_total
  const currencyMismatch =
    verification.currency !== null && verification.currency !== order.currency

  if (amountMismatch || currencyMismatch) {
    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: true,
      processed: false,
      error: `Amount/currency mismatch: provider=${verification.amount} ${verification.currency}, order=${order.grand_total} ${order.currency}.`,
      receivedAt: now,
    })

    // Never fulfil on a mismatch. Log for manual reconciliation.
    console.error('[webhook] mismatch', {
      order: order.id,
      providerAmount: verification.amount,
      orderAmount: order.grand_total,
    })

    return json({ received: true, ignored: 'amount_mismatch' })
  }

  /* ---- 5. Apply the state transition ---- */

  try {
    if (verification.status === 'paid' || verification.status === 'authorised') {
      await markOrderPaid(env.DB, order.id, verification.providerReference)
    } else if (verification.status === 'failed' || verification.status === 'cancelled') {
      await markOrderFailed(
        env.DB,
        order.id,
        `Provider reported ${verification.status}.`,
      )
    }

    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: true,
      processed: true,
      error: null,
      receivedAt: now,
    })

    return json({ received: true })
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Processing failed.'
    await recordWebhook(env.DB, {
      id: webhookId,
      provider: providerId,
      eventId: verification.eventId,
      eventType: verification.eventType,
      payloadHash,
      signatureOk: true,
      processed: false,
      error: message,
      receivedAt: now,
    })

    // 500 makes the provider retry, which is correct for a transient fault.
    return json({ error: { code: 'webhook_processing_failed', message } }, { status: 500 })
  }
}

interface WebhookRecord {
  id: string
  provider: string
  eventId: string | null
  eventType: string
  payloadHash: string
  signatureOk: boolean
  processed: boolean
  error: string | null
  receivedAt: number
}

async function recordWebhook(db: D1Database, r: WebhookRecord): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO webhook_events
           (id, provider, provider_event, event_type, payload_hash, signature_ok, processed, error, received_at, processed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(provider, payload_hash) DO UPDATE SET
           processed = excluded.processed,
           error = excluded.error,
           processed_at = excluded.processed_at`,
      )
      .bind(
        r.id,
        r.provider,
        r.eventId,
        r.eventType,
        r.payloadHash,
        r.signatureOk ? 1 : 0,
        r.processed ? 1 : 0,
        r.error,
        r.receivedAt,
        r.processed ? Date.now() : null,
      )
      .run()
  } catch (err) {
    // Logging must never break the webhook response.
    console.error('[webhook] failed to record event', err)
  }
}
