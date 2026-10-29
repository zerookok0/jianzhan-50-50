import { useMemo, useState } from 'react'
import type { Product } from '../../data/types'
import { resolvePurchaseUrl } from '../../lib/purchase'
import { useCart } from '../../lib/cart'
import { ArrowUpRight, Check, Info } from './Icons'

interface BuyButtonProps {
  product: Product
  variant?: 'solid' | 'outline' | 'link'
  block?: boolean
  label?: string
  /** Show size chips when the product has variants */
  showVariants?: boolean
  /** Show the quantity stepper (off inside compact contexts like Quick View) */
  showQty?: boolean
  onNavigate?: () => void
}

type Notice = 'none' | 'choose-size' | 'no-store-id' | 'no-variation' | 'added'

/**
 * Buying always ends on the WordPress / WooCommerce store.
 * This site has no payment, checkout or stock logic.
 *
 * "Add to cart" only works when the piece and (if it has sizes) the chosen
 * size carry a WooCommerce ID. Otherwise we say exactly what is missing
 * instead of silently doing nothing or inventing a link.
 */
export function BuyButton({
  product,
  variant = 'solid',
  block = true,
  label = 'Add to cart',
  showVariants = true,
  showQty = true,
  onNavigate,
}: BuyButtonProps) {
  const variants = product.variants ?? []
  const { addItem, openCart } = useCart()
  const [selected, setSelected] = useState<string | undefined>(
    variants.length === 1 ? variants[0].id : undefined,
  )
  const [qty, setQty] = useState(1)
  const [notice, setNotice] = useState<Notice>('none')

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selected),
    [variants, selected],
  )

  const availability = product.availability
  const archived = availability === 'sold-out'
  const backOrder = availability === 'made-to-order'
  const enquiry = availability === 'enquire'
  const hasVariants = variants.length > 0

  const storeUrl = resolvePurchaseUrl(product, selected)

  const handleAdd = () => {
    if (archived) return

    if (hasVariants && !selected) {
      setNotice('choose-size')
      return
    }

    const result = addItem(product, { variant: selectedVariant, qty })

    if (result === 'added') {
      setNotice('added')
      openCart()
      onNavigate?.()
      return
    }

    /* 'unavailable' is already handled by the archived/enquiry branch above. */
    if (result !== 'unavailable') setNotice(result)
  }

  const buttonClass =
    variant === 'solid' ? 'btn btn--solid' : variant === 'outline' ? 'btn btn--outline' : 'btn btn--link'

  const buttonLabel = archived
    ? 'Archived — not for sale'
    : hasVariants && !selected
      ? 'Choose a size'
      : backOrder
        ? 'Order via our store'
        : label

  const noticeText: Record<Exclude<Notice, 'none' | 'added'>, string> = {
    'choose-size': 'Select a size to continue.',
    'no-store-id':
      'This piece has no WooCommerce ID yet. Add `wooId` in src/data/products.ts to enable the cart.',
    'no-variation':
      'This size has no WooCommerce variation ID yet. Add `wooVariationId` in src/data/products.ts.',
  }

  /* Archive pieces and enquiries are not sold through the cart. */
  if (archived || enquiry) {
    return (
      <div className="buy">
        {showVariants && hasVariants && (
          <fieldset className="buy__variants">
            <legend className="buy__legend">Size</legend>
            <div className="chip-row">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`chip ${selected === v.id ? 'is-active' : ''}`}
                  aria-pressed={selected === v.id}
                  onClick={() => setSelected(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {enquiry ? (
          <a className={`${buttonClass} ${block ? 'btn--block' : ''}`} href="#enquiry">
            <span>Enquire about this piece</span>
            <ArrowUpRight width={14} height={14} />
          </a>
        ) : (
          <button type="button" className={`${buttonClass} ${block ? 'btn--block' : ''}`} disabled>
            <span>Archived — not for sale</span>
          </button>
        )}

        <p className="buy__note">
          {enquiry
            ? 'Back-order and archive pieces are arranged directly with the studio.'
            : 'This piece has been archived and is no longer available.'}
        </p>
      </div>
    )
  }

  return (
    <div className="buy">
      {showVariants && hasVariants && (
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
                {v.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className={`buy__actions ${showQty ? '' : 'buy__actions--compact'}`}>
        {showQty && (
          <div className="qty qty--lg">
            <button
              type="button"
              className="qty__btn"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              aria-label="Decrease quantity"
              disabled={qty <= 1}
            >
              <span aria-hidden="true">−</span>
            </button>
            <span className="qty__value" aria-live="polite" aria-label={`Quantity ${qty}`}>
              {qty}
            </span>
            <button
              type="button"
              className="qty__btn"
              onClick={() => setQty((n) => Math.min(99, n + 1))}
              aria-label="Increase quantity"
              disabled={qty >= 99}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={handleAdd}
          className={`${buttonClass} ${block ? 'btn--block' : ''} buy__add`}
          aria-describedby={notice !== 'none' && notice !== 'added' ? `buy-notice-${product.id}` : undefined}
        >
          <span>{notice === 'added' ? 'Added to cart' : buttonLabel}</span>
          {notice === 'added' ? <Check width={14} height={14} /> : <ArrowUpRight width={14} height={14} />}
        </button>
      </div>

      <p className="buy__note">
        Checkout, payment and shipping are completed on our WordPress store. Demo prices are
        illustrative, not live.
        {storeUrl && (
          <>
            {' '}
            <a
              className="buy__direct"
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Or buy this piece directly
            </a>
            .
          </>
        )}
      </p>

      {notice !== 'none' && notice !== 'added' && (
        <p className="buy__notice" id={`buy-notice-${product.id}`} role="status">
          <Info width={14} height={14} aria-hidden="true" />
          <span>{noticeText[notice]}</span>
        </p>
      )}
    </div>
  )
}
