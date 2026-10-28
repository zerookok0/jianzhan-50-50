/**
 * Journal entries.
 * Editorial copy is written for the brand; no invented named authors,
 * no fabricated citations or historical claims beyond common craft
 * descriptions. Replace freely with your own texts.
 */

export interface Post {
  slug: string
  title: string
  kicker: string
  excerpt: string
  readMinutes: number
  date: string
  image: string
  body: { heading?: string; text: string }[]
}

export const posts: Post[] = [
  {
    slug: 'reading-a-glaze',
    title: 'Reading a Glaze',
    kicker: 'Glaze',
    excerpt:
      'Three bowls from the same kiln can look like three different materials. A short guide to what the surface is telling you.',
    readMinutes: 5,
    date: '2025-02-11',
    image: 'glaze-detail',
    body: [
      {
        text: 'A glaze is a thin layer of glass. Everything you see on a finished piece — colour, shine, the small interruptions in both — happens inside a layer usually no thicker than a fingernail. Learning to read that layer is most of what collecting these bowls involves.',
      },
      {
        heading: 'Look at the light, not the object',
        text: 'Most iron glazes look flat under diffuse light and turn dramatic under a single, close source. Move the bowl slowly rather than the lamp. Oil spots appear to sit above the ground; hare\'s fur streaks seem to sink into it.',
      },
      {
        heading: 'Find the cooling',
        text: 'Crystals need time. When a kiln is opened too early, the surface stays glassy and comparatively plain. The richest spots often come from a firing that cooled over hours rather than minutes.',
      },
      {
        heading: 'Expect the foot',
        text: 'The unglazed base is where the making shows: wheel marks, a line of grit, the colour of the raw clay. It is the least photographed part of a bowl and the fastest way to tell a hand-thrown piece from a moulded one.',
      },
    ],
  },
  {
    slug: 'fire-and-time',
    title: 'Fire and Time',
    kicker: 'Process',
    excerpt:
      'Why a wood-fired kiln still makes sense in an age of electric controllers — and what it costs to use one.',
    readMinutes: 6,
    date: '2025-01-18',
    image: 'kiln-glow',
    body: [
      {
        text: 'A wood kiln is not a more romantic version of an electric one. It is a different instrument. Heat arrives unevenly, ash lands where it lands, and the atmosphere inside the chamber shifts continuously as wood is added and air is drawn through.',
      },
      {
        heading: 'The long shift',
        text: 'Firing takes days rather than hours, with the kiln watched in shifts. Someone has to be present for the climb to temperature and for the slow cool afterwards; the cooling often decides more about the final surface than the peak heat did.',
      },
      {
        heading: 'Accepting the loss',
        text: 'A wood firing yields failures. Bowls crack, glaze runs onto the shelf, and a piece that looked promising in the chamber opens dull. Workable results from a single load are a fraction of what goes in, which is part of why these objects are priced as they are.',
      },
      {
        heading: 'What it leaves behind',
        text: 'Ash deposits, flashing, and small iron blooms are the visible record of that process. They are not defects to be sanded away but the reason the surface cannot be reproduced exactly.',
      },
    ],
  },
  {
    slug: 'caring-for-a-bowl',
    title: 'Caring for a Bowl',
    kicker: 'Care',
    excerpt:
      'Practical notes on using, washing and storing a glazed tea bowl without dulling the surface.',
    readMinutes: 4,
    date: '2024-12-02',
    image: 'tea-pour',
    body: [
      {
        text: 'These bowls are made to be used. A glaze is durable, but it is still glass, and a few habits will keep the surface reading as it did when it left the kiln.',
      },
      {
        heading: 'Washing',
        text: 'Warm water, a soft cloth, no abrasive pad. Avoid sudden temperature change — do not pour boiling water into a cold bowl or run a hot bowl under cold water.',
      },
      {
        heading: 'Drying',
        text: 'Turn the bowl upside down on a cloth and let it air dry fully before putting it away. Trapped moisture in the unglazed foot is the most common cause of a stale smell.',
      },
      {
        heading: 'Storing',
        text: 'Keep pieces from knocking against each other; a soft cloth between bowls is enough. Display out of direct sun, which will slowly shift some glaze colours over years.',
      },
      {
        heading: 'Patina',
        text: 'Fine crackles and a deepening of colour are normal with use. They are not damage, and many collectors regard them as the point.',
      },
    ],
  },
  {
    slug: 'the-case-for-the-object',
    title: 'The Case for the Object',
    kicker: 'Collecting',
    excerpt:
      'On buying fewer things, and buying the ones whose surfaces reward a second and third look.',
    readMinutes: 5,
    date: '2024-11-06',
    image: 'bowl-darkware',
    body: [
      {
        text: 'A collection of five bowls that each change in the light is more interesting than a shelf of fifty that do not. The argument for collecting this way is not about scarcity markets; it is about attention.',
      },
      {
        heading: 'One at a time',
        text: 'Live with a single piece for a season before adding another. You will learn what you actually respond to — surface, weight, the way the rim meets the lip — rather than what photographs well.',
      },
      {
        heading: 'Ask about the firing',
        text: 'Any serious maker can tell you how a piece was fired and roughly when. If that information is unavailable, treat the object as decorative rather than collectible.',
      },
      {
        heading: 'Keep the record',
        text: 'Note the maker, the year and the firing on a card kept with the box. In twenty years it will be the most valuable thing about the object after the object itself.',
      },
    ],
  },
]

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug)
}
