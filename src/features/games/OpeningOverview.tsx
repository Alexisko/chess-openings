import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { pct, resultColor, scoreColor } from '../../components/format'
import { ChevronDown } from '../../components/icons'
import { ResultBar, Section, Stat } from '../../components/ui'
import type { Color } from '../../lib/chess/position'
import type { GameAnalysis, RepIndex } from '../../lib/games/analyze'
import { builderTarget, groupStats, openingGroups, type BuilderTarget, type OpeningGroup } from '../../lib/games/gameTree'
import { useNaming } from '../../lib/openings/naming'

/** Openings with fewer games are folded away until asked for. */
const MIN_GAMES = 2

interface Props {
  analyses: GameAnalysis[]
  color: Color
  reps: RepIndex[]
  onExplore: (line: string[]) => void
}

/** What you play with one colour, grouped by opening, with your results and how well you followed your repertoire. */
export function OpeningOverview({ analyses, color, reps, onExplore }: Props) {
  const naming = useNaming()
  const groups = useMemo(() => (naming ? openingGroups(analyses, naming) : undefined), [analyses, naming])
  const total = useMemo(() => groupStats(analyses), [analyses])

  if (!analyses.length)
    return <p className="text-sm text-muted">No games with {color} for these filters.</p>
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={total.games} label={`games with ${color}`} />
        <Stat value={pct(total.score)} cls={resultColor(total.score)} label={`your score (${total.wdl.win} W · ${total.wdl.draw} D · ${total.wdl.loss} L)`} />
        <Stat value={pct(total.inRep)} label="reached one of your repertoires" />
        <Stat
          value={total.playedRight === null ? '–' : pct(total.playedRight)}
          cls={total.playedRight === null ? 'text-faint' : scoreColor(total.playedRight)}
          label="of those, you played your repertoire moves every time"
        />
      </div>
      <Section title="Openings">
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Games are grouped by the deepest opening name they reached. <b className="font-medium text-ink">In rep</b>: games that
          reached one of your repertoires. <b className="font-medium text-ink">Right</b>: of those, games where you played your
          repertoire move every time. <b className="font-medium text-ink">Prep</b>: your moves played from the repertoire, on
          average.
        </p>
        {!groups ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
              <tr>
                <th className="font-normal">Opening</th>
                <th className="w-12 text-right font-normal sm:w-14">Games</th>
                <th className="w-14 pl-3 font-normal sm:w-36">Score</th>
                <th className="hidden text-right font-normal sm:table-cell sm:w-16">In rep</th>
                <th className="hidden text-right font-normal sm:table-cell sm:w-16">Right</th>
                <th className="hidden text-right font-normal lg:table-cell lg:w-14">Prep</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <GroupRows groups={groups} depth={0} color={color} reps={reps} onExplore={onExplore} />
            </tbody>
          </table>
        )}
      </Section>
    </>
  )
}

function GroupRows({
  groups,
  depth,
  ...rest
}: {
  groups: OpeningGroup[]
  depth: number
  color: Color
  reps: RepIndex[]
  onExplore: (line: string[]) => void
}) {
  const [all, setAll] = useState(false)
  const main = groups.filter((g) => g.stats.games >= MIN_GAMES)
  const rare = groups.length - main.length
  const shown = all || !main.length ? groups : main
  return (
    <>
      {shown.map((g) => (
        <GroupRow key={g.id} group={g} depth={depth} {...rest} />
      ))}
      {shown.length < groups.length && (
        <tr>
          <td colSpan={7} className="py-1.5" style={{ paddingLeft: depth * 14 + 22 }}>
            <button className="text-xs text-muted hover:text-ink" onClick={() => setAll(true)}>
              {rare} more with one game each
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

function GroupRow({
  group: g,
  depth,
  color,
  reps,
  onExplore,
}: {
  group: OpeningGroup
  depth: number
  color: Color
  reps: RepIndex[]
  onExplore: (line: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const s = g.stats
  const target = builderTarget(g.at, g.sans, color, reps)
  const right = s.playedRight === null ? <span className="text-faint">–</span> : <span className={scoreColor(s.playedRight)}>{pct(s.playedRight)}</span>
  return (
    <>
      <tr className={`${depth ? 'border-t border-line/40' : 'border-t border-line/70'} align-middle`}>
        <td className="w-full max-w-0 py-2 pr-2" style={{ paddingLeft: depth * 14 }}>
          <div className="flex min-w-0 items-center gap-1.5">
            {g.children.length ? (
              <button
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:text-ink"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={open ? 'Hide variations' : 'Show variations'}
              >
                <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <button
              className={`min-w-0 truncate text-left hover:text-maple ${depth ? 'italic' : 'font-display text-[15px]'}`}
              title={`${g.fullName} — open in the explorer`}
              onClick={() => onExplore(g.at)}
            >
              {g.label}
            </button>
            {g.eco && depth === 0 && <span className="hidden shrink-0 text-[10px] font-semibold tracking-wide text-brass sm:inline">{g.eco}</span>}
          </div>
          <div className="mt-0.5 truncate pl-6.5 text-[11px] text-muted sm:hidden">
            in rep {s.inRep ? pct(s.inRep) : '–'} · right {right}
          </div>
        </td>
        <td className="text-right tabular-nums">{s.games}</td>
        <td className="pl-3">
          <div className="flex items-center gap-2">
            <ResultBar {...s.wdl} className="hidden flex-1 sm:flex" />
            <span className={`w-9 shrink-0 text-right font-medium tabular-nums ${resultColor(s.score)}`}>{pct(s.score)}</span>
          </div>
        </td>
        <td className="hidden text-right tabular-nums sm:table-cell">{s.inRep ? pct(s.inRep) : <span className="text-faint">–</span>}</td>
        <td className="hidden text-right tabular-nums sm:table-cell">{right}</td>
        <td className="hidden text-right text-muted tabular-nums lg:table-cell">
          {s.avgOwnMoves === null ? <span className="text-faint">–</span> : s.avgOwnMoves.toFixed(1)}
        </td>
        <td className="pl-3 text-right">
          <TargetLink target={target} />
        </td>
      </tr>
      {open && <GroupRows groups={g.children} depth={depth + 1} color={color} reps={reps} onExplore={onExplore} />}
    </>
  )
}

/** Button to the builder (or the plan, or a new repertoire) for a line from your games. */
export function TargetLink({ target, className = 'px-2.5 py-1 text-xs' }: { target: BuilderTarget; className?: string }) {
  const [label, title] =
    target.kind === 'builder'
      ? target.past
        ? ['Extend', `Your ${target.rep.name} line ends before this: prepare it in the builder`]
        : ['Builder', `Open this line in the ${target.rep.name} builder`]
      : target.kind === 'plan'
        ? ['Plan', 'Before your repertoires start: choose your moves in the plan']
        : ['New rep', 'No repertoire covers this line: start one from here']
  return (
    <Link className={`btn-ghost shrink-0 ${className}`} to={target.url} title={title}>
      {label}
    </Link>
  )
}
