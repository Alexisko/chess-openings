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

/** A line branching into two: a repertoire's tree of moves. */
export function RepertoireIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="19" r="2" />
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10" />
      <path d="M6 15c0-4 3-5.5 10.2-6.4" />
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

export function PencilIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </Svg>
  )
}

export function ExternalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Svg>
  )
}

/** The daily streak. */
export function FlameIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21.5c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.5 1.6 1.2 2.7 2.4 3.4C11.8 7 13 4.4 15.6 2.5c-.3 3 1 4.6 2.2 6.3 1 1.5 1.7 3 1.7 5.1 0 4.6-3.3 7.6-7.5 7.6z" />
      <path d="M12 21.5c-1.7 0-3-1.2-3-3 0-2 1.6-2.9 2.3-4.6.9 1 1.6 1.5 2.3 1.8.4-.8.8-1.3 1.4-1.8.4 1 1 2 1 3.4 0 2.4-1.7 4.2-4 4.2z" />
    </Svg>
  )
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Svg>
  )
}

/** A phone with an arrow into it: install the app. */
export function InstallIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 7v7M9 11.5l3 3 3-3M10.5 18.5h3" />
    </Svg>
  )
}

/** Safari's Share button: a box with an arrow out of it. */
export function ShareIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v12M8 6.5 12 2.5l4 4" />
      <path d="M8.5 10H6.5v11h11V10h-2" />
    </Svg>
  )
}
