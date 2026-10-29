import type { Product, GlazeId, CategoryId } from './types'

/**
 * DEMO CATALOGUE
 * Prices, availability and copy are illustrative only — nothing here is
 * live data. Replace the objects below with your real pieces and paste the
 * matching WooCommerce URL into `purchaseUrl`.
 */

export const products: Product[] = [
  {
    id: 'jz-01',
    slug: 'midnight-oil-spot-bowl',
    name: 'Midnight Oil Spot',
    subtitle: 'Iron crystals suspended in a black glaze',
    description:
      'Concentric rings of metallic crystals sit on a near-black ground, catching light as the bowl turns. Each spot forms during cooling, when iron in the glaze crystallises — a result that can be encouraged but never fully controlled. The foot is left unglazed, revealing the iron-rich clay body and the marks of the wheel.',
    price: 420,
    currency: 'USD',
    images: ['bowl-oil-spot', 'bowl-oil-spot-2', 'bowl-hero', 'rock-detail'],
    category: 'tea-bowl',
    glaze: 'oil-spot',
    specifications: [
      { label: 'Diameter', value: '12.4 cm' },
      { label: 'Height', value: '6.8 cm' },
      { label: 'Capacity', value: '180 ml' },
      { label: 'Weight', value: '310 g' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1300 °C' },
    ],
    purchaseUrl: null,
    wooId: 2472,
    featured: true,
    availability: 'available',
    year: '2024',
  },
  {
    id: 'jz-02',
    slug: 'hares-fur-bowl',
    name: "Hare's Fur",
    subtitle: 'Streaks drawn by the direction of the flame',
    description:
      'Fine bronze streaks run from rim to base, following the path the flame took through the kiln. The pattern is a record of air and heat rather than a design, which is why no two bowls share the same fall of light.',
    price: 380,
    currency: 'USD',
    images: ['bowl-hare', 'bowl-hare-2', 'bowl-table', 'kiln-glow'],
    category: 'tea-bowl',
    glaze: 'hare-fur',
    specifications: [
      { label: 'Diameter', value: '11.8 cm' },
      { label: 'Height', value: '6.2 cm' },
      { label: 'Capacity', value: '160 ml' },
      { label: 'Weight', value: '285 g' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1300 °C' },
    ],
    purchaseUrl: null,
    wooId: 2465,
    featured: true,
    availability: 'available',
    year: '2024',
  },
  {
    id: 'jz-03',
    slug: 'iridescent-blue-bowl',
    name: 'Iridescent Blue',
    subtitle: 'A shift of colour held inside the glaze',
    description:
      'Held to the light, the surface moves between blue, violet and a faint copper warmth. This iridescence is a thin-film effect in the glaze layer itself; it is not a pigment, and it changes as the viewing angle changes.',
    price: 640,
    currency: 'USD',
    images: ['bowl-iris', 'bowl-iris-2', 'glaze-tools', 'smoke-soft'],
    category: 'tea-bowl',
    glaze: 'iridescent',
    specifications: [
      { label: 'Diameter', value: '12.6 cm' },
      { label: 'Height', value: '7.0 cm' },
      { label: 'Capacity', value: '190 ml' },
      { label: 'Weight', value: '330 g' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1310 °C' },
    ],
    purchaseUrl: null,
    variants: [
      { id: 'jz-03-a', label: 'Small — 12.6 cm', purchaseUrl: null },
      { id: 'jz-03-b', label: 'Large — 14.2 cm', purchaseUrl: null },
    ],
    featured: true,
    availability: 'made-to-order',
    year: '2025',
  },
  {
    id: 'jz-04',
    slug: 'jade-glaze-bowl',
    name: 'Jade Glaze',
    subtitle: 'Cool green beneath a dark skin',
    description:
      'A quiet bowl. The glaze pools toward a soft celadon-green at the interior, while the exterior stays in shadow. Best appreciated empty, or with a pale tea that lets the glaze do the speaking.',
    price: 360,
    currency: 'USD',
    images: ['bowl-jade', 'bowl-jade-2', 'rock-pile', 'tea-pour'],
    category: 'tea-bowl',
    glaze: 'jade',
    specifications: [
      { label: 'Diameter', value: '11.5 cm' },
      { label: 'Height', value: '6.0 cm' },
      { label: 'Capacity', value: '150 ml' },
      { label: 'Weight', value: '270 g' },
      { label: 'Body', value: 'Stoneware with iron slip' },
      { label: 'Firing', value: 'Reduction, 1280 °C' },
    ],
    purchaseUrl: null,
    wooId: 2461,
    featured: true,
    availability: 'available',
    year: '2024',
  },
  {
    id: 'jz-05',
    slug: 'tea-dust-vessel',
    name: 'Tea Dust Vessel',
    subtitle: 'A matte surface the colour of dust and moss',
    description:
      'Made to hold dry tea leaves rather than liquid. The unpolished surface softens with use, taking on a faint sheen from the hand — the only patina this glaze will ever show.',
    price: 290,
    currency: 'USD',
    images: ['bowl-minimal', 'bowl-darkware-2', 'kiln-studio', 'stone-texture'],
    category: 'vessel',
    glaze: 'tea-dust',
    specifications: [
      { label: 'Diameter', value: '9.8 cm' },
      { label: 'Height', value: '10.5 cm' },
      { label: 'Capacity', value: '320 ml' },
      { label: 'Weight', value: '365 g' },
      { label: 'Body', value: 'Stoneware' },
      { label: 'Firing', value: 'Reduction, 1260 °C' },
    ],
    purchaseUrl: null,
    featured: false,
    availability: 'available',
    year: '2023',
  },
  {
    id: 'jz-06',
    slug: 'connoisseur-pair',
    name: 'Connoisseur Pair',
    subtitle: 'Two bowls, one firing, deliberately unalike',
    description:
      'A pair chosen from a single kiln load so the contrast stays visible: one leaning to oil spot, one to hare\'s fur. Sold as a set, boxed in linen with a recorded firing note.',
    price: 880,
    currency: 'USD',
    images: ['bowl-set', 'bowl-darkware', 'kiln-wood', 'tea-ritual'],
    category: 'set',
    glaze: 'oil-spot',
    specifications: [
      { label: 'Bowls', value: '2' },
      { label: 'Diameter', value: '12.0 cm each' },
      { label: 'Height', value: '6.5 cm each' },
      { label: 'Capacity', value: '175 ml each' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Presentation', value: 'Linen-wrapped box' },
    ],
    purchaseUrl: null,
    featured: true,
    availability: 'made-to-order',
    year: '2025',
  },
  {
    id: 'jz-07',
    slug: 'ash-shadow-bowl',
    name: 'Ash Shadow',
    subtitle: 'Wood ash settling where the flame slowed',
    description:
      'Ash from the firing settles unevenly across the shoulder of this bowl, leaving a grey-green drift over the darker body. Part of a small run where the kiln was allowed to cool slowly.',
    price: 460,
    currency: 'USD',
    images: ['bowl-jade-2', 'bowl-studio', 'kiln-studio', 'rock-field'],
    category: 'tea-bowl',
    glaze: 'jade',
    specifications: [
      { label: 'Diameter', value: '12.1 cm' },
      { label: 'Height', value: '6.4 cm' },
      { label: 'Capacity', value: '170 ml' },
      { label: 'Weight', value: '300 g' },
      { label: 'Body', value: 'Stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1290 °C' },
    ],
    purchaseUrl: null,
    featured: false,
    availability: 'enquire',
    year: '2024',
  },
  {
    id: 'jz-08',
    slug: 'deep-iridescence-bowl',
    name: 'Deep Iridescence',
    subtitle: 'A darker reading of the blue glaze',
    description:
      'Where the Iridescent Blue opens toward violet, this bowl holds its colour deeper, closer to the black ground. The surface only answers to a strong, single light source.',
    price: 720,
    currency: 'USD',
    images: ['bowl-hero', 'bowl-iris', 'glaze-detail', 'smoke-dark'],
    category: 'tea-bowl',
    glaze: 'iridescent',
    specifications: [
      { label: 'Diameter', value: '13.0 cm' },
      { label: 'Height', value: '7.2 cm' },
      { label: 'Capacity', value: '200 ml' },
      { label: 'Weight', value: '345 g' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1310 °C' },
    ],
    purchaseUrl: null,
    featured: false,
    availability: 'sold-out',
    year: '2023',
  },
  {
    id: 'jz-09',
    slug: 'hare-fur-teacup',
    name: "Hare's Fur Cup",
    subtitle: 'The same glaze, at a smaller scale',
    description:
      'A companion cup to the Hare\'s Fur bowl, thrown thinner so the streaks read at close range. Intended for everyday use, and to be washed by hand.',
    price: 180,
    currency: 'USD',
    images: ['bowl-tea', 'bowl-matcha', 'tea-pot', 'kiln-hands-2'],
    category: 'tea-bowl',
    glaze: 'hare-fur',
    specifications: [
      { label: 'Diameter', value: '8.6 cm' },
      { label: 'Height', value: '5.0 cm' },
      { label: 'Capacity', value: '90 ml' },
      { label: 'Weight', value: '175 g' },
      { label: 'Body', value: 'Iron-rich stoneware' },
      { label: 'Firing', value: 'Wood-fired, 1300 °C' },
    ],
    purchaseUrl: null,
    featured: false,
    availability: 'available',
    year: '2025',
  },
]

/* ---------------- Glaze taxonomy (only glazes with real photos appear) ---------------- */

export interface Glaze {
  id: GlazeId
  name: string
  cn: string
  tagline: string
  description: string
  image: Product['images'][number]
}

export const glazes: Glaze[] = [
  {
    id: 'oil-spot',
    name: 'Oil Spot',
    cn: '油滴',
    tagline: 'Iron crystals, cooled slowly',
    description:
      'During firing, iron oxide in the glaze gathers into droplets. If the kiln cools at the right pace, those droplets crystallise into bright metallic spots that sit proud of the dark ground.',
    image: 'bowl-oil-spot',
  },
  {
    id: 'iridescent',
    name: 'Blue Iridescent',
    cn: '曜变',
    tagline: 'Colour without pigment',
    description:
      'A very thin surface layer breaks light into blue, violet and faint copper. The effect moves with the viewer — a quality that has made these bowls difficult to photograph and prized by collectors.',
    image: 'bowl-iris',
  },
  {
    id: 'hare-fur',
    name: "Hare's Fur",
    cn: '兔毫',
    tagline: 'Streaks left by the flame',
    description:
      'Iron-rich glaze runs in fine vertical lines as it melts, drawing streaks of bronze and rust from rim toward foot. The direction of each streak records how heat moved through the kiln.',
    image: 'bowl-hare',
  },
  {
    id: 'jade',
    name: 'Jade Glaze',
    cn: '青釉',
    tagline: 'Green held under shadow',
    description:
      'A cooler counterpoint to the iron glazes. Where the others glitter, this one absorbs light, pooling into a soft celadon green inside an otherwise dark bowl.',
    image: 'bowl-jade',
  },
  {
    id: 'tea-dust',
    name: 'Tea Dust',
    cn: '茶叶末',
    tagline: 'Matte, mineral, quiet',
    description:
      'A matte glaze flecked with olive and ash. It is the least reflective surface in the collection, and the one that changes most slowly with handling.',
    image: 'bowl-minimal',
  },
]

export const categories: { id: CategoryId; label: string }[] = [
  { id: 'tea-bowl', label: 'Tea Bowls' },
  { id: 'vessel', label: 'Vessels' },
  { id: 'set', label: 'Sets' },
]

/* ---------------- Helpers ---------------- */

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug)
}

export function getGlaze(id: GlazeId): Glaze | undefined {
  return glazes.find((g) => g.id === id)
}

export function getRelated(product: Product, count = 3): Product[] {
  return products
    .filter((p) => p.id !== product.id)
    .sort((a, b) => {
      const score = (p: Product) => (p.glaze === product.glaze ? 2 : 0) + (p.featured ? 1 : 0)
      return score(b) - score(a)
    })
    .slice(0, count)
}

export function formatPrice(price: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

export const availabilityLabels: Record<Product['availability'], string> = {
  available: 'Available',
  'made-to-order': 'Made to order',
  'sold-out': 'Sold — archive',
  enquire: 'Enquire',
}
