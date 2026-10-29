import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { img } from '../data/images'
import type { Product, Variant } from '../data/types'

/**
 * CART
 * ------------------------------------------------------------------
 * A presentation-only cart. It holds a shopping list in this browser
 * (localStorage) and nothing else: no prices are authoritative, no stock
 * is checked, no order is created. The store does all of that.
 *
 * A line is keyed by wooId + variationId so the same piece in two sizes
 * stays as two lines, while repeat adds merge into one.
 */

export interface CartLine {
  key: string
  productId: string
  wooId: number
  variationId?: number
  variantLabel?: string
  name: string
  slug: string
  price: number
  currency: string
  image: string
  qty: number
}

export type AddItemResult = 'added' | 'no-store-id' | 'no-variation' | 'unavailable'

interface CartContextValue {
  lines: CartLine[]
  isOpen: boolean
  count: number
  subtotal: number
  currency: string
  openCart: () => void
  closeCart: () => void
  addItem: (product: Product, options?: { variant?: Variant; qty?: number }) => AddItemResult
  setQty: (key: string, qty: number) => void
  removeItem: (key: string) => void
  clear: () => void
}

const STORAGE_KEY = 'jianzhan.cart.v1'
const MAX_QTY = 99

const CartContext = createContext<CartContextValue | null>(null)

function clampQty(qty: number): number {
  const n = Math.floor(Number(qty))
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_QTY, Math.max(1, n))
}

/** Stored data can be stale or hand-edited, so every line is re-checked. */
function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false
  const line = value as Partial<CartLine>
  return (
    typeof line.key === 'string' &&
    typeof line.productId === 'string' &&
    Number.isInteger(line.wooId) &&
    typeof line.name === 'string' &&
    typeof line.slug === 'string' &&
    typeof line.price === 'number' &&
    typeof line.image === 'string' &&
    Number.isInteger(line.qty) &&
    (line.qty ?? 0) > 0
  )
}

function readStoredLines(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isCartLine) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() =>
    typeof window === 'undefined' ? [] : readStoredLines(),
  )
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      /* storage may be unavailable (private mode) — the session still works */
    }
  }, [lines])

  /* Another tab added or removed something: keep this one honest. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLines(readStoredLines())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const openCart = useCallback(() => setIsOpen(true), [])
  const closeCart = useCallback(() => setIsOpen(false), [])

  const addItem = useCallback<CartContextValue['addItem']>((product, options = {}) => {
    const { variant, qty = 1 } = options

    if (product.availability === 'sold-out' || product.availability === 'enquire') return 'unavailable'
    if (!product.wooId) return 'no-store-id'
    if (variant && !variant.wooVariationId) return 'no-variation'

    const wooId = product.wooId
    const variationId = variant?.wooVariationId
    const key = `${wooId}:${variationId ?? 0}`
    const amount = clampQty(qty)

    setLines((current) => {
      const existing = current.some((line) => line.key === key)
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, qty: clampQty(line.qty + amount) } : line,
        )
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          wooId,
          variationId,
          variantLabel: variant?.label,
          name: product.name,
          slug: product.slug,
          price: product.price,
          currency: product.currency,
          image: img(product.images[0], 480),
          qty: amount,
        },
      ]
    })

    return 'added'
  }, [])

  const setQty = useCallback((key: string, qty: number) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, qty: clampQty(qty) } : line)),
    )
  }, [])

  const removeItem = useCallback((key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((total, line) => total + line.qty, 0)
    const subtotal = lines.reduce((total, line) => total + line.price * line.qty, 0)
    return {
      lines,
      isOpen,
      count,
      subtotal,
      currency: lines[0]?.currency ?? 'USD',
      openCart,
      closeCart,
      addItem,
      setQty,
      removeItem,
      clear,
    }
  }, [lines, isOpen, addItem, clear, closeCart, openCart, removeItem, setQty])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used inside CartProvider')
  return context
}
