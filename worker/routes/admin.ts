import { json, readJson, clientIp } from '../lib/http.ts'
import { forbidden, notFound, validationFailed } from '../lib/errors.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { Ctx, validate, str, int, email } from '../lib/validate.ts'
import { enforceRateLimit } from '../lib/rateLimit.ts'
import { LIMITS } from '../lib/rateLimit.ts'
import {
  bootstrapAdmin,
  login,
  logout,
  requireAdmin,
  validatePasswordStrength,
} from '../services/auth.ts'
import { buildProviders } from '../payments/provider.ts'
import type { Env } from '../env.ts'

/**
 * ADMIN ROUTES
 * ------------------------------------------------------------------
 * Every route here validates the session server-side before touching
 * data. Hiding the UI is not access control.
 */

async function ipHash(request: Request): Promise<string> {
  return sha256Hex(clientIp(request))
}

/* ---------------- Auth ---------------- */

export async function loginHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      email: email(ctx, obj.email, 'email'),
      password: str(ctx, obj.password, 'password', { min: 1, max: 200, trim: false }),
    }
  })

  const ip = clientIp(request)

  // Rate limit per IP and per account, so neither alone is bypassable.
  await enforceRateLimit(env.DB, `login:ip:${ip}`, LIMITS.login.limit, LIMITS.login.window)
  await enforceRateLimit(
    env.DB,
    `login:email:${input.email}`,
    LIMITS.login.limit,
    LIMITS.login.window,
  )

  const result = await login(env.DB, {
    email: input.email,
    password: input.password,
    userAgent: request.headers.get('User-Agent') ?? '',
    ipHash: await ipHash(request),
  })

  if (!result.ok) {
    return json({ error: { code: 'unauthorized', message: result.message } }, { status: 401 })
  }

  const headers = new Headers()
  for (const cookie of result.cookies ?? []) headers.append('Set-Cookie', cookie)

  return json({ user: result.user }, { headers })
}

export async function logoutHandler(env: Env, request: Request): Promise<Response> {
  const cookies = await logout(env.DB, request)
  const headers = new Headers()
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return json({ ok: true }, { headers })
}

export async function sessionHandler(env: Env, request: Request): Promise<Response> {
  const session = await requireAdmin(env.DB, request)
  return json({
    user: { id: session.userId, email: session.email, role: session.role },
    csrfToken: session.csrfToken,
  })
}

export async function bootstrapHandler(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      email: email(ctx, obj.email, 'email'),
      password: str(ctx, obj.password, 'password', { max: 200, trim: false }),
      token: str(ctx, obj.token, 'token', { max: 200 }),
    }
  })

  const weak = validatePasswordStrength(input.password)
  if (weak) throw validationFailed({ password: weak })

  const result = await bootstrapAdmin(env.DB, {
    email: input.email,
    password: input.password,
    token: input.token,
    expectedToken: env.ADMIN_BOOTSTRAP_TOKEN,
  })

  if (!result.ok) {
    return json({ error: { code: 'forbidden', message: result.message } }, { status: 403 })
  }
  return json({ ok: true, message: result.message })
}

/* ---------------- Products ---------------- */

export async function adminListProductsHandler(env: Env, request: Request, url: URL): Promise<Response> {
  await requireAdmin(env.DB, request)

  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('perPage') ?? 50)))

  const listResult = await env.DB
    .prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT ?1 OFFSET ?2')
    .bind(perPage, (page - 1) * perPage)
    .all<Record<string, unknown>>()

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>()

  return json({
    products: listResult.results ?? [],
    total: count?.n ?? 0,
    page,
    perPage,
  })
}

export async function adminUpsertProductHandler(env: Env, request: Request): Promise<Response> {
  const session = await requireAdmin(env.DB, request, { requireRole: 'admin' })
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      id: str(ctx, obj.id, 'id', { required: false, max: 64 }),
      slug: str(ctx, obj.slug, 'slug', { max: 140 }),
      name: str(ctx, obj.name, 'name', { max: 200 }),
      subtitle: str(ctx, obj.subtitle, 'subtitle', { required: false, max: 300 }),
      description: str(ctx, obj.description, 'description', { required: false, max: 20000 }),
      price: int(ctx, obj.price, 'price', { min: 0, max: 100_000_000 }),
      currency: str(ctx, obj.currency ?? 'USD', 'currency', { max: 3 }),
      sku: str(ctx, obj.sku, 'sku', { required: false, max: 80 }),
      categoryId: str(ctx, obj.categoryId, 'categoryId', { required: false, max: 64 }),
      status: str(ctx, obj.status ?? 'draft', 'status', { max: 20 }),
      weightG: int(ctx, obj.weightG ?? 0, 'weightG', { min: 0, max: 1_000_000 }) ?? 0,
      requiresShipping: obj.requiresShipping !== false,
      taxClass: str(ctx, obj.taxClass ?? 'standard', 'taxClass', { max: 40 }),
    }
  })

  const allowedStatus = ['draft', 'active', 'archived']
  if (!allowedStatus.includes(input.status)) {
    throw validationFailed({ status: `Must be one of: ${allowedStatus.join(', ')}` })
  }

  const now = Date.now()
  const id = input.id || crypto.randomUUID()

  const existing = await env.DB
    .prepare('SELECT id FROM products WHERE id = ?1')
    .bind(id)
    .first<{ id: string }>()

  if (existing) {
    await env.DB
      .prepare(
        `UPDATE products SET
           slug = ?2, name = ?3, subtitle = ?4, description = ?5, price = ?6,
           currency = ?7, sku = ?8, category_id = ?9, status = ?10, weight_g = ?11,
           requires_shipping = ?12, tax_class = ?13, updated_at = ?14
         WHERE id = ?1`,
      )
      .bind(
        id, input.slug, input.name, input.subtitle, input.description, input.price,
        input.currency.toUpperCase(), input.sku || null, input.categoryId || null,
        input.status, input.weightG, input.requiresShipping ? 1 : 0,
        input.taxClass, now,
      )
      .run()
  } else {
    await env.DB
      .prepare(
        `INSERT INTO products
           (id, slug, name, subtitle, description, price, currency, minor_unit, sku,
            category_id, status, weight_g, requires_shipping, tax_class, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,2,?8,?9,?10,?11,?12,?13,?14,?14)`,
      )
      .bind(
        id, input.slug, input.name, input.subtitle, input.description, input.price,
        input.currency.toUpperCase(), input.sku || null, input.categoryId || null,
        input.status, input.weightG, input.requiresShipping ? 1 : 0, input.taxClass, now,
      )
      .run()
  }

  await audit(env, session.userId, existing ? 'product.update' : 'product.create', 'product', id)

  return json({ ok: true, id }, { status: existing ? 200 : 201 })
}

/* ---------------- Inventory ---------------- */

export async function adminAdjustInventoryHandler(env: Env, request: Request): Promise<Response> {
  const session = await requireAdmin(env.DB, request, { requireRole: 'admin' })
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      inventoryId: str(ctx, obj.inventoryId, 'inventoryId', { max: 64 }),
      delta: int(ctx, obj.delta, 'delta', { min: -100_000, max: 100_000 }),
      reason: str(ctx, obj.reason, 'reason', { required: false, max: 300 }),
    }
  })

  const row = await env.DB
    .prepare('SELECT on_hand FROM inventory WHERE id = ?1')
    .bind(input.inventoryId)
    .first<{ on_hand: number }>()

  if (!row) throw notFound('Inventory row not found.')
  const delta = input.delta ?? 0
  if (row.on_hand + delta < 0) {
    throw validationFailed({ delta: 'Adjustment would make stock negative.' })
  }

  const now = Date.now()
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE inventory
            SET on_hand = on_hand + ?2,
                sellable = (on_hand + ?2) - reserved,
                updated_at = ?3
          WHERE id = ?1`,
      )
      .bind(input.inventoryId, delta, now),
    env.DB
      .prepare(
        `INSERT INTO inventory_adjustments (id, inventory_id, delta, reason, actor_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(crypto.randomUUID(), input.inventoryId, delta, input.reason, session.userId, now),
  ])

  await audit(env, session.userId, 'inventory.adjust', 'inventory', input.inventoryId, {
    delta,
    reason: input.reason,
  })

  return json({ ok: true })
}

/* ---------------- Orders ---------------- */

export async function adminListOrdersHandler(env: Env, request: Request, url: URL): Promise<Response> {
  await requireAdmin(env.DB, request)

  const status = url.searchParams.get('status')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('perPage') ?? 25)))

  const where = status ? 'WHERE status = ?1' : ''
  const binds: unknown[] = status ? [status] : []

  const rows = await env.DB
    .prepare(
      `SELECT id, public_reference, email, status, fulfilment_status, grand_total, currency,
              minor_unit, created_at
         FROM orders ${where}
        ORDER BY created_at DESC
        LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
    .bind(...binds, perPage, (page - 1) * perPage)
    .all<Record<string, unknown>>()

  return json({ orders: rows.results ?? [], page, perPage })
}

export async function adminUpdateFulfilmentHandler(env: Env, request: Request): Promise<Response> {
  const session = await requireAdmin(env.DB, request, { requireRole: 'admin' })
  const body = await readJson(request)

  const input = validate((ctx: Ctx) => {
    const obj = (body ?? {}) as Record<string, unknown>
    return {
      orderId: str(ctx, obj.orderId, 'orderId', { max: 64 }),
      fulfilmentStatus: str(ctx, obj.fulfilmentStatus, 'fulfilmentStatus', { max: 20 }),
    }
  })

  const allowed = ['unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled']
  if (!allowed.includes(input.fulfilmentStatus)) {
    throw validationFailed({ fulfilmentStatus: `Must be one of: ${allowed.join(', ')}` })
  }

  await env.DB
    .prepare('UPDATE orders SET fulfilment_status = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(input.orderId, input.fulfilmentStatus, Date.now())
    .run()

  await audit(env, session.userId, 'order.fulfilment', 'order', input.orderId, {
    to: input.fulfilmentStatus,
  })

  return json({ ok: true })
}

/* ---------------- Diagnostics ---------------- */

export async function adminDiagnosticsHandler(env: Env, request: Request): Promise<Response> {
  await requireAdmin(env.DB, request)

  const { config } = buildProviders({
    environment: env.ENVIRONMENT,
    mockSecret: env.PAYMENT_MOCK_SECRET,
    publicOrigin: env.APP_ORIGIN,
  })

  const [productCount, orderCount, lowStock] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>(),
    env.DB
      .prepare('SELECT COUNT(*) AS n FROM inventory WHERE is_tracked = 1 AND sellable <= 0')
      .first<{ n: number }>(),
  ])

  return json({
    environment: env.ENVIRONMENT,
    currency: env.DEFAULT_CURRENCY,
    counts: {
      products: productCount?.n ?? 0,
      orders: orderCount?.n ?? 0,
      outOfStock: lowStock?.n ?? 0,
    },
    payments: config,
    secrets: {
      // Never echo values — only whether they are present.
      sessionSecret: Boolean(env.SESSION_SECRET),
      paymentMockSecret: Boolean(env.PAYMENT_MOCK_SECRET),
      stripeKey: Boolean(env.STRIPE_SECRET_KEY),
      emailKey: Boolean(env.RESEND_API_KEY),
      bootstrapToken: Boolean(env.ADMIN_BOOTSTRAP_TOKEN),
    },
    warnings: [
      ...config.blockers,
      ...(env.ADMIN_BOOTSTRAP_TOKEN
        ? ['ADMIN_BOOTSTRAP_TOKEN is still set. Remove it now that an admin exists.']
        : []),
      ...(env.ENVIRONMENT !== 'development' && env.PAYMENT_MOCK_SECRET
        ? ['PAYMENT_MOCK_SECRET is set outside development. Remove it.']
        : []),
    ],
  })
}

/* ---------------- Helpers ---------------- */

async function audit(
  env: Env,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await env.DB
      .prepare(
        `INSERT INTO audit_logs
           (id, actor_type, actor_id, action, entity_type, entity_id, detail, ip_hash, created_at)
         VALUES (?1, 'admin', ?2, ?3, ?4, ?5, ?6, '', ?7)`,
      )
      .bind(
        crypto.randomUUID(),
        actorId,
        action,
        entityType,
        entityId,
        JSON.stringify(detail),
        Date.now(),
      )
      .run()
  } catch (err) {
    console.error('[audit]', err)
  }
}

export { forbidden }
