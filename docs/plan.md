# Implementation plan — standalone commerce backend

Status legend: ✅ done · 🚧 in progress · ⬜ not started

## What changes

The storefront stops being a WooCommerce client and becomes a client of a
first-party API running on Cloudflare Workers with D1 + R2. The existing
React UI, visual design, cart drawer, checkout flow, demo/mock/live modes
and diagnostics page are **preserved**; only the data layer underneath is
replaced.

### Why Workers, not Pages Functions

| | Workers | Pages Functions |
|---|---|---|
| D1/R2 bindings | ✅ first-class | ✅ |
| Independent versioning | ✅ own deploy | tied to the Pages project |
| Cron triggers (stock release, reconciliation) | ✅ | ❌ |
| Local `wrangler dev` parity | ✅ | partial |

Cron triggers matter: unpaid orders must release reserved stock on a
schedule (see `docs/testing.md` → stock release). Pages Functions cannot do
that, so the backend is a Worker. The static front end still deploys to
Pages (or Workers assets) and calls the Worker over HTTPS, same origin via
a Worker route.

## Layers

```
worker/
  index.ts            router + CORS + error envelope
  env.ts              binding types
  lib/                money, errors, validation, crypto, rate limit
  repositories/       D1 access only — no business rules
  services/           business logic, framework-free and unit-testable
  payments/           PaymentProvider interface + dev mock
  routes/             HTTP handlers: parse → validate → service → respond
migrations/           numbered, idempotent SQL
tests/                pure-logic tests, run with node --test
```

Rules enforced:

- **Money is integers.** Every amount is `INTEGER` minor units plus an
  explicit `currency` and `minor_unit`. No floats anywhere in the path
  between price and receipt. See `worker/lib/money.ts`.
- **Repositories never decide.** They read and write rows. Pricing,
  eligibility and state transitions live in `services/`, so they can be
  tested without a database.
- **Server recomputes everything.** Cart and checkout totals are derived
  from D1 on every request; client-supplied prices are ignored entirely.
- **Orders are immutable snapshots.** `order_items` copies name, SKU,
  variant label, unit price and line totals at creation time.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Baseline: existing `npm run verify` | ✅ green |
| 2 | D1 migrations (19 tables) | ✅ |
| 3 | `lib/` — money, errors, validation, crypto | ✅ |
| 4 | Repositories | ✅ |
| 5 | Services — pricing, coupons, shipping, tax, inventory | ✅ |
| 6 | API routes (v1) | ✅ |
| 7 | Admin auth + admin API | ✅ |
| 8 | PaymentProvider + dev-only mock | ✅ |
| 9 | Front end rewired to `/api/v1` | ✅ |
| 10 | Tests + `npm run verify` | ✅ |
| 11 | Docs: deployment, payments, testing | ✅ |

## Deliberately NOT done

These need a merchant account, credentials or a decision that is yours:

- **No real payment provider.** `PaymentProvider` is an interface; only a
  mock implementation exists, and it refuses to run in production. No
  gateway is marked verified.
- **No real email provider.** `EmailProvider` is an interface with a
  logging stub. Order emails are not sent.
- **No real tax compliance.** Tax rules are configurable basis points.
  This is arithmetic, not legal tax determination. A `TaxProvider` seam
  exists for a real service.
- **No D1/R2 resources created.** I cannot touch your Cloudflare account.
  Migration and binding steps are documented, not executed.
- **No image uploads exercised.** The R2 upload route validates type, size
  and magic bytes, but has not been run against a real bucket.

## Pre-existing behaviour preserved

- `demo` mode: no network calls at all.
- `mock` mode: local fake API, dev-only, excluded from production builds
  (verified by `scripts/verify-build.mjs`).
- `live` mode: real backend; if payment is unconfigured the order is
  created as `pending` and the UI says so — it never fakes success.
- Cart drawer, quick view, favourites, diagnostics page, all styling.
