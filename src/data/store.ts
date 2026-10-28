/**
 * COMPATIBILITY SHIM
 * ------------------------------------------------------------------
 * Canonical config lives in `src/config/store.ts`, driven by
 * VITE_STORE_MODE / VITE_API_BASE_URL.
 *
 * Kept so existing imports resolve without a sweeping rename.
 */

export {
  store,
  storeEnabled,
  storeLive,
  storeConfigError,
} from '../config/store'

export type { StoreConfig, StoreMode } from '../config/store'
