import { json, readJson } from '../lib/http.ts'
import { conflict, paymentUnconfigured, validationFailed } from '../lib/errors.ts'
import { Ctx, validate, str, email, parseAddress, type Address } from '../lib/validate.ts'
import { resolveCart } from './cart.ts'
import * as cartRepo from '../repositories/carts.ts'
import { loadCart, computeCartView } from '../services/cart.ts'
import { createOrder } from '../services/orders.ts'
import { buildProviders } from '../payments/provider.ts'
import type { Env } from '../env.ts'

/**
 * CHECKOUT ROUTES
 * ------------------------------------------------------------------
 * Two steps, deliberately separated:
 *
 *   POST /api/v1/checkout/quote  — price the cart for an address. No writes
 *                                  to orders, no stock reservation. Safe to
 *                                  call on every keystroke.
 *   POST /api/v1/checkout        — create the order, reserve stock, start
 *                                  payment.
 *
 * The quote step exists because shipping and tax depend on the destination,
 * and the customer needs to see the final number before committing.
 */

const RESERVATION_MINUTES = 30

/* ---------------- POST /api/v1/checkout/quote ---------------- */

export async function quoteHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      country: str(ctx, obj.country, 'country', { max: 2 }),
      region: str(ctx, obj.region, 'region', { required: false, max: 120 }),
      postcode: str(ctx, obj.postcode, 'postcode', { required: false, max: 24 }),
      email: str(ctx, obj.email, 'email', { required: false, max: 254 }),
      shippingMethodId: str(ctx, obj.shippingMethodId, 'shippingMethodId', {
        required: false,
        max: 64,
      }),
    }
  })

  const { cart } = await resolveCart(env, request)

  // Apply the destination transiently so shipping/tax can be priced without
  // persisting a half-filled address.
  const probeCart = {
    ...cart,
    country: input.country.toUpperCase(),
    region: input.region || null,
    postcode: input.postcode || null,
    email: input.email || cart.email,
  }

  const loaded = await loadCart(env.DB, probeCart, {
    selectedShippingId: input.shippingMethodId || null,
  })
  const view = await computeCartView(env.DB, loaded, probeCart.email)

  return json({ quote: view })
}

/* ---------------- POST /api/v1/checkout ---------------- */

export async function checkoutHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    const billingRaw = obj.billingAddress ?? obj.billing_address
    const shippingRaw = obj.shippingAddress ?? obj.shipping_address

    const billing = parseAddress(ctx, billingRaw, 'billingAddress')
    const sameAsBilling = obj.shippingSameAsBilling !== false
    const shipping = sameAsBilling
      ? billing
      : parseAddress(ctx, shippingRaw, 'shippingAddress')

    return {
      email: email(ctx, obj.email, 'email'),
      phone: str(ctx, obj.phone, 'phone', { required: false, max: 32 }),
      billing,
      shipping,
      shippingMethodId: str(ctx, obj.shippingMethodId, 'shippingMethodId', {
        required: false,
        max: 64,
      }),
      customerNote: str(ctx, obj.customerNote, 'customerNote', {
        required: false,
        max: 1000,
      }),
      idempotencyKey: request.headers.get('Idempotency-Key') ??
        str(ctx, obj.idempotencyKey, 'idempotencyKey', { required: false, max: 100 }),
    }
  })

  if (!input.billing.line1 || !input.billing.city) {
    throw validationFailed({ billingAddress: 'A complete billing address is required.' })
  }

  const { cart } = await resolveCart(env, request)

  /*
   * Persist the destination BEFORE pricing.
   *
   * This was the bug that made checkout impossible: the quote endpoint
   * applies the address only to a throwaway copy of the cart, but order
   * creation prices the cart it loaded from D1 — which still had a null
   * country, so shipping came back "Enter a delivery country to see
   * shipping" and every order was refused with a 409.
   *
   * The shipping address is the destination goods actually travel to. It
   * is also what tax is based on (destination-based VAT/sales tax), so
   * persisting it is the correct model, not a workaround. On the next
   * checkout request loadCart picks it up from the row.
   */
  await cartRepo.updateCartContact(env.DB, cart.id, {
    country: input.shipping.country.toUpperCase(),
    region: input.shipping.region || null,
    postcode: input.shipping.postcode || null,
    email: input.email.toLowerCase(),
  })

  const refreshed = await cartRepo.findCartByTokenHash(env.DB, cart.token_hash)
  if (!refreshed) throw conflict('Your cart could not be loaded. Please refresh and try again.')

  const loaded = await loadCart(env.DB, refreshed, {
    selectedShippingId: input.shippingMethodId || null,
  })

  /* ---- Payment provider gate ---- */

  const { providers, config } = buildProviders({
    environment: env.ENVIRONMENT,
    mockSecret: env.PAYMENT_MOCK_SECRET,
    publicOrigin: env.APP_ORIGIN,
  })

  const provider = providers[0] ?? null

  if (!provider) {
    throw paymentUnconfigured(
      config.blockers[0] ??
        'No payment provider is configured. Orders cannot be placed until one is added.',
    )
  }

  /* ---- Create ---- */

  const result = await createOrder(env.DB, {
    cart: loaded,
    email: input.email,
    phone: input.phone,
    billing: input.billing,
    shipping: input.shipping,
    selectedShippingId: input.shippingMethodId || null,
    customerNote: input.customerNote,
    idempotencyKey: input.idempotencyKey || null,
    provider,
    returnUrl: `${env.APP_ORIGIN}/order/${'{REFERENCE}'}`,
    cancelUrl: `${env.APP_ORIGIN}/checkout`,
    reservationMinutes: Number(env.ORDER_RESERVATION_MINUTES ?? RESERVATION_MINUTES),
  })

  return json({
    order: {
      reference: result.orderReference,
      status: result.status,
      paymentStatus: result.paymentStatus,
      totals: result.totals,
      reused: result.reused,
    },
    payment: {
      provider: provider.id,
      /** The client redirects here. Never treated as proof of payment. */
      redirectUrl: result.redirectUrl?.replace('{REFERENCE}', result.orderReference) ?? null,
      clientSecret: result.clientSecret,
    },
  }, { status: result.reused ? 200 : 201 })
}

/* ---------------- GET /api/v1/orders/:reference ---------------- */

export async function getOrderHandler(env: Env, reference: string): Promise<Response> {
  // Dynamic import keeps the orders service out of the catalogue hot path.
  const { getOrderByReference } = await import('../services/orders.ts')

  const normalized = reference.trim().toUpperCase()
  if (!/^JZ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    throw conflict('Order reference is not valid.')
  }

  const order = await getOrderByReference(env.DB, normalized)
  if (!order) {
    // Deliberately identical to a malformed reference: do not confirm
    // whether a given reference exists.
    throw conflict('Order reference is not valid.')
  }

  // Redact the email for the public view.
  return json({
    order: {
      ...order,
      email: maskEmail(order.email),
    },
  })
}

function maskEmail(value: string): string {
  const [user, domain] = value.split('@')
  if (!domain) return '•••'
  const visible = user.slice(0, 1)
  return `${visible}${'•'.repeat(Math.max(2, user.length - 1))}@${domain}`
}

export type { Address }
