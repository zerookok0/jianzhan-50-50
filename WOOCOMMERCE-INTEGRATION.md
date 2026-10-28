# WooCommerce Integration Guide

This site is a **storefront**, not a payment processor. Card data never
touches this codebase. Here is exactly what to do on each side.

---

## Architecture (read this first)

```
Browser (this site)                WordPress + WooCommerce
──────────────────                 ───────────────────────
Add to cart  ──Store API──▶  Cart session (Cart-Token)
Checkout form ────────────▶  Order created (pending payment)
                              │
                              ▼
                              Payment gateway returns redirect_url
                              │
Browser  ◀────────────────────┘
   │
   └──▶ Stripe / PayPal hosted page  ← card details typed HERE, not here
```

**The Store API is public.** It needs no consumer key. That is deliberate:
it is the same interface WooCommerce Blocks uses in a browser.

**Never** put a `ck_`/`cs_` consumer key in `src/`. Anything in `src/` is
shipped to the browser and can be read by anyone.

---

## 1. WordPress side

### Install the payment plugins

1. **WooCommerce** (core)
2. **WooCommerce Stripe Payment Gateway** — for cards, Apple Pay, Google Pay
3. **PayPal Payments** — if you want PayPal
4. Optionally a tax plugin, and a shipping plugin if rates are complex

Configure them under **WooCommerce → Settings → Payments**.

### Enable the Store API over CORS

Browsers block cross-origin requests unless WordPress allows them. Add to
your theme's `functions.php` (or a small mu-plugin):

```php
add_action( 'rest_api_init', function () {
    remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

    add_filter( 'rest_pre_serve_request', function ( $value ) {
        $origin = get_http_origin();

        // List every origin that may read the store.
        $allowed = array(
            'https://www.jianzhan.com',   // production
            'https://jianzhan.pages.dev', // Cloudflare preview
            'http://localhost:5173',      // local dev
        );

        if ( $origin && in_array( $origin, $allowed, true ) ) {
            header( 'Access-Control-Allow-Origin: ' . $origin );
            header( 'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS' );
            header( 'Access-Control-Allow-Headers: Content-Type, Cart-Token, Nonce, Authorization' );
            header( 'Access-Control-Expose-Headers: Cart-Token, Nonce' );
            header( 'Access-Control-Allow-Credentials: true' );
        }

        return $value;
    });
});
```

**`Access-Control-Expose-Headers: Cart-Token` is not optional.** Without it
the browser hides the session token and every request starts a new cart.

### Serve over HTTPS

Payment requires HTTPS. `http://` will fail, and mixed content will be
blocked outright.

### Nothing else

Do **not** create an application password. Do **not** generate REST API
keys for this integration.

---

## 2. This site

### `src/data/store.ts`

```ts
export const store: StoreConfig = {
  enabled: true,                        // ← flip this
  apiBase: 'https://shop.jianzhan.com', // ← your WordPress origin, no trailing slash
  ...
}
```

Do not include `/wp-json` in `apiBase` — the client adds it.

### `src/data/products.ts`

Map each piece to its WooCommerce product ID:

```ts
{
  id: 'jz-01',
  name: 'Midnight Oil Spot',
  wooId: 1234,            // ← WooCommerce product ID
  ...
}
```

Find the ID in **WooCommerce → Products** (row action shows `ID: 1234`) or
in the edit URL (`post.php?post=1234`).

For a **variable** product, also set per-size variation IDs:

```ts
variants: [
  { id: 'jz-03-a', label: 'Small — 12.6 cm', purchaseUrl: null, wooVariationId: 1235 },
  { id: 'jz-03-b', label: 'Large — 14.2 cm', purchaseUrl: null, wooVariationId: 1236 },
],
```

**The variation attribute name must match your store.** The client sends
`{ attribute: 'Size', value: 'Large' }`. If your store uses `pa_size` or a
different label, change `buildVariation()` in
`src/components/ui/BuyButton.tsx`.

A piece left with `wooId: null` still displays, but its button says it is
not linked yet rather than failing at payment.

---

## 3. What was built

| File | Purpose |
|---|---|
| `src/data/store.ts` | Master switch + store origin. No secrets. |
| `src/lib/woo.ts` | Store API client. `Cart-Token` session, typed errors. |
| `src/lib/cart.tsx` | Cart state, add/update/remove, coupons. |
| `src/components/layout/CartDrawer.tsx` | Slide-over cart, focus trap, qty stepper. |
| `src/pages/Checkout.tsx` | Address form, gateway list, order creation, redirect. |
| `src/components/ui/BuyButton.tsx` | Dual mode: add-to-cart, or deep-link fallback. |
| `src/styles/commerce.css` | All commerce styling. |

### Behaviour when `enabled: false`

The site is byte-for-byte the lookbook it was: no cart icon, no drawer, no
network calls, purchase buttons deep-link to WordPress. That means this
integration cannot break the site you already approved.

---

## 4. Known limits — read before launch

**1. Payment data formats differ per gateway.**
The Store API docs state plainly that each gateway expects its own
`payment_data` shape and that they cannot enumerate them. This build sends
an empty `payment_data` array, which works for **redirect-based** flows
(Stripe Checkout redirect, PayPal, 3-D Secure). Gateways that need inline
tokenisation (e.g. Stripe Elements embedded on *this* domain) require extra
work and a PCI review. **If checkout fails at the gateway, use the
"WordPress checkout" fallback link** that the UI always provides.

**2. This is a guest-cart flow.**
The `Cart-Token` session is per-browser. Clearing site data loses the cart.
There is no cross-device sync, same as favourites.

**3. Prices shown on cards come from `products.ts`, not the live store.**
Card and product-page prices are editorial copy. Only the cart, checkout
and summary show real WooCommerce totals. If those drift, customers see
two numbers. **Update `products.ts` prices when store prices change**, or
add a `GET /products` fetch to reconcile them (a reasonable next step).

**4. Stock is not enforced on the catalogue.**
A sold-out piece is hidden from add-to-cart only via `availability:
'sold-out'`. Real stock lives in WooCommerce and is validated there at
add-to-cart time.

**5. No order confirmation page of our own.**
After payment the customer lands on WordPress's `order-received` page.
Building an in-site confirmation requires a server-side order lookup with
the order key — a sensible future addition.

---

## 5. Testing checklist

Before going live, with `enabled: true` and Stripe in **test mode**:

- [ ] Add each product to cart; confirm the real price appears in the drawer
- [ ] Reload mid-cart; confirm the cart survives (Cart-Token persistence)
- [ ] Increase/decrease quantity; remove a line
- [ ] Apply a coupon code created in WooCommerce
- [ ] Checkout with a Stripe test card `4242 4242 4242 4242`
- [ ] Confirm the order appears in **WooCommerce → Orders**
- [ ] Test a 3-D Secure card `4000 0025 0000 3155`
- [ ] Test a declining card `4000 0000 0000 0002` — error must show, not a crash
- [ ] Open the site on a phone; confirm the drawer is usable one-handed
- [ ] Keyboard only: Tab through the cart, Escape to close, focus returns
- [ ] Confirm no `ck_`/`cs_` string appears anywhere in `dist/`

That last one is worth running literally:

```bash
npx vite build && node -e "
  const fs=require('fs'),p='dist/assets';
  for (const f of fs.readdirSync(p)) {
    const s=fs.readFileSync(p+'/'+f,'utf8');
    if (/ck_[a-f0-9]{20,}|cs_[a-f0-9]{20,}/.test(s)) {
      console.error('SECRET LEAKED IN', f); process.exit(1);
    }
  }
  console.log('No API keys found in build output.');
"
```
