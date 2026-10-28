import { useState } from 'react'
import type { Product } from '../../data/types'
import { useCart } from '../../lib/cart'
import { storeEnabled } from '../../config/store'
import { ArrowUpRight, Info } from './Icons'

interface BuyButtonProps {
  product: Product
  variant?: 'solid' | 'outline' | 'link'
  block?: boolean
  label?: string
  /** Show size chips when the product has variants */
  showVariants?: boolean
  onNavigate?: () => void
}

type Notice = 'none' | 'choose-size'

/**
 * BUY BUTTON
 * ------------------------------------------------------------------
 * Two modes, chosen by config, never by guesswork:
 *
 *   live  → adds to the real server cart. Prices and stock are decided
 *           by the API; nothing is computed here.
 *   demo  → the site is a lookbook. The button explains that ordering is
 *           not open and does not pretend to add anything.
 *
 * A product with no catalogue id cannot be added, and says so.
 */
export function BuyButton({
  product,
  variant = 'solid',
  block = true,
  label,
  showVariants = true,
  onNavigate,
}: BuyButtonProps) {
  const variants = product.variants ?? []
  const [selected, setSelected] = useState<string | undefined>(
    variants.length === 1 ? variants[0].id : undefined,
  )
  const [notice, setNotice] = useState<Notice>('none')

  const { add, busyKey, error, clearError } = useCart()
  const live = storeEnabled()

  const needsVariant = variants.length > 0 && !selected
  const availability = product.availability
  const archived = availability === 'sold-out'
  const enquiry = availability === 'enquire'
  const backOrder = availability === 'made-to-order'
  const busy = busyKey === product.id

  const selectedVariant = variants.find((v) => v.id === selected)
  const hasCatalogueId = Boolean(product.id)

  const handleAdd = async () => {
    if (needsVariant) {
      setNotice('choose-size')
      return
    }
    setNotice('none')
    clearError()

    const ok = await add({
      productId: product.id,
      variantId: selectedVariant?.id ?? null,
      quantity: 1,
    })
    if (ok) onNavigate?.()
  }

  const buttonClass =
    variant === 'solid'
      ? 'btn btn--solid'
      : variant === 'outline'
        ? 'btn btn--outline'
        : 'btn btn--link'

  const buttonLabel = archived
    ? 'Archived — not for sale'
    : enquiry
      ? 'Enquire about this piece'
      : needsVariant
        ? 'Choose a size'
        : busy
          ? 'Adding…'
          : !hasCatalogueId
            ? 'Not available to order'
            : backOrder
              ? 'Add to cart — made to order'
              : (label ?? 'Add to cart')

  const disabled = archived || busy || !live || !hasCatalogueId

  return (
    <div className="buy">
      {showVariants && variants.length > 0 && (
        <fieldset className="buy__variants">
          <legend className="buy__legend">Size</legend>
          <div className="chip-row">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`chip ${selected === v.id ? 'is-active' : ''}`}
                aria-pressed={selected === v.id}
                onClick={() => {
                  setSelected(v.id)
                  setNotice('none')
                }}
              >
                {v.optionValue || v.id}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {enquiry ? (
        <a className={`${buttonClass} ${block ? 'btn--block' : ''}`} href="#enquiry">
          <span>{buttonLabel}</span>
          <ArrowUpRight width={14} height={14} />
        </a>
      ) : (
        <button
          type="button"
          onClick={() => void handleAdd()}
          className={`${buttonClass} ${block ? 'btn--block' : ''}`}
          disabled={disabled}
          aria-busy={busy}
          aria-describedby={notice !== 'none' ? `buy-notice-${product.id}` : undefined}
        >
          <span>{buttonLabel}</span>
          {!archived && <ArrowUpRight width={14} height={14} />}
        </button>
      )}

      <p className="buy__note">
        {enquiry
          ? 'Back-order and archive pieces are arranged directly with the studio.'
          : live
            ? 'Payment is handled securely by our payment provider.'
            : 'Ordering is not open on this site yet.'}
      </p>

      {live && error && (
        <p className="buy__notice" role="alert">
          <Info width={14} height={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {notice === 'choose-size' && (
        <p className="buy__notice" id={`buy-notice-${product.id}`} role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>Select a size to continue.</span>
        </p>
      )}

      {live && !hasCatalogueId && !archived && !enquiry && (
        <p className="buy__notice" role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>This piece is not linked to the store catalogue yet.</span>
        </p>
      )}

      {!live && !archived && !enquiry && (
        <p className="buy__notice" role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>
            This site is showing the collection catalogue. Online ordering opens once the store is
            connected.
          </span>
        </p>
      )}
    </div>
  )
}
