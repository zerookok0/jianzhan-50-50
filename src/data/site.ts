/**
 * BRAND & SITE CONFIGURATION
 * ------------------------------------------------------------------
 * Everything a non-developer needs to change lives here.
 * Product data is NOT here — see src/data/products.ts
 */

export const site = {
  brand: 'JIANZHAN',
  brandCn: '建盏',
  tagline: 'The Earth in Your Hands, Time in the Glaze',
  legalName: 'JIANZHAN Studio',
  email: 'studio@example.com',
  phone: '+1 (000) 000-0000',
  studio: 'Placeholder address — Studio 00, Kiln Road, Jianyang, Fujian, China',
  hours: 'Mon – Fri, 9:00 – 18:00 (GMT+8)',
  /** Replace with your live domain */
  url: 'https://www.example.com',
  /** WordPress / WooCommerce store. All buying happens there. */
  shopBaseUrl: 'https://shop.example.com',
  /** If set, product purchaseUrl falls back to `${shopBaseUrl}/product/${slug}` */
  autoDerivePurchaseUrl: true,
  currency: 'USD',
  social: [
    { label: 'Instagram', href: '#' },
    { label: 'Pinterest', href: '#' },
    { label: 'Facebook', href: '#' },
    { label: 'YouTube', href: '#' },
  ],
  policies: [
    { label: 'Shipping & Returns', href: '#' },
    { label: 'Care & Use', href: '#' },
    { label: 'Privacy Policy', href: '#' },
    { label: 'Terms of Service', href: '#' },
  ],
} as const

export const navigation = [
  { label: 'Home', href: '/' },
  { label: 'Collection', href: '/collection' },
  { label: 'Our Craft', href: '/craft' },
  { label: 'Journal', href: '/journal' },
  { label: 'About', href: '/about' },
] as const

export const announcement = 'Demo catalogue — prices and availability are illustrative. Checkout is completed on our WordPress store.'
