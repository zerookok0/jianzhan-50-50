/**
 * SEED DATA
 * ------------------------------------------------------------------
 * The nine pieces from src/data/products.ts, inserted as real D1 rows so
 * the storefront can read them from the API instead of a static file.
 *
 * Prices are converted to MINOR UNITS on the way in: the catalogue lists
 * `420`, this inserts `42000` with minor_unit = 2. Doing the conversion
 * here rather than at read time means the API only ever speaks integers.
 *
 * Stock is deliberately uneven. One piece is at zero, one is at one unit,
 * and one is untracked — so the out-of-stock and "last one" paths can be
 * exercised without editing the database by hand.
 */

const NOW = Date.now()

const CATEGORIES = [
  { id: 'tea-bowl', slug: 'tea-bowls', name: 'Tea Bowls', description: 'Bowls for drinking tea.', position: 0 },
  { id: 'vessel', slug: 'vessels', name: 'Vessels', description: 'Vessels for storing tea.', position: 1 },
  { id: 'set', slug: 'sets', name: 'Sets', description: 'Boxed pairs.', position: 2 },
]

/** price is in whole currency units here; the insert multiplies by 100. */
const PRODUCTS = [
  {
    id: 'jz-01',
    slug: 'midnight-oil-spot-bowl',
    name: 'Midnight Oil Spot',
    subtitle: 'Iron crystals suspended in a black glaze',
    description:
      'Concentric rings of metallic crystals sit on a near-black ground, catching light as the bowl turns. Each spot forms during cooling, when iron in the glaze crystallises — a result that can be encouraged but never fully controlled. The foot is left unglazed, revealing the iron-rich clay body and the marks of the wheel.',
    price: 420,
    category: 'tea-bowl',
    glaze: 'oil-spot',
    year: '2024',
    weight: 310,
    featured: 1,
    availability: 'available',
    stock: 3,
    images: [
      'https://images.pexels.com/photos/31203862/pexels-photo-31203862.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203860/pexels-photo-31203860.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203851/pexels-photo-31203851.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/18696058/pexels-photo-18696058.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-02',
    slug: 'hares-fur-bowl',
    name: "Hare's Fur",
    subtitle: 'Streaks drawn by the direction of the flame',
    description:
      'Fine bronze streaks run from rim to base, following the path the flame took through the kiln. The pattern is a record of air and heat rather than a design, which is why no two bowls share the same fall of light.',
    price: 380,
    category: 'tea-bowl',
    glaze: 'hare-fur',
    year: '2024',
    weight: 285,
    featured: 1,
    availability: 'available',
    stock: 2,
    images: [
      'https://images.pexels.com/photos/31203866/pexels-photo-31203866.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203652/pexels-photo-31203652.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/27356196/pexels-photo-27356196.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/34584522/pexels-photo-34584522.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-03',
    slug: 'iridescent-blue-bowl',
    name: 'Iridescent Blue',
    subtitle: 'A shift of colour held inside the glaze',
    description:
      'Held to the light, the surface moves between blue, violet and a faint copper warmth. This iridescence is a thin-film effect in the glaze layer itself; it is not a pigment, and it changes as the viewing angle changes.',
    price: 640,
    category: 'tea-bowl',
    glaze: 'iridescent',
    year: '2025',
    weight: 330,
    featured: 1,
    availability: 'made-to-order',
    stock: 1,
    images: [
      'https://images.pexels.com/photos/31203852/pexels-photo-31203852.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203869/pexels-photo-31203869.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/9736320/pexels-photo-9736320.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/10901796/pexels-photo-10901796.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
    variants: [
      { id: 'jz-03-a', label: 'Small', value: 'Small — 12.6 cm', price: 640, stock: 1 },
      { id: 'jz-03-b', label: 'Large', value: 'Large — 14.2 cm', price: 740, stock: 0 },
    ],
  },
  {
    id: 'jz-04',
    slug: 'jade-glaze-bowl',
    name: 'Jade Glaze',
    subtitle: 'Cool green beneath a dark skin',
    description:
      'A quiet bowl. The glaze pools toward a soft celadon-green at the interior, while the exterior stays in shadow. Best appreciated empty, or with a pale tea that lets the glaze do the speaking.',
    price: 360,
    category: 'tea-bowl',
    glaze: 'jade',
    year: '2024',
    weight: 270,
    featured: 1,
    availability: 'available',
    stock: 4,
    images: [
      'https://images.pexels.com/photos/31203858/pexels-photo-31203858.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203856/pexels-photo-31203856.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/12940662/pexels-photo-12940662.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/7018210/pexels-photo-7018210.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-05',
    slug: 'tea-dust-vessel',
    name: 'Tea Dust Vessel',
    subtitle: 'A matte surface the colour of dust and moss',
    description:
      'Made to hold dry tea leaves rather than liquid. The unpolished surface softens with use, taking on a faint sheen from the hand — the only patina this glaze will ever show.',
    price: 290,
    category: 'vessel',
    glaze: 'tea-dust',
    year: '2023',
    weight: 365,
    featured: 0,
    availability: 'available',
    stock: 5,
    images: [
      'https://images.pexels.com/photos/6474375/pexels-photo-6474375.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/10622399/pexels-photo-10622399.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/9736320/pexels-photo-9736320.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/7641148/pexels-photo-7641148.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-06',
    slug: 'connoisseur-pair',
    name: 'Connoisseur Pair',
    subtitle: 'Two bowls, one firing, deliberately unalike',
    description:
      "A pair chosen from a single kiln load so the contrast stays visible: one leaning to oil spot, one to hare's fur. Sold as a set, boxed in linen with a recorded firing note.",
    price: 880,
    category: 'set',
    glaze: 'oil-spot',
    year: '2025',
    weight: 700,
    featured: 1,
    availability: 'made-to-order',
    stock: 2,
    images: [
      'https://images.pexels.com/photos/29282184/pexels-photo-29282184.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/10622469/pexels-photo-10622469.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/2137284/pexels-photo-2137284.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/27921816/pexels-photo-27921816.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-07',
    slug: 'ash-shadow-bowl',
    name: 'Ash Shadow',
    subtitle: 'Wood ash settling where the flame slowed',
    description:
      'Ash from the firing settles unevenly across the shoulder of this bowl, leaving a grey-green drift over the darker body. Part of a small run where the kiln was allowed to cool slowly.',
    price: 460,
    category: 'tea-bowl',
    glaze: 'jade',
    year: '2024',
    weight: 300,
    featured: 0,
    availability: 'enquire',
    stock: 0,
    images: [
      'https://images.pexels.com/photos/31203856/pexels-photo-31203856.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/7260337/pexels-photo-7260337.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/9736320/pexels-photo-9736320.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/7147867/pexels-photo-7147867.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-08',
    slug: 'deep-iridescence-bowl',
    name: 'Deep Iridescence',
    subtitle: 'A darker reading of the blue glaze',
    description:
      'Where the Iridescent Blue opens toward violet, this bowl holds its colour deeper, closer to the black ground. The surface only answers to a strong, single light source.',
    price: 720,
    category: 'tea-bowl',
    glaze: 'iridescent',
    year: '2023',
    weight: 345,
    featured: 0,
    availability: 'sold-out',
    stock: 0,
    images: [
      'https://images.pexels.com/photos/31203851/pexels-photo-31203851.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/31203852/pexels-photo-31203852.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/28271468/pexels-photo-28271468.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/4722576/pexels-photo-4722576.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
  {
    id: 'jz-09',
    slug: 'hare-fur-teacup',
    name: "Hare's Fur Cup",
    subtitle: 'The same glaze, at a smaller scale',
    description:
      "A companion cup to the Hare's Fur bowl, thrown thinner so the streaks read at close range. Intended for everyday use, and to be washed by hand.",
    price: 180,
    category: 'tea-bowl',
    glaze: 'hare-fur',
    year: '2025',
    weight: 175,
    featured: 0,
    availability: 'available',
    // Untracked: a cup made to order in quantity, so stock never blocks it.
    stock: null,
    images: [
      'https://images.pexels.com/photos/33117980/pexels-photo-33117980.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/6833704/pexels-photo-6833704.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/7300491/pexels-photo-7300491.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://images.pexels.com/photos/8665347/pexels-photo-8665347.jpeg?auto=compress&cs=tinysrgb&w=1200',
    ],
  },
]

const TAX_RULES = [
  // US: no federal sales tax modelled. Configure per state before selling.
  { id: 'tax-us', name: 'US sales tax', countries: '["US"]', region: null, tax_class: '*', rate_bp: 0, inclusive: 0, position: 0 },
  // UK standard rate, prices shown exclusive of VAT.
  { id: 'tax-gb', name: 'UK VAT', countries: '["GB"]', region: null, tax_class: '*', rate_bp: 2000, inclusive: 0, position: 1 },
  // EU fallback. Real rates vary by country; this is a placeholder that must
  // be replaced before selling into the EU.
  { id: 'tax-eu', name: 'EU VAT (placeholder)', countries: '["DE","FR"]', region: null, tax_class: '*', rate_bp: 1900, inclusive: 0, position: 2 },
]

const SHIPPING = {
  zones: [
    { id: 'zone-us', name: 'United States', countries: '["US"]', regions: '[]', prefixes: '[]', position: 0 },
    { id: 'zone-gb', name: 'United Kingdom', countries: '["GB"]', regions: '[]', prefixes: '[]', position: 1 },
    { id: 'zone-rest', name: 'Rest of world', countries: '["*"]', regions: '[]', prefixes: '[]', position: 9 },
  ],
  methods: [
    { id: 'ship-us-std', zone: 'zone-us', name: 'Standard', type: 'flat', rate: 1500, free_over: 50000, min: 0, time: '5–8 business days', position: 0 },
    { id: 'ship-us-exp', zone: 'zone-us', name: 'Express', type: 'flat', rate: 3500, free_over: null, min: 0, time: '2–3 business days', position: 1 },
    { id: 'ship-gb-std', zone: 'zone-gb', name: 'Standard', type: 'flat', rate: 1200, free_over: 40000, min: 0, time: '3–5 business days', position: 0 },
    { id: 'ship-rest-std', zone: 'zone-rest', name: 'International', type: 'flat', rate: 4500, free_over: null, min: 0, time: '10–18 business days', position: 0 },
  ],
}

const COUPONS = [
  {
    id: 'coupon-welcome',
    code: 'WELCOME10',
    type: 'percent',
    amount: 1000, // 10%
    min: 0,
    max: null,
    per_customer: 1,
  },
  {
    id: 'coupon-shipfree',
    code: 'SHIPFREE',
    type: 'fixed',
    amount: 1500,
    min: 20000,
    max: 100,
    per_customer: null,
  },
]

/* ------------------------------------------------------------------ */

export function seed(d1) {
  for (const c of CATEGORIES) {
    d1.prepare(
      `INSERT INTO categories (id, slug, name, description, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(c.id, c.slug, c.name, c.description, c.position, NOW, NOW)
      .run()
  }

  for (const p of PRODUCTS) {
    const minor = p.price * 100

    d1.prepare(
      `INSERT INTO products (
         id, slug, name, subtitle, description, price, currency, minor_unit, sku,
         category_id, glaze, year, weight_g, requires_shipping, tax_class,
         status, availability, is_featured, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'USD', 2, ?, ?, ?, ?, ?, 1, 'standard', 'active', ?, ?, ?, ?)`,
    )
      .bind(
        p.id,
        p.slug,
        p.name,
        p.subtitle,
        p.description,
        minor,
        `JZ-${p.id.slice(-2)}`,
        p.category,
        p.glaze,
        p.year,
        p.weight,
        p.availability,
        p.featured,
        NOW,
        NOW,
      )
      .run()

    p.images.forEach((url, i) => {
      d1.prepare(
        `INSERT INTO product_images (id, product_id, r2_key, url, alt, position)
         VALUES (?, ?, NULL, ?, ?, ?)`,
      )
        .bind(`${p.id}-img-${i}`, p.id, url, `${p.name} — view ${i + 1}`, i)
        .run()
    })

    if (p.variants) {
      p.variants.forEach((v, i) => {
        d1.prepare(
          `INSERT INTO product_variants
             (id, product_id, sku, option_name, option_value, price, weight_g, position, is_active)
           VALUES (?, ?, ?, 'Size', ?, ?, NULL, ?, 1)`,
        )
          .bind(v.id, p.id, `${p.id}-${v.label}`, v.value, v.price * 100, i)
          .run()
      })
    }

    // Parent inventory row.
    const tracked = p.stock !== null ? 1 : 0
    const onHand = p.stock ?? 0
    d1.prepare(
      `INSERT INTO inventory
         (id, product_id, variant_id, on_hand, reserved, sellable, is_tracked, allow_backorder, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 0, ?, ?, 0, ?, ?)`,
    )
      .bind(`inv-${p.id}`, p.id, onHand, onHand, tracked, NOW, NOW)
      .run()

    // Variant inventory rows, when the option is stocked separately.
    if (p.variants) {
      for (const v of p.variants) {
        d1.prepare(
          `INSERT INTO inventory
             (id, product_id, variant_id, on_hand, reserved, sellable, is_tracked, allow_backorder, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, 1, 0, ?, ?)`,
        )
          .bind(`inv-${v.id}`, p.id, v.id, v.stock, v.stock, NOW, NOW)
          .run()
      }
    }
  }

  for (const t of TAX_RULES) {
    d1.prepare(
      `INSERT INTO tax_rules
         (id, name, countries, region, tax_class, rate_bp, prices_include_tax, rounding, position, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'round', ?, 1, ?, ?)`,
    )
      .bind(t.id, t.name, t.countries, t.region, t.tax_class, t.rate_bp, t.inclusive, t.position, NOW, NOW)
      .run()
  }

  for (const z of SHIPPING.zones) {
    d1.prepare(
      `INSERT INTO shipping_zones
         (id, name, countries, regions, postcode_prefixes, position, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(z.id, z.name, z.countries, z.regions, z.prefixes, z.position, NOW, NOW)
      .run()
  }

  for (const m of SHIPPING.methods) {
    d1.prepare(
      `INSERT INTO shipping_methods
         (id, zone_id, name, rate_type, rate, free_over, min_subtotal, delivery_time, position, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(m.id, m.zone, m.name, m.type, m.rate, m.free_over, m.min, m.time, m.position, NOW, NOW)
      .run()
  }

  for (const c of COUPONS) {
    d1.prepare(
      `INSERT INTO coupons
         (id, code, discount_type, amount, currency, minor_unit, min_subtotal,
          starts_at, ends_at, max_redemptions, max_per_customer,
          include_product_ids, include_category_ids, stacking, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 2, ?, NULL, NULL, ?, ?, '[]', '[]', 'stackable', 1, ?, ?)`,
    )
      .bind(c.id, c.code, c.type, c.amount, c.min, c.max, c.per_customer, NOW, NOW)
      .run()
  }

  return {
    products: PRODUCTS.length,
    categories: CATEGORIES.length,
    coupons: COUPONS.length,
  }
}
