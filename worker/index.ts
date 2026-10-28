import type { Env } from './env.ts'
import { createRouter, corsHeaders, preflight, withCors, errorResponse, json } from './lib/http.ts'
import { AppError } from './lib/errors.ts'
import { enforceRateLimit, pruneRateLimits, LIMITS } from './lib/rateLimit.ts'
import { clientIp } from './lib/http.ts'
import {
  listProductsHandler,
  getProductHandler,
  listCategoriesHandler,
} from './routes/catalogue.ts'
import {
  getCartHandler,
  addItemHandler,
  updateItemHandler,
  removeItemHandler,
  applyCouponHandler,
  removeCouponHandler,
  updateDestinationHandler,
} from './routes/cart.ts'
import { quoteHandler, checkoutHandler, getOrderHandler } from './routes/checkout.ts'
import { webhookHandler } from './routes/webhooks.ts'
import { mockSessionHandler, mockCompleteHandler } from './routes/mock-gateway.ts'
import {
  loginHandler,
  logoutHandler,
  sessionHandler,
  bootstrapHandler,
  adminListProductsHandler,
  adminUpsertProductHandler,
  adminAdjustInventoryHandler,
  adminListOrdersHandler,
  adminUpdateFulfilmentHandler,
  adminDiagnosticsHandler,
} from './routes/admin.ts'
import { expireReservations } from './services/inventory.ts'
import { expireUnpaidOrders } from './services/orders.ts'
import { expireStaleCarts } from './repositories/carts.ts'
import { pruneSessions } from './services/auth.ts'

/**
 * WORKER ENTRY POINT
 * ------------------------------------------------------------------
 * Chosen over Pages Functions because this backend needs:
 *   • Cron triggers (stock release, order expiry, session pruning)
 *   • An independent deploy cadence from the static frontend
 *   • A single place for all D1/R2 bindings
 *
 * The static frontend can still live on Cloudflare Pages; it calls this
 * Worker over HTTPS at the same custom domain (see docs/deployment.md).
 */

const routes = [
  /* ---- Public catalogue ---- */
  { method: 'GET', pattern: '/api/v1/products', handler: (c: Ctx) => listProductsHandler(c.env, c.url) },
  { method: 'GET', pattern: '/api/v1/products/:slug', handler: (c: Ctx) => getProductHandler(c.env, c.params.slug) },
  { method: 'GET', pattern: '/api/v1/categories', handler: (c: Ctx) => listCategoriesHandler(c.env) },

  /* ---- Cart ---- */
  { method: 'GET', pattern: '/api/v1/cart', handler: (c: Ctx) => getCartHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/cart/items', handler: (c: Ctx) => addItemHandler(c.env, c.request) },
  { method: 'PATCH', pattern: '/api/v1/cart/items/:id', handler: (c: Ctx) => updateItemHandler(c.env, c.request, c.params.id) },
  { method: 'DELETE', pattern: '/api/v1/cart/items/:id', handler: (c: Ctx) => removeItemHandler(c.env, c.request, c.params.id) },
  { method: 'POST', pattern: '/api/v1/cart/coupons', handler: (c: Ctx) => applyCouponHandler(c.env, c.request) },
  { method: 'DELETE', pattern: '/api/v1/cart/coupons/:code', handler: (c: Ctx) => removeCouponHandler(c.env, c.request, c.params.code) },
  { method: 'PATCH', pattern: '/api/v1/cart/destination', handler: (c: Ctx) => updateDestinationHandler(c.env, c.request) },

  /* ---- Checkout & orders ---- */
  { method: 'POST', pattern: '/api/v1/checkout/quote', handler: (c: Ctx) => quoteHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/checkout', handler: (c: Ctx) => checkoutHandler(c.env, c.request) },
  { method: 'GET', pattern: '/api/v1/orders/:reference', handler: (c: Ctx) => getOrderHandler(c.env, c.params.reference) },

  /* ---- Webhooks ---- */
  { method: 'POST', pattern: '/api/v1/payments/:provider/webhook', handler: (c: Ctx) => webhookHandler(c.env, c.request, c.params.provider) },

  /*
   * ---- Test gateway (development only) ----
   * Both handlers call requireDevelopment() themselves, so registering the
   * routes unconditionally is safe: outside development they 404 exactly
   * like any unknown path. The gate lives with the code it protects rather
   * than in this table, where it could be edited away by mistake.
   */
  { method: 'POST', pattern: '/api/v1/mock-payment/sessions', handler: (c: Ctx) => mockSessionHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/mock-payment/complete', handler: (c: Ctx) => mockCompleteHandler(c.env, c.request) },

  /* ---- Admin ---- */
  { method: 'POST', pattern: '/api/v1/admin/login', handler: (c: Ctx) => loginHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/admin/logout', handler: (c: Ctx) => logoutHandler(c.env, c.request) },
  { method: 'GET', pattern: '/api/v1/admin/session', handler: (c: Ctx) => sessionHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/admin/bootstrap', handler: (c: Ctx) => bootstrapHandler(c.env, c.request) },
  { method: 'GET', pattern: '/api/v1/admin/products', handler: (c: Ctx) => adminListProductsHandler(c.env, c.request, c.url) },
  { method: 'POST', pattern: '/api/v1/admin/products', handler: (c: Ctx) => adminUpsertProductHandler(c.env, c.request) },
  { method: 'POST', pattern: '/api/v1/admin/inventory/adjust', handler: (c: Ctx) => adminAdjustInventoryHandler(c.env, c.request) },
  { method: 'GET', pattern: '/api/v1/admin/orders', handler: (c: Ctx) => adminListOrdersHandler(c.env, c.request, c.url) },
  { method: 'POST', pattern: '/api/v1/admin/orders/fulfilment', handler: (c: Ctx) => adminUpdateFulfilmentHandler(c.env, c.request) },
  { method: 'GET', pattern: '/api/v1/admin/diagnostics', handler: (c: Ctx) => adminDiagnosticsHandler(c.env, c.request) },
]

type Ctx = {
  env: Env
  request: Request
  params: Record<string, string>
  url: URL
}

const route = createRouter<Env>(routes)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)

    // Health check, deliberately unauthenticated and trivial.
    if (url.pathname === '/api/health') {
      return json({ ok: true, environment: env.ENVIRONMENT })
    }

    /* ---- CORS preflight ---- */
    if (request.method === 'OPTIONS') {
      return preflight(request, allowedOrigins)
    }

    const cors = corsHeaders(request, allowedOrigins)

    // A request from an origin that is not allow-listed gets no CORS
    // headers, which the browser enforces. We do not echo it back.
    try {
      /* ---- Rate limiting per IP ---- */
      const ip = clientIp(request)
      const isWebhook = url.pathname.includes('/payments/')
      const isAdminWrite = url.pathname.startsWith('/api/v1/admin/') && request.method !== 'GET'

      if (isWebhook) {
        await enforceRateLimit(env.DB, `wh:${ip}`, LIMITS.webhook.limit, LIMITS.webhook.window)
      } else if (isAdminWrite) {
        await enforceRateLimit(env.DB, `adm:${ip}`, LIMITS.adminWrite.limit, LIMITS.adminWrite.window)
      } else if (request.method === 'GET') {
        await enforceRateLimit(env.DB, `read:${ip}`, LIMITS.publicRead.limit, LIMITS.publicRead.window)
      } else {
        await enforceRateLimit(env.DB, `write:${ip}`, LIMITS.cart.limit, LIMITS.cart.window)
      }

      /* ---- Route ---- */
      const response = await route(request, env)

      if (!response) {
        return withCors(
          errorResponse(new AppError('not_found', 'No such endpoint.', 404)),
          cors,
        )
      }

      return withCors(response, cors)
    } catch (err) {
      return withCors(errorResponse(err), cors)
    }
  },

  /**
   * Cron: keep the database honest.
   * Runs every 5 minutes (see wrangler.toml). Each step is idempotent and
   * bounded, so a backlog drains over successive runs rather than timing out.
   */
  async scheduled(_event: ScheduledController, env: Env, executionCtx: ExecutionContext): Promise<void> {
    executionCtx.waitUntil(
      (async () => {
        try {
          const [reservations, orders, carts, sessions, limits] = await Promise.all([
            expireReservations(env.DB),
            expireUnpaidOrders(env.DB),
            expireStaleCarts(env.DB),
            pruneSessions(env.DB),
            pruneRateLimits(env.DB),
          ])
          if (reservations || orders || carts.length || sessions || limits) {
            console.log('[cron]', { reservations, orders, carts: carts.length, sessions, limits })
          }
        } catch (err) {
          console.error('[cron] failed', err)
        }
      })(),
    )
  },
}
