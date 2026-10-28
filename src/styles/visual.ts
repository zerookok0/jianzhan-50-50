import { img, PHOTOS, type ImageKey } from '../data/images'

/**
 * Named visual slots used by layout chrome (heroes, bands, footer).
 * Swap any key here or in src/data/images.ts to re-shoot the site.
 */
export const visual = {
  /* Hero is composed in layers: misty mountains behind, lit bowl in front. */
  heroMountain: img('mountain-2', 2000),
  heroBowl: img('bowl-oil-spot', 1400),
  heroBackdrop: img('mountain-4', 2000),
  soul: img('bowl-iris', 1400),
  craft: img('kiln-hands', 1600),
  craftFire: img('kiln-glow', 1600),
  craftDetail: img('kiln-studio', 1200),
  craftHands2: img('kiln-hands-4', 1200),
  sectionDivider: img('smoke-dark', 1600),
  gift: img('bowl-set', 1600),
  journal: img('rock-detail', 1200),
  aboutHero: img('forest-fog', 2000),
  aboutPortrait: img('kiln-hands-3', 1200),
  aboutStudio: img('kiln-tools', 1200),
  collectionHero: img('bowl-darkware', 1800),
  footer: img('mountain-2', 1800),
  parting: img('smoke-column', 1600),
} as const

/** Optional credit line for a photo (Pexels attribution). */
export function credit(key: ImageKey): string {
  return `${PHOTOS[key].note} · Pexels`
}
