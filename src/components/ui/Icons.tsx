import type { SVGProps } from 'react'

/**
 * ICONS
 * ------------------------------------------------------------------
 * Hand-drawn 24×24 line icons on a 1.25 stroke. No icon font, no sprite
 * request: they inherit `currentColor`, so a button's colour transition
 * moves the icon with it.
 *
 * Decorative by default. Pass a `title` only when the icon carries meaning
 * on its own; otherwise the surrounding control supplies the label.
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Accessible name. Omit for icons inside an already-labelled control. */
  title?: string
  size?: number
}

function Icon({
  title,
  size = 16,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/* ---------------- Navigation ---------------- */

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </Icon>
  )
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </Icon>
  )
}

export function ArrowDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v15" />
      <path d="M6 13l6 6 6-6" />
    </Icon>
  )
}

/** A slow vertical drift used as the hero's scroll cue. */
export function ScrollIndicator({ size = 18, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 1v30" opacity="0.35" />
      <path d="M6 26l6 7 6-7" />
    </svg>
  )
}

/* ---------------- Commerce ---------------- */

export function Bag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 8h15l-1 12.5h-13L4.5 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  )
}

export function Heart({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Icon {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 3c0 4.8-7.5 9.4-7.5 9.4z" />
    </Icon>
  )
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  )
}

export function Minus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  )
}

/* ---------------- Controls ---------------- */

export function Close(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Icon>
  )
}

export function Search(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Icon>
  )
}

export function Expand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M15 20h5v-5" />
      <path d="M9 20H4v-5" />
    </Icon>
  )
}

export function ZoomIn(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </Icon>
  )
}

export function ZoomOut(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
      <path d="M8 11h6" />
    </Icon>
  )
}

/* ---------------- Status ---------------- */

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  )
}

export function Info(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Icon>
  )
}

export function Alert(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5l8 14.5H4l8-14.5z" />
      <path d="M12 10v4.5" />
      <path d="M12 17h.01" />
    </Icon>
  )
}
