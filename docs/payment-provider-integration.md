# Payment provider integration

> **Current status: no real payment provider is integrated.**
>
> Checkout returns `503 payment_unconfigured` in every environment except
> local development. That is deliberate and correct — a store that
> pretends to take money is worse than one that says it cannot.
>
> Nothing in this document has been executed against a real provider.
> It is the checklist to follow once you choose one.

---

## 1. What exists today

| Piece | State |
|---|---|
| `PaymentProvider` interface | ✅ defined (`worker/payments/provider.ts`) |
| Mock provider | ✅ dev-only, refuses to construct elsewhere |
| Webhook verification pipeline | ✅ signature → replay → order → amount → state |
| Order/payment state machine | ✅ idempotent transitions |
| Real provider adapters | ❌ **none** |
| Sandbox tests | ❌ **none run** |

The mock provider is not a stub that says "yes": it signs its webhooks with
HMAC-SHA256 and the real verification path runs. That means the security
logic is exercised locally, even though no money moves.

---

## 2. Choose a provider

Any of these can work. The deciding question is **how the customer enters
card details**, because that determines your PCI scope.

| Provider | Flow | PCI scope if used this way |
|---|---|---|
| **Stripe Checkout** | Redirect to Stripe-hosted page | SAQ A (minimal) |
| **Stripe Payment Element** | Embedded fields on your domain | SAQ A-EP (more work) |
| **Adyen Hosted** | Redirect | SAQ A |
| **PayPal** | Redirect | SAQ A |
| **Square** | Hosted or embedded | varies |

**Recommendation for a first launch: a redirect flow.** Card data never
touches your code, the integration surface is small, and 3-D Secure is
handled by the provider.

---

## 3. Credentials you will need

Names vary per provider; the *kinds* do not.

| Kind | Where it goes | Never |
|---|---|---|
| **Secret API key** | `wrangler secret put` | in `wrangler.toml`, in `src/`, in git |
| **Publishable key** | may be public, still set via env | hard-coded in a component |
| **Webhook signing secret** | `wrangler secret put` | logged, or returned by any endpoint |
| **Merchant/account id** | plain var is fine | — |

```bash
npx wrangler secret put STRIPE_SECRET_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
```

Verify afterwards that the value is not readable:

```bash
npx wrangler secret list --env production   # names only, never values
```

---

## 4. Implementing an adapter

Create `worker/payments/<provider>.ts` implementing `PaymentProvider`. The
five methods are not optional.

### `getCapabilities()`

Be pessimistic. `verified: true` only after §6 passes.

```ts
getCapabilities() {
  return {
    id: 'stripe', label: 'Stripe',
    flow: 'redirect',
    supports: { refunds: true, partialRefunds: true, sca: true,
                authAndCapture: true, signedWebhooks: true },
    verified: false, // ← flip only after sandbox tests pass
  }
}
```

### `createPayment()`

Pass the provider's own idempotency key. Never construct it from a
timestamp — use the `idempotencyKey` argument, which is derived from the
order id and attempt number.

```ts
const session = await stripe.checkout.sessions.create(
  { mode: 'payment', /* … */ },
  { idempotencyKey: input.idempotencyKey },
)
```

### `getPaymentStatus()`

The authoritative read. Called after a redirect return and by
reconciliation. **Never** infer success from a URL parameter.

### `verifyWebhook()`

Verify over the **raw body**, before parsing. Express-style body parsing
breaks signatures; the Worker already hands you `await request.text()`.

```ts
const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
if (!timingSafeEqualString(expected, signature)) return { ok: false, … }
```

Also reject timestamps older than ~5 minutes to limit replay.

### `refundPayment()`

Only if the provider supports it. Include an idempotency key so a retried
refund cannot double-refund.

---

## 5. Registering the adapter

`buildProviders()` in `worker/payments/provider.ts` is the single place
that decides which providers exist per environment:

```ts
if (isDev && env.mockSecret) {
  providers.push(new MockPaymentProvider(env.mockSecret, env.publicOrigin))
}

// Add only after §6 passes:
if (env.STRIPE_SECRET_KEY) {
  providers.push(new StripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET!))
}
```

Rules:
- Production with no verified provider → empty list → checkout returns 503.
- The mock provider must never be constructible outside `development`.
- Do not silently fall back from a real provider to the mock.

---

## 6. Sandbox acceptance tests

Every item must pass **before** `verified: true` and before real keys are
installed. Tick these honestly.

### Payment creation
- [ ] Happy path: order created, redirect returned, customer pays
- [ ] Decline: error surfaces, cart preserved, order marked `failed`
- [ ] 3-D Secure challenge completes and returns to a correct state
- [ ] Customer abandons mid-payment: order stays `pending`, cron expires it
- [ ] Provider API timeout: no order left in a paid state
- [ ] Provider API 5xx: stock released, order `failed`

### Webhooks
- [ ] Valid signature + correct amount → order `paid`, stock committed
- [ ] Same webhook delivered twice → second is a no-op (`duplicate: true`)
- [ ] Bad signature → 400, nothing changes
- [ ] Unknown order reference → logged, ignored, no state change
- [ ] Amount mismatch → ignored + logged, **never** fulfilled
- [ ] Currency mismatch → ignored + logged
- [ ] Out-of-order events (paid before authorised) → converges correctly
- [ ] Replay of an old event after order completion → no double fulfilment

### Refunds
- [ ] Full refund → order `refunded`
- [ ] Partial refund → order `refunded` with partial amount recorded
- [ ] Refund retried with same key → single refund

### Idempotency and concurrency
- [ ] Double-click "Pay" → one order, one charge
- [ ] Two tabs, same cart → one order
- [ ] Stock reservation expires while payment in progress → order fails cleanly, no oversell

### Operational
- [ ] Secrets absent → checkout 503, never a fake success
- [ ] Secrets present but provider down → clear error to customer
- [ ] Reconciliation job finds no stuck `pending` orders after 24h

---

## 7. Reconciliation

Webhooks get lost. A daily job should:

1. Find orders `pending` with a `payment_attempts` row older than 1 hour.
2. Call the provider's `getPaymentStatus()` for each.
3. Apply the same transitions the webhook would have.
4. Log every correction to `audit_logs`.

Without this, a dropped webhook leaves a customer charged but unfulfilled.
That is the failure mode most worth engineering against.

---

## 8. Tax and email are also unimplemented

Not payment, but the same honesty applies.

**Tax.** `tax_rules` computes arithmetic from rates you configure. It is
not legal tax determination, and it does not know about nexus, exemptions
or reverse-charge rules.

- Configure rates per country/region in `tax_rules`
- Set `prices_include_tax` to match how your catalogue is priced
- **If you sell into multiple tax jurisdictions, use a TaxProvider** and
  consult an accountant. Do not treat this module as compliance.

**Email.** There is an `EmailProvider` interface and no implementation
unless you add one. Order confirmations are **not sent today**. Configure
Resend (or similar), set `RESEND_API_KEY`, and test in sandbox.

---

## 9. Go-live checklist

- [ ] Provider chosen, account verified, sandbox working
- [ ] Adapter implemented, `getCapabilities().verified === true`
- [ ] §6 fully ticked in sandbox
- [ ] Live keys set via `wrangler secret put`
- [ ] Webhook endpoint registered in the provider dashboard
- [ ] Webhook secret set and verified with a real test event
- [ ] Reconciliation cron enabled
- [ ] One end-to-end live test at the lowest possible amount, refunded immediately
- [ ] `/diagnostics` shows a healthy store with a configured provider
- [ ] Tax approach reviewed for the countries you actually sell to
- [ ] Email sending configured and a real confirmation received

Until every box is ticked, the storefront will refuse to take money and say
so plainly. That behaviour is a feature.
