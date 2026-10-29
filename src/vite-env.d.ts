/// <reference types="vite/client" />

/**
 * Environment variables. All VITE_* values are PUBLIC — they are inlined
 * into the client bundle at build time. Never place a secret here.
 */
interface ImportMetaEnv {
  /** 'demo' | 'mock' | 'live' */
  readonly VITE_STORE_MODE?: string
  /** WordPress origin, e.g. https://shop.example.com */
  readonly VITE_WC_STORE_URL?: string
  /** Display hint only — the server decides the real checkout currency. */
  readonly VITE_ALLOWED_CURRENCY?: string
  /** Store API request timeout in ms. */
  readonly VITE_API_TIMEOUT_MS?: string
  /** Products fetched per page. */
  readonly VITE_PRODUCTS_PER_PAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
