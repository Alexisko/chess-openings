import type { ReactNode } from 'react'
import { formatScore, type PvLine } from '../lib/engine/uci'
import { pct, scoreTone } from './format'

/** White / draw / black split, like the Lichess explorer (ivory, oak and ebony). */
export function WdlBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1
  const seg = (n: number, cls: string) =>
    n / total > 0 ? (
      <div className={`${cls} flex items-center justify-center overflow-hidden`} style={{ width: `${(n / total) * 100}%` }}>
        {n / total >= 0.12 ? pct(n / total) : ''}
      </div>
    ) : null
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-[5px] text-[10px] leading-none font-semibold tabular-nums shadow-[0_0_0_1px_rgb(0_0_0/0.35)]">
      {seg(white, 'bg-ivory text-ebony')}
      {seg(draws, 'bg-[#8c7560] text-ivory')}
      {seg(black, 'bg-[#0f0a06] text-ivory/85')}
    </div>
  )
}

/** Horizontal evaluation bar (White-relative score). */
export function EvalBar({ line }: { line?: PvLine }) {
  const cp = line ? (line.mate !== undefined ? (line.mate > 0 ? 1000 : -1000) : (line.cp ?? 0)) : 0
  const white = 1 / (1 + Math.exp(-0.004 * cp))
  return (
    <div className="relative h-3.5 w-full overflow-hidden rounded-[5px] bg-[#0f0a06] shadow-[0_0_0_1px_rgb(0_0_0/0.35)]">
      <div className="absolute inset-y-0 left-0 bg-ivory transition-[width] duration-500" style={{ width: `${white * 100}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-brass/60" />
      {line && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums mix-blend-difference">
          {formatScore(line)}
        </span>
      )}
    </div>
  )
}

export function Section({
  title,
  children,
  right,
  className = '',
}: {
  title: ReactNode
  children: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      <div className="flex min-h-11 items-center gap-2 border-b border-line/70 px-4 py-2.5">
        <h2 className="font-display text-[15px] font-medium tracking-tight">{title}</h2>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** An ivory or ebony piece-like disk marking the colour of a repertoire. */
export function ColorDot({ color, size = 12 }: { color: 'white' | 'black'; size?: number }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${
        color === 'white'
          ? 'bg-[radial-gradient(circle_at_35%_30%,#fffaf0,#e4d3b3_70%)] shadow-[0_0_0_1px_rgb(0_0_0/0.5),inset_0_-1px_1px_rgb(120_90_50/0.5)]'
          : 'bg-[radial-gradient(circle_at_35%_30%,#4a3a2e,#0c0806_70%)] shadow-[0_0_0_1px_rgb(217_170_85/0.45),inset_0_1px_1px_rgb(255_255_255/0.12)]'
      }`}
      style={{ width: size, height: size }}
      title={color}
    />
  )
}

/** Circular gauge for a 0–1 score, coloured from oxblood to moss. */
export function ScoreRing({
  value,
  size = 48,
  stroke = 4,
  label,
}: {
  value: number | null | undefined
  size?: number
  stroke?: number
  label?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value ?? 0
  const tone = value === null || value === undefined ? 'var(--color-faint)' : scoreTone(v)
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, v)))}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span
        className="absolute font-display leading-none font-semibold tabular-nums"
        style={{ fontSize: size * 0.3, color: tone }}
      >
        {label ?? (value === null || value === undefined ? '–' : pct(v))}
      </span>
    </div>
  )
}

/** Big number with a caption, for summary rows. */
export function Stat({ value, label, cls = '' }: { value: ReactNode; label: ReactNode; cls?: string }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface-2/60 px-3 py-3">
      <div className={`font-display text-3xl leading-none font-medium tabular-nums ${cls}`}>{value}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted">{label}</div>
    </div>
  )
}

/** A notice strip (warn, info, bad) with an optional action. */
export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'info' | 'bad'; children: ReactNode }) {
  const cls = {
    warn: 'border-warn/35 bg-warn/8 text-warn',
    info: 'border-info/35 bg-info/8 text-info',
    bad: 'border-bad/40 bg-bad/10 text-bad',
  }[tone]
  return <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>
}

/** A small on/off switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs text-muted hover:text-ink"
    >
      {label}
      <span
        className={`relative inline-block h-[18px] w-8 rounded-full border transition-colors ${
          checked ? 'border-brass/60 bg-brass/30' : 'border-line bg-surface-3'
        }`}
      >
        <span
          className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${
            checked ? 'left-[16px] bg-maple' : 'left-[2px] bg-muted'
          }`}
        />
      </span>
    </button>
  )
}
