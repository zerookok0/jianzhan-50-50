# Testing

Three tiers. **Only tier 1 has actually been run.** Nothing in tiers 2 or 3
is claimed as passing.

---

## Tier 1 — Run automatically, in this repo

```bash
npm run verify
```

Order: frontend types → Worker types → 53 unit tests → migration checks →
build verification.

### Latest result

| Suite | Count | Result |
|---|---|---|
| Money arithmetic | 12 | ✅ |
| Pricing / coupons / shipping | 25 | ✅ |
| Inventory concurrency | 8 | ✅ |
| Migration structure | 17 assertions | ✅ |
| Build verification | 7 checks | ✅ |
| Frontend typecheck | — | ✅ 0 errors |
| Worker typecheck | — | ✅ 0 errors |
| Production build | 68 modules | ✅ ~1.7s |

### What the unit tests actually prove

**`tests/money.test.mjs`**
- No float drift across 100 accumulations (integer cents only)
- Basis points: round / floor / ceil all correct
- Minor units for USD(2), JPY(0), KWD(3)
- `parseMoneyToMinor` **refuses** input with more decimals than the
  currency supports, rather than silently rounding someone's money

**`tests/pricing.test.mjs`**
- Largest-remainder discount allocation: parts sum **exactly** to the total
- Tax computed on the **discounted** amount
- Shipping taxed separately
- Tax-inclusive prices **extract** tax instead of adding it
- Tax rule specificity ordering
- Coupons: expiry, start date, minimum, global limit, per-customer limit,
  exclusive stacking, product scoping, inactive
- Shipping: zone specificity, flat/weight/subtotal rates, free thresholds,
  stale-method selection returns null rather than a wrong price

**`tests/inventory.test.mjs`**
- Two concurrent reservations for the last unit: **exactly one** succeeds
- Multi-line reservation is all-or-nothing
- Failed reservation leaves stock untouched
- Release returns stock; commit deducts permanently

**`scripts/check-migrations.mjs`**
- Every migration parses (balanced parens/quotes)
- All 19 required tables exist
- Every `CREATE TABLE`/`CREATE INDEX` is idempotent
- **No REAL/FLOAT/NUMERIC anywhere** — money is always INTEGER
- Money tables carry `currency` + `minor_unit`
- Uniqueness constraints that correctness depends on are present
  (`public_reference`, `idempotency_key`, `token_hash`, webhook hash)

**`scripts/verify-build.mjs`**
- No secrets in the client bundle
- No Worker/D1 identifiers leaked into browser code
- SPA fallback shipped
- Local secret files are git-ignored
- `wrangler.toml` `[vars]` contains no secrets

---

## Bugs these tests caught

Both were real, in shipped code.

### 1. Tax-inclusive pricing inflated the grand total

A £120 price including 20% VAT produced £140: the extracted £20 was added
on top of a price that already contained it. Fixed by tracking
`taxIncludedInPrices` and subtracting it from the grand total while still
reporting it on the invoice.

### 2. Partial reservation failure corrupted stock counts

When a multi-line reservation failed on line 2, the reservation row for
line 1 had already been inserted, so rollback decremented `reserved` for a
line that never incremented it — silently inflating availability. Fixed by
sequencing: confirm each stock UPDATE first, then write reservation rows,
then roll back only what genuinely succeeded.

Neither was visible by reading the code. Both came from asserting exact
numbers.

### 3. Checkout idempotency key was never sent

`submitCheckout()` accepted an `idempotencyKey`, documented that it
prevented double-charging, and then dropped it — `...{}` instead of a
header. Caught during the migration to the first-party API and fixed; the
`Idempotency-Key` header is now actually transmitted.

---

## Tier 2 — Requires a running Worker

**Not run.** `workerd` is a native binary that cannot execute in this
sandbox, so `wrangler dev` and `wrangler d1 migrations apply` both fail
here. The migration SQL is verified statically instead (tier 1), but it has
**never been executed against a real SQLite instance**.

Run these on a machine with the Workers runtime:

### Migrations
- [ ] `wrangler d1 migrations apply jianzhan-db --local` from empty
- [ ] Re-run: idempotent, no error
- [ ] Foreign keys enforced (`PRAGMA foreign_keys` is on)
- [ ] `uniq_cart_line` actually prevents duplicate lines

### Catalogue
- [ ] `GET /api/v1/products` returns seeded rows with `minorUnit`
- [ ] Product with no images serialises without crashing
- [ ] Filtering by category and search behave
- [ ] Pagination returns correct pages

### Cart
- [ ] `POST /cart/items` creates a cart and returns `X-Cart-Token`
- [ ] The same token reuses the cart
- [ ] Missing token creates a new cart
- [ ] `PATCH` quantity 0 removes the line
- [ ] Adding more than stock is refused with `out_of_stock`
- [ ] Invalid coupon → 409 `coupon_invalid`
- [ ] Valid coupon reduces `discountTotal`
- [ ] Changing destination re-prices shipping and tax

### Checkout
- [ ] `POST /checkout` with no provider → **503 `payment_unconfigured`**
- [ ] Duplicate `Idempotency-Key` → same order, not two
- [ ] Stock reserved on order creation
- [ ] Cron releases the reservation after expiry

### Admin
- [ ] Login rate-limits after 5 attempts
- [ ] Route without session → 401
- [ ] Mutating route without CSRF header → 403
- [ ] Bootstrap refuses when an admin already exists
- [ ] Audit log records each write

### Webhooks
- [ ] Bad signature → 400, no state change
- [ ] Replay → `duplicate: true`
- [ ] Amount mismatch → ignored and logged

---

## Tier 3 — Real payment sandbox

**Not run. No provider is integrated.** The full matrix is in
`docs/payment-provider-integration.md` §6. Until it passes, checkout
returns 503 by design.

---

## Manual / visual checks

- [ ] 360px, 390px, 768px, 1440px
- [ ] Keyboard-only cart and checkout
- [ ] `prefers-reduced-motion`
- [ ] Screen-reader: cart count, form errors, drawer focus trap
- [ ] No horizontal overflow

---

## What I have not claimed

- Migrations have never executed against real SQLite.
- The Worker has never served a request.
- No payment has been processed, in sandbox or otherwise.
- No email has been sent.
- No browser has rendered this build for a human to look at.

Everything in tier 1 above is reproducible with `npm run verify`.
Everything in tiers 2 and 3 requires infrastructure this environment does
not have.
