import type { SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  'aria-hidden': true,
  focusable: false,
}

export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 12h17M14 5.5 20.5 12 14 18.5" />
  </svg>
)

export const ArrowDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3v18M5.5 14.5 12 21l6.5-6.5" />
  </svg>
)

export const ArrowUpRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 18 18 6M8 6h10v10" />
  </svg>
)

export const Heart = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base} {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7.2-4.6-9-9.1C1.8 7.4 3.8 4.5 6.9 4.5c2 0 3.6 1.2 5.1 3.1 1.5-1.9 3.1-3.1 5.1-3.1 3.1 0 5.1 2.9 3.9 6.4-1.8 4.5-9 9.1-9 9.1Z" />
  </svg>
)

export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 4v16M4 12h16" />
  </svg>
)

export const Minus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 12h16" />
  </svg>
)

export const Close = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
)

export const Menu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 7h18M3 12h18M3 17h18" />
  </svg>
)

export const Expand = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
  </svg>
)

export const Search = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)

export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="m4.5 12.5 5 5L20 6.5" />
  </svg>
)

export const Bag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4.5 8h15l-1.2 12.5H5.7L4.5 8Z" />
    <path d="M8.5 8V6.2a3.5 3.5 0 0 1 7 0V8" />
  </svg>
)

export const Info = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.6v.9" />
  </svg>
)

export const ScrollIndicator = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} viewBox="0 0 24 40" width={18} height={30} {...p}>
    <rect x="1" y="1" width="22" height="38" rx="11" />
    <path d="M12 8v8" strokeLinecap="round" />
  </svg>
)
