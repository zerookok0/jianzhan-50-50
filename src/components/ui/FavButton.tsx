import { useFavourites } from '../../lib/hooks'
import { Heart } from './Icons'

interface FavButtonProps {
  productId: string
  productName: string
  variant?: 'icon' | 'labelled'
  className?: string
}

/**
 * Favourites are stored in this browser only (localStorage).
 * The label says so explicitly — no cross-device sync is implied.
 */
export function FavButton({ productId, productName, variant = 'icon', className = '' }: FavButtonProps) {
  const { isFavourite, toggle } = useFavourites()
  const active = isFavourite(productId)

  return (
    <button
      type="button"
      className={`fav-btn fav-btn--${variant} ${active ? 'is-active' : ''} ${className}`}
      aria-pressed={active}
      aria-label={
        active ? `Remove ${productName} from saved pieces` : `Save ${productName} to saved pieces`
      }
      title={active ? 'Saved in this browser' : 'Save in this browser'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle(productId)
      }}
    >
      <Heart filled={active} width={15} height={15} />
      {variant === 'labelled' && <span>{active ? 'Saved' : 'Save'}</span>}
    </button>
  )
}
