import { publicReference } from '../lib/crypto.ts'
import { conflict, notFound, paymentUnconfigured } from '../lib/errors.ts'
import { multiplyMoney } from '../lib/money.ts'
import * as cartRepo from '../repositories/carts.ts'
import type { CartView, LoadedCart } from './cart.ts'
import { computeCartView } from './cart.ts'
import { reserveStock, commitReservation, releaseReservation, stockError } from './inventory.ts'
import type { Address } from '../lib/validate.ts'
import type { PaymentProvider } from '../payments/provider.ts'

/**
 * ORDER SERVICE
 * ------------------------------------------------------------------
 * Creating an order is the one place where money, stock and payment meet,
 * so the sequence is fixed and defensive:
 *
 *   1. Recompute the cart from the database (never trust the client).
 *   2. Verify stock is still available.
 *   3. Reserve stock (conditional UPDATE — see inventory.ts).
 *   4. Insert an immutable order + item snapshot in one batch.
 *   5. Create a payment attempt and ask the provider for a session.
 *   6. On provider failure, roll the reservation back and fail the order.
 *
 * Payment is never marked paid here. Only a verified webhook may do that.
 */

export interface CreateOrderInput {
  cart: LoadedCart
  email: string
  phone: string
  billing: Address
  shipping: Address
  selectedShippingId: string | null
  customerNote: string
  idempotencyKey: string | null
  provider: PaymentProvider | null
  returnUrl: string
  cancelUrl: string
  reservationMinutes: number
}

export interface CreateOrderResult {
  orderId: string
  orderReference: string
  status: string
  paymentStatus: string
  redirectUrl: string | null
  clientSecret: string | null
  totals: { grandTotal: number; currency: string; minorUnit: number }
  /** True when the order was reused from a matching idempotency key. */
  reused: boolean
}

export async function createOrder(
  db: D1Database,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const { cart } = input

  /* ---- 1. Idempotency: an identical retry returns the same order ---- */

  if (input.idempotencyKey) {
    const existing = await db
      .prepare('SELECT * FROM orders WHERE idempotency_key = ?1')
      .bind(input.idempotencyKey)
      .first<{
        id: string
        public_reference: string
        status: string
        grand_total: number
        currency: string
        minor_unit: number
      }>()

    if (existing) {
      const attempt = await db
        .prepare(
          `SELECT status, metadata FROM payment_attempts
           WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(existing.id)
        .first<{ status: string; metadata: string }>()

      let redirectUrl: string | null = null
      try {
        const meta = attempt?.metadata ? JSON.parse(attempt.metadata) : null
        redirectUrl = meta?.redirect_url ?? null
      } catch {
        redirectUrl = null
      }

      return {
        orderId: existing.id,
        orderReference: existing.public_reference,
        status: existing.status,
        paymentStatus: attempt?.status ?? 'created',
        redirectUrl,
        clientSecret: null,
        totals: {
          grandTotal: existing.grand_total,
          currency: existing.currency,
          minorUnit: existing.minor_unit,
        },
        reused: true,
      }
    }
  }

  /* ---- 2. Recompute the authoritative cart ---- */

  const view: CartView = await computeCartView(db, cart, input.email)

  if (!view.items.length) {
    throw conflict('Your cart is empty.')
  }

  const blocking = view.items.filter((i) => !i.inStock)
  if (blocking.length) {
    throw stockError(
      blocking.map((i) => ({
        name: i.name,
        requested: i.quantity,
        available: i.available,
      })),
    )
  }

  if (view.needsShipping) {
    if (!view.shipping.available) {
      throw conflict(view.shipping.reason ?? 'Delivery is not available for this address.')
    }
    if (!view.shipping.selected) {
      throw conflict('Choose a delivery option before placing the order.')
    }
  }

  /* ---- 3. Payment must be configured before stock is touched ---- */

  if (!input.provider) {
    throw paymentUnconfigured(
      'No payment provider is configured, so the order cannot be placed. Configure a provider in the admin panel.',
    )
  }

  /* ---- 4. Reserve stock ---- */

  const stockLines = cart.priced
    .map((line) => {
      const product = cart.views.find(
        (v) => v.productId === line.productId && v.variantId === line.variantId,
      )
      return { line, product }
    })
    .filter((x) => x.product !== undefined)

  const inventoryRows = await Promise.all(
    stockLines.map(async ({ line }) => {
      const inv = await db
        .prepare(
          `SELECT id FROM inventory
           WHERE product_id = ?1 AND IFNULL(variant_id,'') = ?2`,
        )
        .bind(line.productId, line.variantId ?? '')
        .first<{ id: string }>()
      return { line, inventoryId: inv?.id ?? null }
    }),
  )

  const reservable = inventoryRows.filter((r) => r.inventoryId !== null)
  const orderId = crypto.randomUUID()
  const orderReference = publicReference()

  if (reservable.length) {
    const result = await reserveStock(
      db,
      reservable.map((r) => ({
        inventoryId: r.inventoryId!,
        productId: r.line.productId,
        variantId: r.line.variantId,
        quantity: r.line.quantity,
        name: r.line.name,
      })),
      { type: 'order', id: orderId },
      input.reservationMinutes * 60 * 1000,
    )

    if (!result.ok) throw stockError(result.failures)
  }

  /* ---- 5. Write the immutable order ---- */

  const now = Date.now()
  const expiresAt = now + input.reservationMinutes * 60 * 1000
  const totals = view.totals

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO orders (
          id, public_reference, cart_id, email, phone, currency, minor_unit,
          subtotal, discount_total, shipping_total, tax_total, grand_total,
          status, fulfilment_status, billing_address, shipping_address,
          shipping_method_id, shipping_method_name, customer_note,
          idempotency_key, stock_committed, expires_at, created_at, updated_at
        ) VALUES (
          ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
          'pending','unfulfilled',?13,?14,?15,?16,?17,?18,0,?19,?20,?20
        )`,
      )
      .bind(
        orderId,
        orderReference,
        cart.row.id,
        input.email.toLowerCase(),
        input.phone,
        view.currency,
        view.minorUnit,
        totals.subtotal,
        totals.discountTotal,
        totals.shippingTotal,
        totals.taxTotal,
        totals.grandTotal,
        JSON.stringify(input.billing),
        JSON.stringify(input.shipping),
        view.shipping.selected?.methodId ?? null,
        view.shipping.selected?.name ?? '',
        input.customerNote.slice(0, 1000),
        input.idempotencyKey,
        expiresAt,
        now,
      ),
  ]

  // Item snapshots — copy names, SKUs and prices so later catalogue edits
  // cannot alter a historical order.
  const discountByLine: Record<string, number> = {}
  for (const alloc of totals.discountAllocations) {
    for (const [key, amount] of Object.entries(alloc.perLine)) {
      discountByLine[key] = (discountByLine[key] ?? 0) + amount
    }
  }

  for (const item of view.items) {
    const key = item.variantId ? `${item.productId}:${item.variantId}` : item.productId
    const lineSubtotal = multiplyMoney(item.unitPrice, item.quantity)
    const lineDiscount = discountByLine[key] ?? 0

    statements.push(
      db
        .prepare(
          `INSERT INTO order_items (
            id, order_id, product_id, variant_id, name, variant_label, sku,
            unit_price, quantity, line_subtotal, line_discount, line_tax, line_total,
            weight_g, tax_class, tax_rate_bp, created_at
          ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,0,?13,0,?14)`,
        )
        .bind(
          crypto.randomUUID(),
          orderId,
          item.productId,
          item.variantId,
          item.name,
          item.variantLabel,
          item.sku,
          item.unitPrice,
          item.quantity,
          lineSubtotal,
          lineDiscount,
          lineSubtotal - lineDiscount,
          item.requiresShipping ? 1 : 0,
          now,
        ),
    )
  }

  // Coupon redemption records, for limit enforcement.
  for (const c of view.coupons.filter((c) => c.accepted)) {
    const couponRow = cart.coupons.find((x) => x.code === c.code)
    if (couponRow) {
      statements.push(
        db
          .prepare(
            `INSERT INTO coupon_redemptions (id, coupon_id, order_id, email, amount, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(
            crypto.randomUUID(),
            couponRow.id,
            orderId,
            input.email.toLowerCase(),
            c.discount,
            now,
          ),
      )
    }
  }

  await db.batch(statements)

  /* ---- 6. Create the payment attempt ---- */

  const idempotencyForPayment = `${orderId}:1`
  const attemptId = crypto.randomUUID()

  let paymentResult: { providerReference: string; redirectUrl: string | null; clientSecret: string | null }
  let paymentStatus = 'created'

  try {
    const created = await input.provider.createPayment({
      orderId,
      orderReference,
      amount: totals.grandTotal,
      currency: view.currency,
      minorUnit: view.minorUnit,
      customerEmail: input.email,
      idempotencyKey: idempotencyForPayment,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      description: `Order ${orderReference}`,
    })

    paymentResult = {
      providerReference: created.providerReference,
      redirectUrl: created.redirectUrl ?? null,
      clientSecret: created.clientSecret ?? null,
    }
    paymentStatus = created.status

    await db
      .prepare(
        `INSERT INTO payment_attempts (
          id, order_id, provider, provider_reference, amount, currency, status,
          idempotency_key, metadata, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`,
      )
      .bind(
        attemptId,
        orderId,
        input.provider.id,
        created.providerReference,
        totals.grandTotal,
        view.currency,
        created.status,
        idempotencyForPayment,
        JSON.stringify({ redirect_url: created.redirectUrl ?? null, ...(created.metadata ?? {}) }),
        now,
      )
      .run()
  } catch (err) {
    // Payment could not even be created: release stock and fail the order
    // rather than leaving a reservation held for a dead order.
    await releaseReservation(db, { type: 'order', id: orderId })
    await db
      .prepare(
        `UPDATE orders SET status = 'failed', stock_committed = 0, updated_at = ?2 WHERE id = ?1`,
      )
      .bind(orderId, Date.now())
      .run()

    const message = err instanceof Error ? err.message : 'Payment provider rejected the request.'
    throw conflict(`Payment could not be started: ${message}`)
  }

  await cartRepo.markCartConverted(db, cart.row.id)

  return {
    orderId,
    orderReference,
    status: 'pending',
    paymentStatus,
    redirectUrl: paymentResult.redirectUrl,
    clientSecret: paymentResult.clientSecret,
    totals: {
      grandTotal: totals.grandTotal,
      currency: view.currency,
      minorUnit: view.minorUnit,
    },
    reused: false,
  }
}

/* ---------------- Order reads ---------------- */

export interface OrderView {
  reference: string
  status: string
  fulfilmentStatus: string
  currency: string
  minorUnit: number
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  grandTotal: number
  email: string
  createdAt: number
  items: {
    name: string
    variantLabel: string
    sku: string
    unitPrice: number
    quantity: number
    lineTotal: number
  }[]
  shipping: { address: unknown; methodName: string }
  payments: { provider: string; status: string; amount: number }[]
}

/**
 * Order lookup by the unguessable public reference.
 * Sequential ids are never accepted, so enumeration is impossible.
 */
export async function getOrderByReference(
  db: D1Database,
  reference: string,
): Promise<OrderView | null> {
  const order = await db
    .prepare('SELECT * FROM orders WHERE public_reference = ?1')
    .bind(reference)
    .first<Record<string, unknown>>()

  if (!order) return null

  const [items, payments] = await Promise.all([
    db
      .prepare('SELECT * FROM order_items WHERE order_id = ?1 ORDER BY created_at')
      .bind(order.id)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        'SELECT provider, status, amount FROM payment_attempts WHERE order_id = ?1 ORDER BY created_at',
      )
      .bind(order.id)
      .all<{ provider: string; status: string; amount: number }>(),
  ])

  return {
    reference: String(order.public_reference),
    status: String(order.status),
    fulfilmentStatus: String(order.fulfilment_status),
    currency: String(order.currency),
    minorUnit: Number(order.minor_unit),
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discount_total),
    shippingTotal: Number(order.shipping_total),
    taxTotal: Number(order.tax_total),
    grandTotal: Number(order.grand_total),
    email: String(order.email),
    createdAt: Number(order.created_at),
    items: (items.results ?? []).map((i) => ({
      name: String(i.name),
      variantLabel: String(i.variant_label),
      sku: String(i.sku),
      unitPrice: Number(i.unit_price),
      quantity: Number(i.quantity),
      lineTotal: Number(i.line_total),
    })),
    shipping: {
      address: safeParse(String(order.shipping_address ?? '{}')),
      methodName: String(order.shipping_method_name ?? ''),
    },
    payments: payments.results ?? [],
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {};
  }
}

/* ---------------- Order state transitions ---------------- */

/**
 * Mark an order paid. Idempotent: a second call is a no-op.
 * Only callable from a verified webhook or an admin action.
 */
export async function markOrderPaid(
  db: D1Database,
  orderId: string,
  providerReference: string | null,
): Promise<{ changed: boolean }> {
  const order = await db
    .prepare('SELECT status, stock_committed FROM orders WHERE id = ?1')
    .bind(orderId)
    .first<{ status: string; stock_committed: number }>()

  if (!order) throw notFound('Order not found.')
  if (order.status === 'paid') return { changed: false }

  const now = Date.now()

  await db.batch([
    db
      .prepare(
        `UPDATE orders
            SET status = 'paid', stock_committed = 1, fulfilment_status = 'processing',
                expires_at = NULL, updated_at = ?2
          WHERE id = ?1 AND status != 'paid'`,
      )
      .bind(orderId, now),
    db
      .prepare(
        `UPDATE payment_attempts
            SET status = 'captured', updated_at = ?3
          WHERE order_id = ?1 AND (?2 IS NULL OR provider_reference = ?2)`,
      )
      .bind(orderId, providerReference, now),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, detail, ip_hash, created_at)
         VALUES (?1, 'system', NULL, 'order.paid', 'order', ?2, ?3, '', ?4)`,
      )
      .bind(crypto.randomUUID(), orderId, JSON.stringify({ providerReference }), now),
  ])

  // Committing the reservation is safe to retry: it is a no-op once all
  // reservations for this order are already committed.
  if (!order.stock_committed) {
    await commitReservation(db, { type: 'order', id: orderId })
  }

  return { changed: true }
}

/** Mark an order failed/cancelled and release its stock. Idempotent. */
export async function markOrderFailed(
  db: D1Database,
  orderId: string,
  reason: string,
): Promise<{ changed: boolean }> {
  const order = await db
    .prepare('SELECT status FROM orders WHERE id = ?1')
    .bind(orderId)
    .first<{ status: string }>()

  if (!order) throw notFound('Order not found.')
  if (order.status === 'paid') {
    // Never silently un-pay a paid order; a refund is a separate action.
    throw conflict('This order is already paid and cannot be failed.')
  }
  if (order.status === 'cancelled' || order.status === 'failed') {
    return { changed: false }
  }

  const now = Date.now()
  await db.batch([
    db
      .prepare(`UPDATE orders SET status = 'failed', updated_at = ?2 WHERE id = ?1`)
      .bind(orderId, now),
    db
      .prepare(
        `UPDATE payment_attempts SET status = 'failed', error_message = ?2, updated_at = ?3
         WHERE order_id = ?1 AND status IN ('created','pending')`,
      )
      .bind(orderId, reason.slice(0, 500), now),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, detail, ip_hash, created_at)
         VALUES (?1, 'system', NULL, 'order.failed', 'order', ?2, ?3, '', ?4)`,
      )
      .bind(crypto.randomUUID(), orderId, JSON.stringify({ reason }), now),
  ])

  await releaseReservation(db, { type: 'order', id: orderId })
  return { changed: true }
}

/** Cron: expire unpaid orders and release their stock. */
export async function expireUnpaidOrders(db: D1Database): Promise<number> {
  const now = Date.now()
  const stale = await db
    .prepare(
      `SELECT id FROM orders
        WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?1
        LIMIT 100`,
    )
    .bind(now)
    .all<{ id: string }>()

  let count = 0
  for (const row of stale.results ?? []) {
    try {
      const res = await markOrderFailed(db, row.id, 'Reservation expired before payment.')
      if (res.changed) count++
    } catch (err) {
      console.error('[expire]', row.id, err)
    }
  }
  return count
}
