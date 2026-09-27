import { useEffect, useMemo, useState } from 'react'
import { pct, resultColor } from '../../components/format'
import { ResultBar, Section } from '../../components/ui'
import { formatMoves, type Color } from '../../lib/chess/position'
import type { GameAnalysis, RepIndex } from '../../lib/games/analyze'
import { builderTarget } from '../../lib/games/gameTree'
import {
  buildOpeningMap,
  defaultMinGames,
  layoutMap,
  MAP_DETAILS,
  type MapMark,
  type MapNode,
  type PlacedNode,
} from '../../lib/games/openingMap'
import { useNaming } from '../../lib/openings/naming'
import { TargetLink } from './OpeningOverview'

interface Props {
  analyses: GameAnalysis[]
  color: Color
  reps: RepIndex[]
  onExplore: (line: string[]) => void
}

const MOVE_FONT = '600 11.5px "Fraunces Variable", Georgia, serif'
const NAME_FONT = 'italic 10.5px "Instrument Sans Variable", system-ui, sans-serif'

let ctx: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, font: string): number {
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 6.5
  ctx.font = font
  return ctx.measureText(text).width
}

/** The moves of the edge into a node, compact: "3.f4 d5 4.fxe5", "2...Nf6 3.f4". */
function edgeTokens(n: MapNode): string[] {
  return n.sans.slice(n.from).map((san, i) => {
    const ply = n.from + i
    const no = Math.floor(ply / 2) + 1
    return ply % 2 === 0 ? `${no}.${san}` : i === 0 ? `${no}...${san}` : san
  })
}

/** The moves, or as many of the last ones as fit after the first one and an ellipsis. */
function fitMoves(tokens: string[], width: number): string {
  const all = tokens.join(' ')
  if (textWidth(all, MOVE_FONT) <= width) return all
  for (let k = tokens.length - 2; k >= 1; k--) {
    const text = `${tokens[0]} … ${tokens.slice(-k).join(' ')}`
    if (textWidth(text, MOVE_FONT) <= width) return text
  }
  return `… ${tokens.at(-1)}`
}

function fitName(name: string, width: number): string {
  if (textWidth(name, NAME_FONT) <= width) return name
  let n = name.length
  while (n > 1 && textWidth(`${name.slice(0, n)}…`, NAME_FONT) > width) n--
  return `${name.slice(0, n).trimEnd()}…`
}

/** Fill for a score: oxblood below 50%, neutral around it, moss above. */
function scoreFill(score: number): string {
  const t = Math.max(-1, Math.min(1, (score - 0.5) / 0.25))
  const tone = t < 0 ? 'var(--color-bad)' : 'var(--color-accent)'
  return `color-mix(in oklab, ${tone} ${Math.round(Math.abs(t) * 100)}%, var(--color-muted))`
}

const RING: Record<MapMark, { stroke: string; dash?: string; label: string } | undefined> = {
  right: { stroke: 'var(--color-accent)', label: 'you played your repertoire moves' },
  deviated: { stroke: 'var(--color-bad)', label: 'you left your repertoire here' },
  unanswered: { stroke: 'var(--color-warn)', dash: '3 2.5', label: 'a move your repertoire has no answer to' },
  none: undefined,
}

/** The inner width of an element (set with the returned ref), following resizes. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      const style = getComputedStyle(el)
      setWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

/**
 * A tech-tree map of your games with one colour: every position where your
 * games branch, sized by games, filled by your score, ringed by how you
 * followed your repertoire on the way there.
 */
export function OpeningMap({ analyses, color, reps, onExplore }: Props) {
  const naming = useNaming()
  const games = useMemo(() => analyses.map((a) => a.game), [analyses])
  const auto = useMemo(() => defaultMinGames(games, color, reps), [games, color, reps])
  const [picked, setPicked] = useState<number>()
  const minGames = picked ?? auto
  const root = useMemo(() => buildOpeningMap(games, color, reps, naming, minGames), [games, color, reps, naming, minGames])
  const [box, fit] = useWidth()
  const layout = useMemo(
    () =>
      root &&
      layoutMap(
        root,
        (n) => Math.max(textWidth(edgeTokens(n).join(' '), MOVE_FONT), n.newName ? textWidth(n.newName, NAME_FONT) : 0),
        { fit },
      ),
    [root, fit],
  )
  const [hover, setHover] = useState<MapNode>()
  const active = layout?.nodes.find((p) => p.node === hover) ?? layout?.nodes[0]
  const onPath = useMemo(() => {
    const set = new Set<PlacedNode>()
    for (let p = active; p; p = p.parent) set.add(p)
    return set
  }, [active])

  if (!games.length) return <p className="text-sm text-muted">No games with {color} for these filters.</p>
  if (!root || !layout || !active) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
  const details = MAP_DETAILS.filter((m) => m <= Math.max(2, games.length / 2))

  return (
    <Section
      title="Opening map"
      right={
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden lg:inline">Branches of at least</span>
          {details.map((m) => (
            <button key={m} className={`chip px-2 py-0.5 ${m === minGames ? 'chip-on' : ''}`} onClick={() => setPicked(m)}>
              {m}
            </button>
          ))}
          <span>games</span>
        </div>
      }
    >
      <NodeInfo node={active.node} total={root.games.length} color={color} reps={reps} onExplore={onExplore} />
      <div ref={box} className="-mx-4 overflow-x-auto px-4">
        <svg
          width={layout.width}
          height={layout.height}
          className="block select-none"
          role="tree"
          aria-label={`Opening map of your games with ${color}`}
          onMouseLeave={() => setHover(undefined)}
        >
          {layout.nodes.map((p) => p.parent && <Edge key={`e${p.node.path.join()}`} p={p} total={root.games.length} lit={onPath.has(p)} />)}
          {layout.nodes.map((p) => (
            <Node
              key={p.node.path.join()}
              p={p}
              lit={p === active}
              onHover={() => setHover(p.node)}
              onOpen={() => onExplore(p.node.path)}
            />
          ))}
        </svg>
      </div>
      <Legend />
    </Section>
  )
}

function Edge({ p, total, lit }: { p: PlacedNode; total: number; lit: boolean }) {
  const parent = p.parent!
  const n = p.node
  const width = 1.25 + 4.5 * (n.games.length / total)
  const d =
    p.y === parent.y
      ? `M${parent.x},${parent.y} H${p.x}`
      : `M${parent.x},${parent.y} V${p.y - 10} Q${parent.x},${p.y} ${parent.x + 10},${p.y} H${p.x}`
  const moves = fitMoves(edgeTokens(n), p.labelWidth)
  const name = n.newName && fitName(n.newName, p.labelWidth)
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={lit ? 'var(--color-brass)' : 'var(--color-line-strong)'}
        strokeWidth={width}
        strokeLinecap="round"
        opacity={lit ? 1 : 0.85}
      />
      {p.labelWidth > 12 && (
        <text
          x={p.labelX}
          y={p.y - 7}
          style={{ font: MOVE_FONT }}
          fill={lit ? 'var(--color-ink)' : 'var(--color-muted)'}
        >
          {moves}
        </text>
      )}
      {name && p.labelWidth > 20 && (
        <text x={p.labelX} y={p.y + 15} style={{ font: NAME_FONT }} fill={lit ? 'var(--color-brass)' : 'var(--color-faint)'}>
          {name}
        </text>
      )}
    </g>
  )
}

function Node({ p, lit, onHover, onOpen }: { p: PlacedNode; lit: boolean; onHover: () => void; onOpen: () => void }) {
  const n = p.node
  const ring = RING[n.mark]
  const label = `${n.sans.length ? formatMoves(n.sans) : 'Starting position'}: ${n.games.length} games, score ${pct(n.score)}`
  return (
    <g
      role="treeitem"
      tabIndex={0}
      aria-label={label}
      className="cursor-pointer outline-none"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* A larger invisible target, so small nodes are easy to hit. */}
      <circle cx={p.x} cy={p.y} r={Math.max(p.r + 6, 12)} fill="transparent" />
      {lit && <circle cx={p.x} cy={p.y} r={p.r + 7.5} fill="none" stroke="var(--color-brass)" strokeWidth={1.5} opacity={0.9} />}
      {ring && (
        <circle cx={p.x} cy={p.y} r={p.r + 3} fill="var(--color-surface)" stroke={ring.stroke} strokeWidth={2.25} strokeDasharray={ring.dash} />
      )}
      <circle cx={p.x} cy={p.y} r={p.r} fill={scoreFill(n.score)} stroke="var(--color-surface)" strokeWidth={ring ? 0 : 1.5} />
    </g>
  )
}

function NodeInfo({
  node: n,
  total,
  color,
  reps,
  onExplore,
}: {
  node: MapNode
  total: number
  color: Color
  reps: RepIndex[]
  onExplore: (line: string[]) => void
}) {
  const ring = RING[n.mark]
  return (
    // Sticks under the app header, so it stays in view while you hover a tall map.
    <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 mb-3 flex min-h-[4.5rem] flex-wrap items-start gap-x-6 gap-y-2 rounded-lg border border-line/60 bg-surface-2 px-3 py-2.5 shadow-lg shadow-black/20">
      <div className="min-w-0 flex-1 basis-72">
        <div className="truncate font-display text-sm font-semibold">{n.sans.length ? formatMoves(n.sans) : 'Starting position'}</div>
        <div className="mt-0.5 truncate text-xs text-muted italic">{n.opening ?? ' '}</div>
        <div className="mt-1 text-[11px] text-muted">
          {ring ? <span style={{ color: ring.stroke }}>On the way: {ring.label}.</span> : 'No repertoire covers the moves on the way here.'}
          {n.rare > 0 && n.children.length > 0 && ` ${n.rare} game${n.rare === 1 ? '' : 's'} went into rarer lines.`}
        </div>
      </div>
      <div className="flex w-56 flex-col gap-1.5 text-xs text-muted">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg leading-none font-medium text-ink tabular-nums">{n.games.length}</span>
          games · {pct(n.games.length / total)}
          <span className={`ml-auto font-semibold tabular-nums ${resultColor(n.score)}`}>{pct(n.score)}</span>
        </div>
        <ResultBar {...n.wdl} />
      </div>
      <div className="flex shrink-0 gap-2 self-center">
        <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onExplore(n.path)}>
          Explorer
        </button>
        <TargetLink target={builderTarget(n.path, n.sans, color, reps)} />
      </div>
    </div>
  )
}

function Legend() {
  const dot = (mark: MapMark, text: string) => {
    const ring = RING[mark]
    return (
      <span className="flex items-center gap-1.5">
        <svg width={16} height={16} aria-hidden>
          <circle cx={8} cy={8} r={6} fill="var(--color-surface)" stroke={ring?.stroke ?? 'var(--color-line-strong)'} strokeWidth={ring ? 2 : 1} strokeDasharray={ring?.dash} />
          <circle cx={8} cy={8} r={3.5} fill="var(--color-muted)" />
        </svg>
        {text}
      </span>
    )
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/60 pt-3 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <svg width={34} height={16} aria-hidden>
          <circle cx={5} cy={8} r={3} fill="var(--color-muted)" />
          <circle cx={23} cy={8} r={7} fill="var(--color-muted)" />
        </svg>
        size: games
      </span>
      <span className="flex items-center gap-1.5">
        fill: your score
        <span className="flex items-center gap-1 tabular-nums">
          25%
          <span
            className="h-2 w-16 rounded-full"
            style={{ background: `linear-gradient(90deg, ${scoreFill(0.25)}, ${scoreFill(0.5)}, ${scoreFill(0.75)})` }}
          />
          75%
        </span>
      </span>
      {dot('right', 'your repertoire moves')}
      {dot('deviated', 'you left it')}
      {dot('unanswered', 'no answer prepared')}
      {dot('none', 'not in a repertoire')}
      <span className="ml-auto">Click a position to open it in the Explorer.</span>
    </div>
  )
}
