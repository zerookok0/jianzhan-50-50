# JIANZHAN — Jian ware tea bowls

A storefront for hand-fired Jian ware bowls, with a real cart, checkout and
payment loop behind it. The catalogue is not a lookbook: prices, stock and
totals all come from the API, in integer minor units.

- **Frontend** — React 18 + Vite 5, no UI framework
- **API** — Cloudflare Worker (TypeScript) with D1 + R2 bindings
- **Local host** — the same Worker, run on Node (`scripts/serve-api.mjs`)

---

## Running it locally

Two processes, and **they must agree on the API port**.

```bash
npm install

# 1. The API. Defaults to :8787.
npm run api:dev

# 2. The storefront. Proxies /api to the API.
npm run dev
```

The frontend calls `/api/v1/*` as a same-origin relative path, and Vite
proxies it to the Worker. Production routing is identical (`example.com/api/*`
→ Worker), so a routing or header mistake shows up locally instead of at
launch. No CORS in either case.

### If port 8787 is already taken

```bash
API_PORT=8799 npm run api:dev
API_PORT=8799 npm run dev
```

Both processes read `API_PORT`, so they cannot disagree.

**Check what you are actually talking to.** A stale listener can hold 8787
outside the shell's process table: it answers `/api/health` perfectly while
serving Worker code from an earlier run. That looks healthy and is not, and
it cost real debugging time — every checkout was refused with a 409 that the
current code could not produce.

```bash
curl -s localhost:8787/api/health   # {"ok":true,"environment":"development"}
ps -ef                              # is it in this session's table?
```

If it answers but is not in `ps`, it is not yours. Move ports rather than
fight it.

---

## Resetting the local catalogue

The purchase test places a **real order**, so each run commits stock. That is
deliberate — the test is only worth anything if it exercises committed
writes — but after a few runs the target piece legitimately sells out.

```bash
# Stop the API first.
npm run db:reset

# Then start it again; it rebuilds from migrations and reseeds.
npm run api:dev
```

The reset refuses to run while the API is up. The database lives in memory
(sql.js) and is written back on close, so deleting the file underneath a
running host would restore the very catalogue you meant to clear — a reset
that appears to work and changes nothing. It checks `/api/health` and exits
with an explanation instead.

---

## Tests

```bash
npm run verify          # both typechecks + 64 unit tests + migrations + build checks
npm run test:purchase   # 46 end-to-end checks against a running API
```

Both suites currently pass:

| Suite | Result |
|---|---|
| Frontend typecheck | 0 errors |
| Worker typecheck | 0 errors |
| `tests/*.test.mjs` | 64 passing |
| Migration structure | passing |
| Build verification | passing |
| `scripts/test-purchase.mjs` | 46 passing |

The purchase test needs the API running, and takes a base URL:

```bash
npm run api:dev
npm run test:purchase                              # :8787
API_BASE=http://localhost:5173 npm run test:purchase   # through the Vite proxy
```

Running it through `:5173` is the more faithful check: it exercises the proxy
path the browser actually uses.

When the target piece runs out of stock, the test stops and says so, rather
than reporting a confusing failure:

```
FAIL  the target piece has no stock left
      Earlier runs of this test bought it. Stop the API, then reset the catalogue:
      npm run db:reset
```

### What the purchase test covers

Catalogue reads → cart with server-authoritative pricing → stock refusals
(including a sold-out *variant*, not just a sold-out product) → coupon →
shipping and VAT quotes by destination → order creation → idempotency replay →
signed webhook from the test gateway → paid order → stock committed → public
order view with a masked email → unsigned webhooks rejected.

### What it does not cover

Transactions against real D1. `workerd` cannot run in this sandbox, so
migrations are verified statically and executed only against the sql.js shim.
The SQL is identical; the concurrency semantics are not. See
`docs/testing.md`.

---

## Local secrets

`.dev.vars` holds Worker-only values and is git-ignored. `.env` holds only
`VITE_*` values, which are **public** — Vite inlines them into the bundle.

`VITE_STORE_MODE=live` enables the cart and checkout. Without it the site is a
catalogue and every buy button says purchasing is switched off. Changing
`.env` requires a dev-server restart.

The test payment gateway only constructs when `ENVIRONMENT=development`. It
signs its webhooks like a real provider, so signature verification is
genuinely exercised rather than bypassed.

---

## Documentation

- `docs/testing.md` — what is proven, what is not, and the bugs the tests caught
- `docs/deployment.md` — Cloudflare Workers + Pages procedure
- `docs/payment-provider-integration.md` — adding a real gateway
- `docs/plan.md` — the original build plan

---

## Honest status

Working and verified end to end: catalogue, cart, coupons, shipping and tax
quotes, order creation, idempotency, signed webhooks, stock commitment, order
lookup.

Not done, and the app says so rather than pretending:

- **No real payment provider.** Checkout returns `503 payment_unconfigured`
  until one is added. Money cannot be taken yet.
- **No email.** `EmailProvider` is an interface with a stub.
- **No production deployment.** No D1 database, R2 bucket or Worker exists in
  any account.
- **Nothing rendered for a human.** No browser has been opened on this build;
  the checks are HTTP and type-level.
