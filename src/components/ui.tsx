import type { ReactNode } from 'react'
import { formatScore, type PvLine } from '../lib/engine/uci'
import { pct } from './format'


/** White / draw / black split, like the Lichess explorer. */
export function WdlBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1
  const seg = (n: number, cls: string) =>
    n / total > 0 ? (
      <div className={`${cls} flex items-center justify-center overflow-hidden`} style={{ width: `${(n / total) * 100}%` }}>
        {n / total >= 0.12 ? pct(n / total) : ''}
      </div>
    ) : null
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-sm text-[10px] leading-none">
      {seg(white, 'bg-[#e8e6e3] text-black')}
      {seg(draws, 'bg-[#8a8784] text-white')}
      {seg(black, 'bg-[#2a2826] text-white')}
    </div>
  )
}

/** Vertical/horizontal evaluation bar (White-relative score). */
export function EvalBar({ line }: { line?: PvLine }) {
  const cp = line ? (line.mate !== undefined ? (line.mate > 0 ? 1000 : -1000) : (line.cp ?? 0)) : 0
  const white = 1 / (1 + Math.exp(-0.004 * cp))
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-sm bg-[#2a2826]">
      <div className="absolute inset-y-0 left-0 bg-[#e8e6e3] transition-all" style={{ width: `${white * 100}%` }} />
      {line && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold mix-blend-difference">
          {formatScore(line)}
        </span>
      )}
    </div>
  )
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

export function ColorDot({ color }: { color: 'white' | 'black' }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full border border-muted ${color === 'white' ? 'bg-[#e8e6e3]' : 'bg-[#111]'}`}
      title={color}
    />
  )
}
