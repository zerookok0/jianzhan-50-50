import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  addCartItem,
  applyCoupon as apiApplyCoupon,
  getCart,
  removeCartItem,
  removeCoupon as apiRemoveCoupon,
  updateCartItem,
  updateDestination,
  type ApiCart,
} from './api/client'
import { storeEnabled } from '../config/store'

/**
 * CART PROVIDER
 * ------------------------------------------------------------------
 * Holds the server's cart verbatim. There is no client-side price
 * arithmetic anywhere: every mutation replaces the whole `cart` object
 * with what the server returned.
 *
 * In `demo` mode this provider is inert — no network, no cart UI.
 */

export interface CartState {
  cart: ApiCart | null
  loading: boolean
  busyKey: string | null
  error: string | null
  couponError: string | null
  drawerOpen: boolean
  itemCount: number
  refresh: () => Promise<void>
  add: (input: { productId: string; variantId?: string | null; quantity?: number }) => Promise<boolean>
  setQuantity: (itemId: string, quantity: number) => Promise<void>
  remove: (itemId: string) => Promise<void>
  applyCoupon: (code: string) => Promise<boolean>
  removeCoupon: (code: string) => Promise<void>
  setDestination: (input: { country?: string; region?: string; postcode?: string; email?: string }) => Promise<void>
  openDrawer: () => void
  closeDrawer: () => void
  clearError: () => void
  clearCouponError: () => void
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const enabled = storeEnabled()

  const [cart, setCart] = useState<ApiCart | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const describe = (err: unknown): string =>
    err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const { cart: next } = await getCart()
      setCart(next)
      setError(null)
    } catch (err) {
      // An empty/expired session is not worth shouting about.
      if (err instanceof ApiError && err.status !== 0) setError(describe(err))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  const add = useCallback<CartState['add']>(
    async (input) => {
      if (!enabled) return false
      setBusyKey(input.productId)
      setError(null)
      try {
        const { cart: next } = await addCartItem(input)
        setCart(next)
        setDrawerOpen(true)
        return true
      } catch (err) {
        setError(describe(err))
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [enabled],
  )

  const setQuantity = useCallback<CartState['setQuantity']>(
    async (itemId, quantity) => {
      if (!enabled) return
      setBusyKey(itemId)
      setError(null)
      try {
        const { cart: next } =
          quantity <= 0 ? await removeCartItem(itemId) : await updateCartItem(itemId, quantity)
        setCart(next)
      } catch (err) {
        setError(describe(err))
      } finally {
        setBusyKey(null)
      }
    },
    [enabled],
  )

  const remove = useCallback<CartState['remove']>(
    async (itemId) => {
      if (!enabled) return
      setBusyKey(itemId)
      setError(null)
      try {
        const { cart: next } = await removeCartItem(itemId)
        setCart(next)
      } catch (err) {
        setError(describe(err))
      } finally {
        setBusyKey(null)
      }
    },
    [enabled],
  )

  const applyCoupon = useCallback<CartState['applyCoupon']>(
    async (code) => {
      if (!enabled) return false
      setCouponError(null)
      try {
        const { cart: next } = await apiApplyCoupon(code.trim())
        setCart(next)
        return true
      } catch (err) {
        setCouponError(describe(err))
        return false
      }
    },
    [enabled],
  )

  const removeCoupon = useCallback<CartState['removeCoupon']>(
    async (code) => {
      if (!enabled) return
      setCouponError(null)
      try {
        const { cart: next } = await apiRemoveCoupon(code)
        setCart(next)
      } catch (err) {
        setCouponError(describe(err))
      }
    },
    [enabled],
  )

  const setDestination = useCallback<CartState['setDestination']>(
    async (input) => {
      if (!enabled) return
      setError(null)
      try {
        const { cart: next } = await updateDestination(input)
        setCart(next)
      } catch (err) {
        setError(describe(err))
      }
    },
    [enabled],
  )

  const value = useMemo<CartState>(
    () => ({
      cart,
      loading,
      busyKey,
      error,
      couponError,
      drawerOpen,
      itemCount: cart?.itemCount ?? 0,
      refresh,
      add,
      setQuantity,
      remove,
      applyCoupon,
      removeCoupon,
      setDestination,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      clearError: () => setError(null),
      clearCouponError: () => setCouponError(null),
    }),
    [
      cart,
      loading,
      busyKey,
      error,
      couponError,
      drawerOpen,
      refresh,
      add,
      setQuantity,
      remove,
      applyCoupon,
      removeCoupon,
      setDestination,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

/** Inert fallback so components render outside a provider. */
function inertCart(): CartState {
  return {
    cart: null,
    loading: false,
    busyKey: null,
    error: null,
    couponError: null,
    drawerOpen: false,
    itemCount: 0,
    refresh: async () => {},
    add: async () => false,
    setQuantity: async () => {},
    remove: async () => {},
    applyCoupon: async () => false,
    removeCoupon: async () => {},
    setDestination: async () => {},
    openDrawer: () => {},
    closeDrawer: () => {},
    clearError: () => {},
    clearCouponError: () => {},
  }
}

export function useCart(): CartState {
  return useContext(CartContext) ?? inertCart()
}
