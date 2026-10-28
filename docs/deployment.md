# Deployment — GitHub + Cloudflare

Everything below is a procedure you run. **Nothing here has been executed
against your Cloudflare account** — no D1 database exists yet, no R2
bucket, no Worker, no custom domain. Those are yours to create.

---

## 0. Architecture choice

**Cloudflare Workers** for the API, **Pages** for the static frontend.

| | Workers (chosen) | Pages Functions |
|---|---|---|
| Cron triggers | ✅ | ❌ |
| Independent deploy | ✅ | tied to Pages |
| `wrangler dev` parity | ✅ | partial |

The cron trigger is the deciding factor: unpaid orders must release their
stock reservations on a schedule (`*/5 * * * *`). Pages Functions cannot
run scheduled jobs.

```
Browser ──▶ Cloudflare Pages (static React app from dist/)
   │
   └────▶ Worker  jianzhan-api  ──▶ D1 (SQLite)
                                  └─▶ R2  (images)
```

---

## 1. Prerequisites

```bash
npm install
npx wrangler login
```

---

## 2. Create D1

```bash
# Production
npx wrangler d1 create jianzhan-db
# → copy the returned database_id into wrangler.toml

# Preview (separate database, so preview data never touches prod)
npx wrangler d1 create jianzhan-db-preview
# → paste into [env.preview] in wrangler.toml
```

Then apply migrations:

```bash
npx wrangler d1 migrations apply jianzhan-db --local    # local dev
npx wrangler d1 migrations apply jianzhan-db --remote   # production
npx wrangler d1 migrations apply jianzhan-db-preview --remote --env preview
```

Migrations are numbered and idempotent (`IF NOT EXISTS`), so re-running is
safe.

---

## 3. Create R2

```bash
npx wrangler r2 bucket create jianzhan-images
npx wrangler r2 bucket create jianzhan-images-preview
```

The R2 bucket is **private**. Product images are served through the
Worker, not by public bucket URL. That keeps upload validation on the
path and lets you revoke access later.

---

## 4. Secrets

Never in `wrangler.toml`, never in git, never in a `VITE_` variable.

```bash
# Generate a strong session secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npx wrangler secret put SESSION_SECRET --env production
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN --env production
```

For local development only:

```bash
# .dev.vars  (already git-ignored — verify with `git check-ignore .dev.vars`)
SESSION_SECRET="local-dev-only"
PAYMENT_MOCK_SECRET="local-mock-secret"
ENVIRONMENT="development"
```

**`PAYMENT_MOCK_SECRET` must never be set in production.** The mock payment
provider refuses to construct outside `development`, and the admin
diagnostics page warns if the secret is present in another environment.

---

## 5. Deploy the Worker

```bash
npx wrangler deploy --env production
```

Wire the cron in `wrangler.toml` (already configured):

```toml
[env.production.triggers]
crons = ["*/5 * * * *"]
```

What the cron does, every 5 minutes:

1. Release inventory reservations past their TTL.
2. Expire unpaid orders and release their stock.
3. Mark abandoned carts.
4. Delete expired admin sessions.
5. Prune rate-limit rows.

Each step is bounded (`LIMIT 500`) and idempotent, so a backlog drains over
several runs rather than timing out.

---

## 6. Create the first admin

There is no default password and no public signup.

```bash
# 1. Set a one-time token
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN --env production

# 2. Call it once
curl -X POST https://api.yourdomain.com/api/v1/admin/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"<12+ chars>","token":"<the token>"}'

# 3. Remove the token immediately
npx wrangler secret delete ADMIN_BOOTSTRAP_TOKEN --env production
```

Bootstrap refuses if an admin already exists. The admin diagnostics page
warns you if the token is still set.

---

## 7. Deploy the frontend

GitHub → Cloudflare Pages:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` |

Environment variables (Pages → Settings → Environment variables):

| Variable | Production | Preview |
|---|---|---|
| `VITE_STORE_MODE` | `live` | `mock` |
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | preview Worker URL |

Then add the Pages origin to the Worker's `ALLOWED_ORIGINS` in
`wrangler.toml` and redeploy the Worker.

---

## 8. Routing

Recommended: one custom domain, path-based split.

```
www.yourdomain.com/          → Pages (static)
www.yourdomain.com/api/*     → Worker
```

Worker route in `wrangler.toml`:

```toml
routes = [
  { pattern = "www.yourdomain.com/api/*", zone_name = "yourdomain.com" }
]
```

`public/_redirects` already handles SPA deep links (`/* /index.html 200`).
Verify after deploy:

```bash
curl -I https://www.yourdomain.com/checkout   # expect 200
curl https://www.yourdomain.com/api/health    # expect {"ok":true,...}
```

---

## 9. Environment isolation

| | Development | Preview | Production |
|---|---|---|---|
| D1 | local `.wrangler/state` | `jianzhan-db-preview` | `jianzhan-db` |
| R2 | local | preview bucket | production bucket |
| Mock payment | ✅ allowed | ❌ | ❌ |
| Real payments | ❌ until configured | sandbox only | live only |

**Never point preview at production data.** The config uses separate
database IDs per environment precisely so this cannot happen by accident.

---

## 10. Caching

Cart, checkout and order responses are sent with:

```
Cache-Control: no-store, no-cache, must-revalidate, private
```

This is set in `worker/lib/http.ts` on **every** JSON response, not
per-route, so a new endpoint cannot accidentally become cacheable.

Static assets on Pages are hashed and immutable:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

---

## 11. What is NOT done

Be explicit with yourself about this list:

- [ ] No D1 database created in your account.
- [ ] No R2 bucket created.
- [ ] No Worker deployed.
- [ ] No custom domain bound.
- [ ] **No real payment provider.** Checkout returns 503
      `payment_unconfigured` until one is added and verified.
- [ ] **No email sending.** `EmailProvider` is an interface with a stub.
      Order confirmations are not sent.
- [ ] **No R2 upload exercised** against a real bucket.
- [ ] Tax rules are arithmetic, not legal tax determination.

The site is fully functional as a catalogue and as a cart/checkout flow in
development. It cannot take real money yet, and it will tell you so rather
than pretending.

---

## 12. Verifying a deployment

```bash
npm run verify                                  # types + 53 tests + build checks
curl -s https://api.yourdomain.com/api/health   # {"ok":true,...}
npx wrangler d1 execute jianzhan-db --remote \
  --command "SELECT COUNT(*) FROM products"     # seeded?
```

Then open `/diagnostics` in the app. It probes live endpoints and names
any failure — CORS, missing tables, unconfigured payment — instead of
showing a blank page.
