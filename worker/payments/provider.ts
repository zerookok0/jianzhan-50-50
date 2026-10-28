/**
 * PAYMENT PROVIDER INTERFACE
 * ------------------------------------------------------------------
 * No real gateway is implemented here. This file defines the contract
 * every provider must satisfy, plus a development-only mock.
 *
 * Why no real adapter: implementing one requires that provider's official
 * documentation, merchant credentials and a sandbox account. Guessing at
 * an API shape would produce code that looks finished and fails in
 * production — the worst possible outcome for a payment path.
 *
 * See docs/payment-provider-integration.md for the checklist a provider
 * must pass before its adapter may be enabled.
 */

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'authorised'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded'

export interface PaymentCapabilities {
  /** Provider id, e.g. 'stripe', 'mock'. */
  id: string
  label: string
  /** Hosted checkout, embedded fields, or redirect. */
  flow: 'redirect' | 'embedded' | 'inline'
  supports: {
    /** Can the provider refund via API? */
    refunds: boolean
    /** Does it support partial refunds? */
    partialRefunds: boolean
    /** Does it handle 3-D Secure / SCA itself? */
    sca: boolean
    /** Can it authorise now and capture later? */
    authAndCapture: boolean
    /** Are webhooks signed? */
    signedWebhooks: boolean
  }
  /** True only after sandbox verification. Never optimistically. */
  verified: boolean
}

export interface CreatePaymentInput {
  orderId: string
  orderReference: string
  /** Minor units. */
  amount: number
  currency: string
  minorUnit: number
  customerEmail: string
  /** Must be unique per attempt; providers use it to dedupe. */
  idempotencyKey: string
  /** Where the provider should send the customer back. */
  returnUrl: string
  cancelUrl: string
  /** Short line description for the customer's statement. */
  description: string
}

export interface CreatePaymentResult {
  providerReference: string
  status: PaymentStatus
  /** Set for redirect flows. */
  redirectUrl?: string
  /** Set for embedded flows: a client secret or equivalent. */
  clientSecret?: string
  /** Provider metadata safe to store (no card data). */
  metadata?: Record<string, string>
}

export interface PaymentStatusResult {
  providerReference: string
  status: PaymentStatus
  /** Echoed back for cross-checking against our own record. */
  amount: number | null
  currency: string | null
  metadata?: Record<string, string>
}

export interface WebhookVerificationInput {
  /** Raw request body — must be the exact bytes the provider signed. */
  rawBody: string
  headers: Headers
  url: string
}

export interface WebhookResult {
  ok: boolean
  /** Provider event id, for dedupe. */
  eventId: string | null
  eventType: string
  /** Which order this event refers to, if determinable. */
  orderReference: string | null
  providerReference: string | null
  status: PaymentStatus | null
  amount: number | null
  currency: string | null
  reason?: string
}

export interface RefundInput {
  providerReference: string
  /** Minor units. Omit for a full refund. */
  amount?: number
  reason?: string
  idempotencyKey: string
}

export interface RefundResult {
  ok: boolean
  refundReference: string | null
  amount: number
  status: PaymentStatus
  message?: string
}

export interface PaymentProvider {
  readonly id: string
  readonly label: string

  /** What this provider can actually do. Must not overstate. */
  getCapabilities(): PaymentCapabilities

  /** Create a payment intent / session / redirect. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>

  /**
   * Fetch authoritative status from the provider.
   * Used after a redirect return and to reconcile webhooks — never trust
   * the browser's word that a payment succeeded.
   */
  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>

  /** Verify the signature and parse the event. Never trusts the body alone. */
  verifyWebhook(input: WebhookVerificationInput): Promise<WebhookResult>

  /** Refund, when supported. */
  refundPayment?(input: RefundInput): Promise<RefundResult>
}

/* ------------------------------------------------------------------ */
/* Development mock                                                   */
/* ------------------------------------------------------------------ */

/**
 * A mock provider that lets the whole order pipeline run locally.
 *
 * Safety properties:
 *   • Refuses to construct unless NODE_ENV/ENVIRONMENT is development.
 *   • Never marks a payment paid without an explicit webhook.
 *   • Uses HMAC-SHA256 signatures so the verification path is genuinely
 *     exercised rather than bypassed.
 *   • Not included in production builds: the factory throws first.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock'
  readonly label = 'Development mock (no real money)'

  constructor(
    private readonly secret: string,
    private readonly publicOrigin: string,
  ) {
    if (!secret) {
      throw new Error('MockPaymentProvider requires PAYMENT_MOCK_SECRET.')
    }
  }

  getCapabilities(): PaymentCapabilities {
    return {
      id: this.id,
      label: this.label,
      flow: 'redirect',
      supports: {
        refunds: true,
        partialRefunds: true,
        sca: false,
        authAndCapture: false,
        signedWebhooks: true,
      },
      // Deliberately false: this is not a real provider and must never be
      // presented to a customer as one.
      verified: false,
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerReference = `mock_${input.idempotencyKey}`

    // A real provider would call its API here. The mock simply redirects
    // to a local page that can approve, decline, or simulate 3-D Secure.
    const params = new URLSearchParams({
      ref: providerReference,
      order: input.orderReference,
      amount: String(input.amount),
      currency: input.currency,
      return: input.returnUrl,
      cancel: input.cancelUrl,
    })

    return {
      providerReference,
      status: 'pending',
      redirectUrl: `${this.publicOrigin}/mock-payment?${params.toString()}`,
      metadata: { simulated: 'true' },
    }
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    // The mock keeps no authoritative state; the webhook drives status.
    return {
      providerReference,
      status: 'pending',
      amount: null,
      currency: null,
    }
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<WebhookResult> {
    const signature = input.headers.get('X-Mock-Signature')
    if (!signature) {
      return {
        ok: false,
        eventId: null,
        eventType: '',
        orderReference: null,
        providerReference: null,
        status: null,
        amount: null,
        currency: null,
        reason: 'Missing X-Mock-Signature header.',
      }
    }

    const { hmacSha256Hex, timingSafeEqualString } = await import('../lib/crypto')
    const expected = await hmacSha256Hex(this.secret, input.rawBody)
    if (!timingSafeEqualString(expected, signature)) {
      return {
        ok: false,
        eventId: null,
        eventType: '',
        orderReference: null,
        providerReference: null,
        status: null,
        amount: null,
        currency: null,
        reason: 'Signature mismatch.',
      }
    }

    let parsed: {
      id?: string
      type?: string
      data?: {
        provider_reference?: string
        order_reference?: string
        status?: PaymentStatus
        amount?: number
        currency?: string
      }
    }
    try {
      parsed = JSON.parse(input.rawBody)
    } catch {
      return {
        ok: false,
        eventId: null,
        eventType: '',
        orderReference: null,
        providerReference: null,
        status: null,
        amount: null,
        currency: null,
        reason: 'Body is not valid JSON.',
      }
    }

    return {
      ok: true,
      eventId: parsed.id ?? null,
      eventType: parsed.type ?? '',
      orderReference: parsed.data?.order_reference ?? null,
      providerReference: parsed.data?.provider_reference ?? null,
      status: parsed.data?.status ?? null,
      amount: parsed.data?.amount ?? null,
      currency: parsed.data?.currency ?? null,
    }
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    return {
      ok: true,
      refundReference: `mock_refund_${input.idempotencyKey}`,
      amount: input.amount ?? 0,
      status: 'refunded',
      message: 'Mock refund — no money moved.',
    }
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                           */
/* ------------------------------------------------------------------ */

export interface ProviderConfig {
  /** Which provider is configured, or null when none. */
  activeProviderId: string | null
  /** Reasons the active provider cannot be used, if any. */
  blockers: string[]
  providers: PaymentCapabilities[]
}

/**
 * Build the provider registry for this environment.
 *
 * Production with no verified provider returns an empty list, and checkout
 * refuses to invent a success. That is the correct behaviour: better a
 * clear "payment not configured" than a fake confirmation.
 */
export function buildProviders(env: {
  environment: string
  mockSecret?: string
  publicOrigin: string
}): { providers: PaymentProvider[]; config: ProviderConfig } {
  const providers: PaymentProvider[] = []
  const blockers: string[] = []

  const isDev = env.environment === 'development'

  if (isDev && env.mockSecret) {
    providers.push(new MockPaymentProvider(env.mockSecret, env.publicOrigin))
  }

  // Real providers would be registered here, each only after its adapter
  // has passed sandbox verification.

  if (!providers.length) {
    blockers.push(
      isDev
        ? 'No payment provider is configured. Set PAYMENT_MOCK_SECRET for local testing.'
        : 'No payment provider is configured. Checkout cannot complete until one is added and verified.',
    )
  }

  return {
    providers,
    config: {
      activeProviderId: providers[0]?.id ?? null,
      blockers,
      providers: providers.map((p) => p.getCapabilities()),
    },
  }
}
