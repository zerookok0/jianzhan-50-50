import { useEffect, useState } from 'react'
import type { CatalogueProduct } from '../../lib/catalogue'
import { formatMinor } from '../../lib/api/client'
import { useCart } from '../../lib/cart'
import { storeEnabled } from '../../config/store'
import { AppLink } from './Media'
import { Bag, Info } from './Icons'

/**
 * BUY BUTTON
 * ------------------------------------------------------------------
 * The boundary between the catalogue and the real store.
 *
 * Three honest states, and no fourth:
 *
 *   1. live        — the cart is real, priced by the server. Adding sends
 *                    only a product id, an optional variant id and a
 *                    quantity; the server decides price, stock, currency.
 *   2. unavailable — sold out or enquiry-only. Disabled with the reason,
 *                    not hidden, so the piece still appears in the record.
 *   3. demo        — no store connected at all. Said plainly, never
 *                    dressed up as a purchase.
 *
 * Note what this component does NOT do: it never reads a price from the
 * static lookbook. Every figure comes from the catalogue record, which in
 * live mode came from the API in minor units.
 */

interface BuyButtonProps {
  product: CatalogueProduct
  /** Shown instead of "Add to cart" for archived pieces. */
  label?: string
}

export function BuyButton({ product, label }: BuyButtonProps) {
  const { add, busyKey, error: cartError } = useCart()
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Preselect the first option that can actually be bought. Defaulting to
   * variants[0] alone meant a page could open with a sold-out size chosen
   * and the buy button disabled for no visible reason.
   */
  const firstBuyable = product.variants.find((v) => v.inStock) ?? product.variants[0]
  const [selectedVariant, setSelectedVariant] = useState<string | null>(
    firstBuyable?.id ?? null,
  )

  useEffect(() => {
    setSelectedVariant((current) => {
      if (current && product.variants.some((v) => v.id === current)) return current
      return product.variants.find((v) => v.inStock)?.id ?? product.variants[0]?.id ?? null
    })
    setNotice(null)
  }, [product.id, product.variants])

  const busy = busyKey === product.id
  const needsChoice = product.variants.length > 0
  const selected = product.variants.find((v) => v.id === selectedVariant)
  const price = selected?.price ?? product.price

  /* ---- No store connected at all ---- */

  if (!storeEnabled()) {
    return (
      <div className="buy">
        <p className="buy__notice">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            This build is running in catalogue mode, so purchasing is switched off. Set{' '}
            <code>VITE_STORE_MODE=live</code> and reload to enable the cart.
          </span>
        </p>
        <AppLink href="/collection" className="btn btn--outline">
          Back to the collection
        </AppLink>
      </div>
    )
  }

  /* ---- Not purchasable ---- */

  const unavailable =
    product.availability === 'sold-out' ||
    product.availability === 'enquire' ||
    (!product.inStock && !selected?.inStock)

  if (unavailable) {
    const soldOut = product.availability === 'sold-out' || product.available === 0
    return (
      <div className="buy">
        <button type="button" className="btn btn--solid btn--block" disabled>
          {label ?? (product.availability === 'enquire' ? 'Enquire about this piece' : 'Sold out')}
        </button>
        <p className="buy__note">
          {product.availability === 'enquire'
            ? 'This piece is available by enquiry rather than direct purchase. Please contact the studio.'
            : soldOut
              ? 'This piece has been sold. Each firing produces one object, so it cannot be remade exactly.'
              : 'This option is currently unavailable. Choose another size, or check back after the next firing.'}
        </p>
      </div>
    )
  }

  /* ---- Live cart ---- */

  const handleAdd = async () => {
    setNotice(null)

    if (needsChoice && !selectedVariant) {
      setNotice('Choose an option before adding this piece.')
      return
    }

    const ok = await add({
      productId: product.id,
      variantId: selectedVariant,
      quantity: 1,
    })

    if (!ok) {
      // The cart provider records the server's own reason; surface it here
      // rather than in a toast the customer may not connect to this button.
      setNotice(
        cartError ??
          'This piece could not be added. It may have sold out since this page loaded.',
      )
    }
  }

  return (
    <div className="buy">
      {/* Made-to-order is purchasable, but the lead time must be stated
          before payment — not discovered afterwards. */}
      {product.availability === 'made-to-order' && (
        <p className="buy__notice">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            Made to order after payment. This piece is thrown and fired for you, so allow a few
            weeks before dispatch.
          </span>
        </p>
      )}

      {needsChoice && (
        <fieldset className="buy__variants">
          <legend className="buy__legend">{product.variants[0]?.optionName || 'Option'}</legend>
          <div className="chip-row">
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`chip ${selectedVariant === v.id ? 'is-active' : ''} ${
                  v.inStock ? '' : 'is-disabled'
                }`}
                aria-pressed={selectedVariant === v.id}
                aria-label={
                  v.inStock ? v.label : `${v.label} — sold out`
                }
                disabled={!v.inStock}
                onClick={() => {
                  setSelectedVariant(v.id)
                  setNotice(null)
                }}
              >
                {v.optionValue || v.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <button
        type="button"
        className="btn btn--solid btn--block"
        onClick={() => void handleAdd()}
        disabled={busy}
      >
        {busy
          ? 'Adding…'
          : `${label ?? 'Add to cart'} — ${formatMinor(price, product.currency, product.minorUnit)}`}
        {!busy && <Bag width={15} height={15} aria-hidden="true" />}
      </button>

      {notice && (
        <p className="buy__notice" role="alert">
          <Info width={14} height={14} aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}

      <p className="buy__note">
        {product.inStock && product.available !== null && product.available <= 2
          ? `Only ${product.available} left from this firing. `
          : ''}
        Stock and price are confirmed by the store when the item is added, and again at checkout.
      </p>
    </div>
  )
}
