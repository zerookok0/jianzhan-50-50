# Handover — where this stands

Written immediately before the first commit and a machine restart. Everything
below is what I actually ran; anything I could not run is labelled as such.

**Last full run of `npm run verify`: exit 0.** Details in §2.

---

## 1. What to do next, in order

```bash
# 1. Confirm the tree is green before committing anything.
npm run verify

# 2. Confirm your secrets will not be committed. This is the one that matters.
git status --porcelain            # .dev.vars must NOT appear
git check-ignore -v .dev.vars     # should print the .gitignore rule

# 3. Commit and push.
git add -A
git commit -m "API-driven catalogue, cart, checkout, signed webhooks"
git push
```

Then restart. On the new machine: `npm install`, `npm run api:dev`, `npm run dev`.

**The one thing to check before pushing** is step 2. `.gitignore` did not exist
in this working tree until minutes ago, and `.dev.vars` was sitting in the root
unprotected. It contains `SESSION_SECRET`, `PAYMENT_MOCK_SECRET` and
`ADMIN_BOOTSTRAP_TOKEN`. They are local-only placeholder values, so a leak is
not a production incident — but once a file is in git history, deleting it
later does not remove it. Confirm the ignore rule is in effect rather than
trusting this paragraph.

---

## 2. Verification status

`npm run verify` runs six stages in order, and now builds as part of itself
(previously it required a separate `npm run build` first, which made the
command unable to pass on a clean checkout — fixed).

| Stage | Result |
|---|---|
| Frontend typecheck (`tsc`) | 0 errors |
| Worker typecheck (`tsc`) | 0 errors |
| Unit tests (`node --test tests/*.test.mjs`) | **80 passing** |
| Migration checks | 19 passing |
| Production build | 70 modules, ~1.3s |
| Build verification | 6 passing |

Separately, and **not** covered by `verify`:

| Command | Needs | Status |
|---|---|---|
| `npm run test:purchase` | a running API | not run in this session |

The purchase test is 46 checks against a live API. It was passing earlier in
this work, but I did not run it after the changes in §3, because those changes
touch the migration *checker* and the *build*, not the API or the schema. If
you want it green before you push:

```bash
npm run api:dev          # terminal 1
npm run test:purchase    # terminal 2
```

It buys a real item and commits real stock. Re-running it repeatedly will sell
the target piece out; see §5.

---

## 3. What changed in this last session

Four fixes, all found by running the checks rather than by reading code.

### 3.1 The migration checker was lying about the schema

`npm run test:migrations` reported six failures: missing tables, unbalanced
parentheses, money tables not existing. **The SQL was correct.** The checker
was wrong.

It stripped comments in two regex passes — line comments first, then block
comments:

```js
sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
   .replace(/\/\*[\s\S]*?\*\//g, '')
```

These migration files use banner comments:

```sql
/* ---- Cart items ----------------------------------------------------------
 * A line kept inside the cart.
 * ------------------------------------------------------------------------- */
```

Pass one matches the `--` inside the dashes and deletes the rest of the line,
**including the `*/` that closed the comment**. The block never terminates, so
pass two runs on to the next `*/` further down the file and swallows every
statement in between. In `0004_orders_payments.sql` four `CREATE TABLE`
statements collapsed to one.

Fixed by replacing both passes with a character scanner,
`scripts/lib/sql-strip.mjs`, which tracks which construct it is inside — line
comment, block comment, `'string'`, `"identifier"`, `` `identifier` ``, or
`[identifier]` — and cannot be fooled by prose. The checker now imports it.

### 3.2 Two real defects the new tests caught

Writing tests for the scanner immediately failed on two of my own assumptions:

1. **Deleting a comment glued tokens together.** `1/* x */AS` became `1AS`.
   Fixed by emitting a single space where a comment is removed.
2. **`countParens` claimed to ignore strings and did not.** It stripped
   comments but still walked string contents, so `DEFAULT '(unclosed'` counted
   an extra `(`. Fixed with a `blankLiterals` mode that replaces literal
   contents with spaces while preserving newlines.

Both were found because the test asserted the property the function's own
docstring claimed. `tests/sql-strip.test.mjs` is 16 tests, including two that
read the real migration files and assert every declared `CREATE TABLE` survives
stripping — so this specific regression cannot return silently.

### 3.3 `.env` was not git-ignored — `.gitignore` did not exist

`.dev.vars`, `.local-state/` (the database file), `.wrangler/`, `dist/` and
`node_modules/` were all unprotected. Added `.gitignore` covering them, with
`.env` deliberately **not** ignored: it holds only `VITE_*` values, which Vite
inlines into the browser bundle and are public by definition. The rule that
matters is `.dev.vars`.

### 3.4 SPA deep links would have 404'd in production

`public/_redirects` was missing, so `dist/_redirects` was absent and the build
check failed. Created it, API rule first:

```
/api/*  /api/:splat  200
/*      /index.html  200
```

Order is load-bearing. Per Cloudflare's documentation, `_redirects` applies
only to *static asset* responses and the top-most matching rule wins. In the
intended deployment the Worker's `/api/*` zone route is evaluated before the
request reaches Pages, so the first rule never fires — it exists so that a
missing Worker binding produces a 404 on a JSON request rather than a `200`
containing HTML, which would surface as a confusing "not JSON" error in the
frontend instead of naming the real problem.

---

## 4. Architecture, in one page

| Layer | Where | Rule it enforces |
|---|---|---|
| Frontend | `src/` | Never computes money; renders what the server sent |
| API client | `src/lib/api/client.ts` | Single typed wrapper; holds the cart token |
| Catalogue | `src/lib/catalogue.tsx` | One source for every page; static fallback on failure |
| Worker | `worker/` | Routes → services → repositories |
| Services | `worker/services/` | All business logic; framework-free, unit-testable |
| Repositories | `worker/repositories/` | D1 access only; decides nothing |
| Local host | `scripts/serve-api.mjs` | Runs the same Worker on Node via the sql.js shim |
| Schema | `migrations/` | 6 numbered files, 19 tables, idempotent |

Three invariants worth not breaking:

1. **Money is integer minor units** plus explicit `currency` and `minor_unit`.
   No floats anywhere between price and receipt. Enforced by a migration check
   that greps for `REAL|FLOAT|NUMERIC|DECIMAL`.
2. **Nothing client-supplied is trusted for price.** Cart and checkout totals
   are recomputed from D1 on every request.
3. **`src/data/products.ts` is never a price source.** It survives only as an
   offline fallback and as editorial copy. `src/lib/catalogue.tsx` is the only
   place that reads the real catalogue.

---

## 5. Known behaviour that looks like a bug and is not

- **The purchase test sells the target piece out.** It commits real stock on
  purpose, because a test that does not commit writes is not testing the
  writes. To reset: **stop the API**, then `npm run db:reset`, then start it
  again. The reset refuses to run while the API is up, because the database
  lives in memory (sql.js) and is written back on close — deleting the file
  underneath a running host restores the catalogue you meant to delete, so the
  reset would appear to work and change nothing.
- **A stale listener can hold a port outside the shell's process table.** It
  answers `/api/health` perfectly while serving code from an earlier run. If
  something answers but does not appear in `ps`, move ports rather than fight
  it: `API_PORT=8799 npm run api:dev` and `API_PORT=8799 npm run dev`. Both
  processes read the same variable, so they cannot disagree.
- **Changing `.env` needs a dev-server restart.** Vite inlines `VITE_*` at
  build time.

---

## 6. Not done — and the app says so rather than pretending

- **No real payment provider.** `Checkout` returns `503 payment_unconfigured`
  until one is added. Only a development-only mock gateway exists, and it
  refuses to construct unless `ENVIRONMENT=development`. It signs its webhooks
  like a real provider, so signature verification is genuinely exercised rather
  than bypassed.
- **No email.** `EmailProvider` is an interface with a logging stub.
- **No production infrastructure.** No D1 database, R2 bucket or Worker exists
  in any account. `wrangler.toml` still carries `REPLACE_WITH_*` placeholders,
  which the build check reports as expected rather than as a failure.
- **No real tax determination.** Tax rules are configurable basis points. That
  is arithmetic, not legal tax compliance.
- **No browser has rendered this build for a human.** Every check is HTTP or
  type-level. Nobody has looked at it.
- **Migrations have never run against real SQLite.** `workerd` cannot execute
  in this sandbox, so the schema is verified statically. The SQL is the same;
  the concurrency semantics are not proven.

---

## 7. Files touched in this session

| File | Why |
|---|---|
| `scripts/lib/sql-strip.mjs` | New. Lexical comment stripper + paren counter |
| `tests/sql-strip.test.mjs` | New. 16 tests, including two against the real migrations |
| `scripts/check-migrations.mjs` | Uses the scanner instead of two regex passes |
| `.gitignore` | New. Protects `.dev.vars`, `.local-state/`, `.wrangler/`, `dist/` |
| `public/_redirects` | New. SPA fallback that does not swallow `/api/*` |
| `package.json` | `verify` now runs `build` itself |
| `docs/handover.md` | This file |

Deleted three temporary diagnostic scripts used to locate the stripping bug.
