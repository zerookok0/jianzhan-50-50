/**
 * STORE CONFIGURATION (frontend)
 * ------------------------------------------------------------------
 * VITE_STORE_MODE decides how much of the commerce stack is live:
 *
 *   'demo' — static catalogue only. No API calls, no cart, no checkout.
 *   'live' — full cart and checkout against the Worker API.
 *
 * There is no 'mock' mode any more: the mock backend was removed when the
 * real Worker API landed. Local development runs the actual Worker with
 * `npm run worker:dev`, which is more faithful than any fake.
 *
 * All VITE_* variables are PUBLIC — they are compiled into the browser
 * bundle. Never put a secret here.
 */

export type StoreMode = 'demo' | 'live'

const rawMode = (import.meta.env.VITE_STORE_MODE ?? 'demo').toLowerCase()
const mode: StoreMode = rawMode === 'live' ? 'live' : 'demo'

const envBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export interface StoreConfig {
  mode: StoreMode
  /** Worker origin. Empty = same origin (the production routing). */
  apiBaseUrl: string
  /** Display hint only; the server decides the real currency. */
  displayCurrency: string | null
}

export const store: StoreConfig = {
  mode,
  apiBaseUrl: envBase,
  displayCurrency: (import.meta.env.VITE_ALLOWED_CURRENCY ?? '').trim() || null,
}

/** Any commerce UI at all? */
export const storeEnabled = () => store.mode !== 'demo'

/** True when the storefront should hit the network. */
export const storeLive = () => store.mode === 'live'

/** Human-readable config problem, or null. */
export function storeConfigError(): string | null {
  if (store.mode !== 'live') return null
  // An empty base is valid: same-origin deployment is the default.
  return null
}

/** Absolute URL for an API path such as '/cart'. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${envBase}/api/v1${suffix}`
}

/** The origin requests come from, for diagnostics. */
export function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/** Absolute URL for a catalogue read, shown in diagnostics. */
export function storeUrl(path: string): string {
  return apiUrl(path)
}
