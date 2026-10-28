-- ============================================================================
-- 0002 — Cart coupons
-- ============================================================================
-- Applied coupon codes live in a small join table so a coupon can be
-- removed individually without rewriting the whole cart row.
-- Codes are re-resolved against `coupons` on every read, so an expired or
-- deactivated coupon stops applying immediately.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cart_coupons (
  cart_id     TEXT PRIMARY KEY REFERENCES carts(id) ON DELETE CASCADE,
  -- JSON array of coupon codes, e.g. ["TEST10","SHIPFREE"]
  coupon_codes TEXT NOT NULL DEFAULT '[]',
  updated_at  INTEGER NOT NULL
);
