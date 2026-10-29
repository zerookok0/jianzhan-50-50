/**
 * WORDPRESS / WOOCOMMERCE CHECKOUT HANDOFF
 * ------------------------------------------------------------------
 * This site never processes payments, addresses or order state.
 * It only builds a tiny cart payload and hands it to the store, which
 * owns everything from there on.
 *
 * URL shape:
 *   https://store.example/?bolt_cart=2472:1,2465:2:331
 *                                    ^id   ^qty ^variationId (optional)
 *
 * The WordPress side reads `bolt_cart` and fills the WooCommerce cart
 * before redirecting to /checkout/.
 */

const WP_SITE = ((import.meta.env.VITE_WP_SITE_URL as string | undefined) ?? '').replace(/\/+$/, '')

export const isWordPressConfigured = Boolean(WP_SITE)

export interface WordPressCartItem {
  id: number
  qty: number
  variationId?: number
}

/**
 * Turns cart lines into the `bolt_cart` query value.
 * Returns an empty string when nothing valid is left.
 */
export function cartQuery(items: WordPressCartItem[]): string {
  return items
    .filter(
      (item) =>
        Number.isInteger(item.id) &&
        item.id > 0 &&
        Number.isInteger(item.qty) &&
        item.qty > 0 &&
        (item.variationId === undefined || Number.isInteger(item.variationId)),
    )
    .map((item) => `${item.id}:${item.qty}${item.variationId ? `:${item.variationId}` : ''}`)
    .join(',')
}

/**
 * Sends the visitor to the store checkout.
 * Returns false (and says why) when the handoff cannot happen, so callers
 * can keep the drawer open instead of silently doing nothing.
 */
export function checkout(items: WordPressCartItem[]): boolean {
  const pairs = cartQuery(items)

  if (!WP_SITE || !pairs) {
    window.alert('演示模式：配置 VITE_WP_SITE_URL 和商品 wooId 后即可真实支付')
    return false
  }

  window.location.href = `${WP_SITE}/?bolt_cart=${pairs}`
  return true
}
