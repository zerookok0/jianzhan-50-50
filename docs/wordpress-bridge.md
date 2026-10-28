# JianZhan Headless Bridge — design note

> **⚠️ SUPERSEDED — DO NOT IMPLEMENT**
>
> This project no longer uses WordPress or WooCommerce. The storefront now
> talks to a first-party API on Cloudflare Workers backed by D1 and R2.
> See `docs/deployment.md`.
>
> This document is retained only as a record of the earlier design, in case
> you need to migrate existing WooCommerce data. Nothing below applies to
> the current codebase: the frontend no longer contains any WooCommerce
> client.

---

An **optional** WordPress plugin. This document is a design specification,
not a claim that the plugin exists. Read the "Do you need it?" section
first: most stores do not.

---

## 1. Do you need this plugin?

**Probably not.** The WooCommerce Store API is public, unauthenticated and
handles cart, coupons, tax, shipping and orders already. The storefront in
this repo talks to it directly with no proxy.

You need a bridge only if you require server-side logic that cannot live
in the browser, for example:

- Sending a signed webhook to a fulfilment system when an order is paid.
- Whitelisting server-to-server calls from a Cloudflare Function.
- Exposing a read-only compatibility report that is safe to share publicly.

Do **not** build a bridge to:

- Proxy the cart. It adds latency and a second source of truth.
- Hold payment credentials. Those belong in the gateway plugin.
- Re-implement coupons, tax, shipping or orders. WooCommerce owns them.

**Rule of thumb:** if the browser can do it safely, the browser does it.

---

## 2. Scope

| Capability | In scope | Notes |
|---|---|---|
| Configurable allow-list of front-end origins | ✅ | Drives CORS headers |
| CORS + preflight handling for `wc/store/v1` | ✅ | Including `Cart-Token` exposure |
| Compatibility diagnostics endpoint | ✅ | Read-only, no secrets |
| Structured error codes + optional logging | ✅ | Logging off by default |
| Cart / coupon / order logic | ❌ | WooCommerce already provides it |
| Admin API proxy | ❌ | Explicitly forbidden |
| Payment key storage | ❌ | Belongs to the gateway plugin |

---

## 3. Settings

Options page under **WooCommerce → JianZhan Bridge**.

| Option | Type | Default | Purpose |
|---|---|---|---|
| `allowed_origins` | string[] | `[]` | Exact origins, no wildcards |
| `enable_diagnostics` | bool | `false` | Exposes the read-only report |
| `diagnostics_token` | string | `''` | Bearer token to read the report |
| `log_level` | enum | `off` | `off` / `error` / `debug` |
| `log_retention_days` | int | `7` | Auto-purge |

**Validation rules**

- An origin must be a scheme + host + optional port, no path, no trailing
  slash. Reject `*`, reject `null`, reject anything containing a newline.
- Persist with `update_option()`, never in a file that could be versioned.
- Deny by default: an empty allow-list permits nothing.

---

## 4. CORS

WooCommerce sends its own CORS headers based on `Access-Control-Allow-Origin`
derived from the request origin. That default is permissive and echoes the
caller, which is not what we want in production.

```php
/**
 * Replace WooCommerce's default CORS handling with an explicit allow-list.
 * Runs late so it wins over the default filter.
 */
add_action( 'rest_api_init', function () {
    remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

    add_filter( 'rest_pre_serve_request', function ( $served ) {
        $origin  = get_http_origin();
        $allowed = (array) get_option( 'jz_bridge_allowed_origins', array() );

        if ( ! $origin || ! in_array( $origin, $allowed, true ) ) {
            // No CORS headers: the browser blocks the response. That is
            // the correct, safe outcome for an unknown origin.
            return $served;
        }

        header( 'Access-Control-Allow-Origin: ' . esc_url_raw( $origin ) );
        header( 'Vary: Origin', false );
        header( 'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS' );
        header( 'Access-Control-Allow-Headers: Content-Type, Cart-Token, Nonce, Authorization' );

        // CRITICAL: without this the browser hides the session token and
        // every request begins a new, empty cart.
        header( 'Access-Control-Expose-Headers: Cart-Token, Nonce' );

        if ( 'OPTIONS' === $_SERVER['REQUEST_METHOD'] ) {
            status_header( 204 );
            exit;
        }

        return $served;
    } );
}, 20 );
```

**Preflight.** `OPTIONS` must return `204` with the headers above and no
body. If a proxy strips them, checkout fails with an opaque network error.

**Never** reflect the origin unconditionally. `Access-Control-Allow-Origin: *`
combined with credentials is rejected by browsers and would also let any
site read the shopper's cart.

---

## 5. Diagnostics endpoint

`GET /wp-json/jianzhan-bridge/v1/diagnostics`

Requires `Authorization: Bearer <diagnostics_token>`. Returns **no**
secrets — only booleans, versions and capability flags.

```json
{
  "plugin_version": "1.0.0",
  "wordpress": "6.7.1",
  "woocommerce": "9.5.1",
  "php": "8.2.27",
  "rest_api_reachable": true,
  "store_api_namespace_present": true,
  "cors": {
    "allowed_origins_configured": 2,
    "cart_token_exposed": true
  },
  "cart_token_mode": "header",
  "https": true,
  "payment_gateways": [
    { "id": "stripe", "enabled": true, "store_api_support": "unverified" }
  ],
  "warnings": [
    "Gateway 'stripe' compatibility with the Store API has not been verified."
  ]
}
```

Deliberately absent: consumer keys, webhook secrets, customer data, order
contents, full gateway settings.

### Why `store_api_support: "unverified"`

WooCommerce does not expose a reliable machine-readable flag for "this
gateway works with the Store API". Options are:

1. Read the gateway's own settings for a Blocks/Store API toggle, if any.
2. Treat anything unknown as `"unverified"` and tell the operator to test.

Reporting `true` because the gateway *exists* would be a lie that surfaces
later as a broken checkout.

---

## 6. Security principles

1. **Least privilege.** No admin endpoints. No capability above `manage_options` and none exposed over HTTP.
2. **Deny by default.** Empty allow-list, diagnostics disabled, logging off.
3. **No secrets over the wire.** The diagnostics token is compared with `hash_equals()`.
4. **No PII in logs.** Log order IDs and error codes, never addresses or emails.
5. **No payment credentials in code.** Keys stay in the gateway plugin.
6. **Idempotent diagnostics.** Read-only; safe to re-run.
7. **Never a proxy.** The browser talks to `wc/store/v1` directly.

---

## 7. Error format

All bridge responses use one envelope so the front end can branch safely:

```json
{
  "code": "jz_bridge_origin_denied",
  "message": "Origin not in the allow-list.",
  "data": { "status": 403, "origin": "https://evil.example" }
}
```

Suggested codes:

| Code | HTTP | Meaning |
|---|---|---|
| `jz_bridge_origin_denied` | 403 | Origin not allow-listed |
| `jz_bridge_diagnostics_disabled` | 404 | Endpoint turned off |
| `jz_bridge_token_invalid` | 401 | Bad diagnostics token |
| `jz_bridge_store_api_missing` | 500 | WooCommerce inactive or too old |
| `jz_bridge_gateway_unverified` | 200 | Warning only, not an error |

---

## 8. Installation sketch

```
wp-content/plugins/jianzhan-headless-bridge/
├── jianzhan-headless-bridge.php   # bootstrap, constants, hooks
├── includes/
│   ├── class-cors.php             # allow-list + header emission
│   ├── class-diagnostics.php      # read-only report
│   └── class-settings.php         # options page, sanitisation
└── readme.txt
```

`readme.txt` must state: tested WooCommerce version, that it exposes no
admin proxy, and that it stores no credentials.

---

## 9. What this repo does instead

Until a bridge exists, the front end:

- Calls `wc/store/v1` directly.
- Detects CORS failure and shows an actionable message rather than a
  blank screen (see `StoreApiError.kind === 'network'`).
- Falls back to the WordPress checkout page for payment.
- Ships a diagnostics page (`/diagnostics`) that probes the store from the
  browser and reports exactly what a bridge would otherwise report — with
  no server code at all.
