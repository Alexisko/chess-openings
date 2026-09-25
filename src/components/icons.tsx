import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Stroke icons on a 24×24 grid, drawn in the current text colour. */
function Svg({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  )
}

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h13V9" />
      <path d="M10 20v-5.5h4V20" />
    </Svg>
  )
}

export function TrainIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
      <path d="m9 12.2 2 2 4-4.4" />
    </Svg>
  )
}

/** A pawn. */
export function GamesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="6.5" r="2.8" />
      <path d="M9.2 11h5.6" />
      <path d="M10.3 11c0 3-1 5.6-2.8 7.5h9c-1.8-1.9-2.8-4.5-2.8-7.5" />
      <path d="M6 20.5h12" />
    </Svg>
  )
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  )
}

export function FirstIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 18l-6-6 6-6M7 6v12" />
    </Svg>
  )
}

export function PrevIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  )
}

export function NextIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  )
}

export function LastIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 18l6-6-6-6M17 6v12" />
    </Svg>
  )
}

export function ChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

export function ArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  )
}

export function ArrowLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  )
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  )
}

export function CrossIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  )
}

export function SkipIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 6l7 6-7 6M13 6l7 6-7 6" />
    </Svg>
  )
}

export function BookIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h13v14H6a2 2 0 0 0-2 2z" />
      <path d="M4 19.5a2 2 0 0 0 2 2h13v-4" />
    </Svg>
  )
}

export function BoltIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" />
    </Svg>
  )
}

export function TargetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </Svg>
  )
}

export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Svg>
  )
}

export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </Svg>
  )
}
