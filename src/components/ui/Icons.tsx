import type { ReactNode, SVGProps } from 'react'

/**
 * ICONS
 * ------------------------------------------------------------------
 * Hand-drawn 24x24 line icons. No icon library: the set is small, the
 * stroke weight has to match the typography, and a dependency would cost
 * more than it saves.
 *
 * Every icon is decorative by default (`aria-hidden`), because each one
 * sits inside a control that already carries a text label or an
 * `aria-label`. Passing `aria-hidden={false}` opts into being announced.
 */

export type IconProps = SVGProps<SVGSVGElement> & { filled?: boolean }

interface BaseProps extends IconProps {
  children: ReactNode
}

function Svg({ children, filled, width = 18, height = 18, strokeWidth = 1.4, ...rest }: BaseProps) {
  void filled
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function ArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  )
}

export function ArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Svg>
  )
}

export function ArrowDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v15" />
      <path d="m6 13 6 6 6-6" />
    </Svg>
  )
}

export function ChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 5-7 7 7 7" />
    </Svg>
  )
}

export function ChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  )
}

export function Close(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </Svg>
  )
}

export function Check(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Svg>
  )
}

export function Info(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Svg>
  )
}

export function Alert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4 3 20h18L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function Expand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M15 20h5v-5" />
      <path d="M9 20H4v-5" />
    </Svg>
  )
}

export function Heart({ filled = false, ...props }: IconProps) {
  return (
    <Svg {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20Z" />
    </Svg>
  )
}

export function Search(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Svg>
  )
}

export function Bag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Svg>
  )
}

export function Menu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h16" />
      <path d="M4 16h16" />
    </Svg>
  )
}

export function Minus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function Plus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

/**
 * Scroll affordance for the hero. A line with a travelling dot, not a
 * generic chevron — it reads as a seam in the clay rather than UI chrome.
 */
export function ScrollIndicator(props: IconProps) {
  return (
    <Svg {...props} width={14} height={42} viewBox="0 0 14 42">
      <path d="M7 0v26" opacity="0.45" />
      <path d="m2 22 5 5 5-5" />
    </Svg>
  )
}
