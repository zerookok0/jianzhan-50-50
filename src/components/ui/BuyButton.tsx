import { useEffect, useState } from 'react'
import { useCart } from '../../lib/cart'
import { formatMinor, errorLabel } from '../../lib/api/client'
import { storeEnabled } from '../../config/store'
import type { CatalogueProduct } from '../../lib/catalogue'
import { Info } from './Icons'

interface BuyButtonProps {
  product: CatalogueProduct
  /** Compact variant for the quick-view panel. */
  compact?: boolean
}

/**
 * BUY BUTTON
 * ------------------------------------------------------------------
 * The only place a purchase starts.
 *
 * What it does NOT do: compute a price, decide availability, or assume
 * anything about stock. It sends a product id and a quantity, and renders
 * whatever the server returns. If the server says the piece is gone, the
 * button says so and stops.
 *
 * Two states deserve their own copy, because collapsing them into one
 * loses information the customer needs:
 *   • sold-out      — cannot be bought at all
 *   • made-to-order — CAN be bought, but is made after the order
 */
export function BuyButton({ product, compact = false }: BuyButtonProps) {
  const { add, busyKey, error, clearError, cart } = useCart()
  const enabled = storeEnabled()

  const buyable = product.variants.filter((v) => v.inStock)
  const hasVariants = product.variants.length > 0

  /**
   * Default to the first option that can actually be bought. Selecting a
   * sold-out size by default was the reason a customer could press "add"
   * on a piece the page had just labelled unavailable.
   */
  const [selected, setSelected] = useState<string | null>(
    hasVariants ? (buyable[0]?.id ?? product.variants[0].id) : null,
  )

  // A different product means a different option set.
  useEffect(() => {
    setSelected(hasVariants ? (buyable[0]?.id ?? product.variants[0].id) : null)
    clearError()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  const busy = busyKey === product.id
  const variant = hasVariants ? product.variants.find((v) => v.id === selected) : undefined

  /* ---- Not connected ---- */
  if (!enabled) {
    return (
      <div className="buy">
        <p className="buy__notice" role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            This build runs as a catalogue. Publishing is switched off, so pieces cannot be bought
            here.
          </span>
        </p>
      </div>
    )
  }

  /* ---- Cannot be bought ---- */
  if (product.availability === 'sold-out') {
    return (
      <div className="buy">
        <p className="buy__notice" role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            This piece has sold. Every firing is different, so it will not be repeated exactly —
            browse the collection for what is currently available.
          </span>
        </p>
      </div>
    )
  }

  if (product.availability === 'enquire') {
    return (
      <div className="buy">
        <p className="buy__notice" role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            This piece is offered by enquiry rather than direct purchase. Contact the studio and we
            will discuss availability and shipping.
          </span>
        </p>
      </div>
    )
  }

  /* ---- Everything else can be bought ---- */
  const unitPrice = variant ? variant.price : product.price
  const inCart = cart?.items.find(
    (i) => i.productId === product.id && (i.variantId ?? null) === (variant?.id ?? null),
  )
  const atLimit =
    variant?.available !== null &&
    variant?.available !== undefined &&
    (inCart?.quantity ?? 0) >= variant.available

  const disabled = busy || (hasVariants && variant ? !variant.inStock : false) || atLimit

  return (
    <div className="buy">
      {hasVariants && (
        <fieldset className="buy__variants">
          <legend className="buy__legend">
            {product.variants[0]?.optionName ?? 'Option'}
          </legend>

          <div className="chip-row">
            {product.variants.map((v) => {
              const isSelected = v.id === selected
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`chip ${isSelected ? 'is-active' : ''} ${
                    v.inStock ? '' : 'is-disabled'
                  }`}
                  aria-pressed={isSelected}
                  disabled={!v.inStock}
                  onClick={() => {
                    setSelected(v.id)
                    clearError()
                  }}
                  title={v.inStock ? undefined : 'This option has sold out'}
                >
                  {v.label}
                  {!v.inStock && <span className="sr-only"> — sold out</span>}
                </button>
              )
            })}
          </div>

          {/* A sold-out option stays visible but unexplainable would be a
              dead end, so say why it cannot be chosen. */}
          {variant && !variant.inStock && (
            <p className="buy__note">That option has sold out. Choose another size.</p>
          )}
        </fieldset>
      )}

      <div className="cart-line__actions" style={{ marginTop: 0 }}>
        <p className="product-info__price" style={{ fontSize: 17 }}>
          {formatMinor(unitPrice, product.currency, product.minorUnit)}
        </p>

        {atLimit && (
          <p className="buy__note" style={{ margin: 0 }}>
            All available units are in your cart.
          </p>
        )}
      </div>

      <button
        type="button"
        className="btn btn--solid btn--block"
        disabled={disabled}
        aria-busy={busy}
        onClick={async () => {
          clearError()
          await add({
            productId: product.id,
            variantId: variant?.id ?? null,
            quantity: 1,
          })
        }}
      >
        {busy ? 'Adding…' : atLimit ? 'In your cart' : 'Add to cart'}
      </button>

      {product.availability === 'made-to-order' && (
        <p className="buy__note">
          Made to order. This piece is thrown after the order is placed, so allow a few weeks
          before dispatch. Your card is charged when the order is confirmed.
        </p>
      )}

      {error && (
        <p className="checkout-alert" role="alert">
          {errorLabel(error)}
        </p>
      )}

      {!compact && (
        <p className="buy__note">
          Stock and price are confirmed by our store when you add the piece. Nothing is charged
          until checkout.
        </p>
      )}
    </div>
  )
}

export default BuyButton
