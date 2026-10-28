/**
 * IMAGE LIBRARY
 * ------------------------------------------------------------------
 * Real, verified Pexels photos (all return HTTP 200).
 * Every image is referenced through `img()` so you can swap a single
 * ID, or point `LOCAL_OVERRIDES` at your own photography.
 *
 * To use your own photos: drop them in /public/images and set
 *   overrides: { 'bowl-01': '/images/bowl-01.jpg' }
 */

export type ImageKey = keyof typeof PHOTOS

export interface Photo {
  /** Pexels photo ID */
  id: number
  /** Short contextual description used for alt text / credits */
  note: string
}

export const PHOTOS = {
  // --- Jian-style bowl / vessel stills (dark, metallic finish)
  'bowl-hero': { id: 31203851, note: 'Dark metallic-glazed bowl, studio still life' },
  'bowl-oil-spot': { id: 31203862, note: 'Handmade bowls with metallic glaze, close view' },
  'bowl-oil-spot-2': { id: 31203860, note: 'Rustic metallic ceramic bowls on dark ground' },
  'bowl-hare': { id: 31203866, note: 'Handmade dark ceramic bowls stacked' },
  'bowl-hare-2': { id: 31203652, note: 'Rustic finished bowl detail on dark surface' },
  'bowl-jade': { id: 31203858, note: 'Ceramic pots with dark artistic finish' },
  'bowl-jade-2': { id: 31203856, note: 'Rustic handmade cups, dark finish' },
  'bowl-iris': { id: 31203852, note: 'Stacked clay vessels in a moody setting' },
  'bowl-iris-2': { id: 31203869, note: 'Artisan cups with textured surfaces' },
  'bowl-minimal': { id: 6474375, note: 'Empty black ceramic bowl on textured surface' },
  'bowl-studio': { id: 7260337, note: 'Ceramic dishware on black studio ground' },
  'bowl-set': { id: 29282184, note: 'Collection of handcrafted bowls' },
  'bowl-table': { id: 27356196, note: 'Bowls on a dark marbled table' },
  'bowl-darkware': { id: 10622469, note: 'Dark ceramic tableware still life' },
  'bowl-darkware-2': { id: 10622399, note: 'Black and beige ceramic dishware, studio' },
  'bowl-matcha': { id: 6833704, note: 'Tea bowl detail on a dark background' },
  'bowl-matcha-2': { id: 6833728, note: 'Bowl and whisk detail, dark backdrop' },
  'bowl-tea': { id: 33117980, note: 'Tea in a traditional bowl, low light' },

  // --- Kiln, fire, making
  'kiln-glow': { id: 34584522, note: 'Glowing kiln with embers and firelight' },
  'kiln-wood': { id: 2137284, note: 'Potters firing clay with burning wood at dusk' },
  'kiln-brick': { id: 35473467, note: 'Brick kiln with glowing embers' },
  'kiln-hands': { id: 20362430, note: 'Hands shaping clay on the wheel' },
  'kiln-hands-2': { id: 8665347, note: 'Close-up of hands forming a pot' },
  'kiln-hands-3': { id: 28867402, note: 'Artisan shaping a vessel on the wheel' },
  'kiln-hands-4': { id: 19867573, note: 'Potter working clay with both hands' },
  'kiln-hands-5': { id: 31875677, note: 'Hands crafting pottery on a spinning wheel' },
  'kiln-studio': { id: 9736320, note: 'Pottery tools and glaze on a workshop table' },
  'glaze-close': { id: 9736320, note: 'Glaze mixing and tools on the studio bench' },
  'kiln-tools': { id: 30133113, note: 'Ceramic workshop detail' },
  'kiln-measure': { id: 15676185, note: 'Craft measurement detail' },

  // --- Tea ritual
  'tea-pour': { id: 7018210, note: 'Tea being poured onto a wooden tray' },
  'tea-pot': { id: 7300491, note: 'Ceramic teapot over a stove' },
  'tea-ritual': { id: 27921816, note: 'Tea time still life' },
  'tea-ceremony': { id: 9795527, note: 'Tea ceremony in low light' },

  // --- Landscape / atmosphere
  'mountain-1': { id: 6078836, note: 'Misty forested mountain range' },
  'mountain-2': { id: 18359798, note: 'Mountain hidden in mist' },
  'mountain-3': { id: 39360611, note: 'Peaks surrounded by cloud' },
  'mountain-4': { id: 15469407, note: 'Dark mountain silhouettes' },
  'mountain-5': { id: 1671215, note: 'Rain over mountain ridges' },
  'forest-fog': { id: 5982829, note: 'Dark forest in fog' },
  'forest-fog-2': { id: 29218798, note: 'Foggy forest depth' },
  'smoke-dark': { id: 4722576, note: 'Dark cinematic haze' },
  'smoke-column': { id: 11230057, note: 'Smoke against black' },
  'smoke-soft': { id: 10901796, note: 'Soft smoke on dark ground' },
  'incense': { id: 31097197, note: 'Incense smoke, low light' },
  'rock-pile': { id: 12940662, note: 'Rough black rocks, textured pile' },
  'rock-field': { id: 7147867, note: 'Dark stones on shore' },
  'rock-detail': { id: 18696058, note: 'Close detail of natural rock' },
  'stone-texture': { id: 7641148, note: 'Dark stone texture' },
  'texture-dark': { id: 9667550, note: 'Dark abstract texture' },
  'glaze-detail': { id: 28271468, note: 'Blue and green glaze study, macro detail' },
  'glaze-surface': { id: 35463145, note: 'Glazed ceramic surface detail' },
  'glaze-tools': { id: 9736320, note: 'Glaze materials on the studio bench' },
  'craft-detail': { id: 6493200, note: 'Studio craft detail' },
} as const satisfies Record<string, Photo>

/**
 * Point these at your own files in /public/images to replace a photo
 * without touching any component. Example:
 *   'bowl-hero': '/images/jianzhan-hero.jpg'
 */
export const LOCAL_OVERRIDES: Partial<Record<ImageKey, string>> = {}

/** Widths requested from the Pexels CDN (they are free to resize). */
export const IMAGE_WIDTHS = [480, 800, 1200, 1600, 2000]

export function img(key: ImageKey, width = 1200): string {
  const override = LOCAL_OVERRIDES[key]
  if (override) return override
  const photo = PHOTOS[key]
  return `https://images.pexels.com/photos/${photo.id}/pexels-photo-${photo.id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`
}

export function srcSet(key: ImageKey): string {
  if (LOCAL_OVERRIDES[key]) return ''
  return IMAGE_WIDTHS.map((w) => `${img(key, w)} ${w}w`).join(', ')
}

export function imageAlt(alt: string): string {
  return alt
}
