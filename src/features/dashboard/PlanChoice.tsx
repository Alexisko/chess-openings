import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { pct } from '../../components/format'
import { createRepertoire, findOverlaps } from '../../db/repertoire'
import { db } from '../../db/schema'
import { setPlanChoice } from '../../db/settings'
import { formatMoves, type Color } from '../../lib/chess/position'
import { startOf, startsWith } from '../../lib/chess/start'
import { confirmOverlap } from '../../lib/dialog'
import { moveShare, totalGames, type ExplorerData } from '../../lib/explorer'
import type { ResolvedOption, Style, Theory } from '../../lib/openings/catalog'
import { scoreFor, type DecisionNode } from '../../lib/plan/plan'
import { builderUrl } from '../../lib/routes'

const STYLE_CLS: Record<Style, string> = {
  solid: 'border-info/40 text-info',
  active: 'border-accent/40 text-accent',
  sharp: 'border-bad/40 text-bad',
  gambit: 'border-warn/40 text-warn',
}
const THEORY_LABEL: Record<Theory, string> = { light: 'little theory', medium: 'some theory', heavy: 'lots of theory' }

/** A repertoire name for an option: move-like names get the slot's opponent in front. */
function repName(title: string, option: ResolvedOption) {
  if (!/\d/.test(option.name)) return option.name
  const vs = title.replace(/^(Against|Your answer to|Your defence to|Your system against)\s+/, 'vs ')
  return `${vs}: ${option.name}`
}

/** Creates a repertoire of a colour (after the overlap warning) and opens the builder on a line. */
function useCreateRepertoire(color: Color) {
  const navigate = useNavigate()
  return useCallback(
    async (name: string, startUci: string[], lineUci: string[]) => {
      const overlaps = await findOverlaps(color, startUci)
      if (overlaps.length && !(await confirmOverlap(overlaps.map((r) => r.name)))) return
      const rep = await createRepertoire(name, color, undefined, startUci)
      navigate(builderUrl(rep.id, lineUci))
    },
    [color, navigate],
  )
}

/**
 * The ways to answer an open choice of the plan: the catalogue's options,
 * other moves played there, or a repertoire of your own from this position.
 */
export function DecisionChoices({ node, color, explorer }: { node: DecisionNode; color: Color; explorer: Map<string, ExplorerData> }) {
  const create = useCreateRepertoire(color)
  const games = useLiveQuery(() => db.games.toArray().then((g) => g.filter((x) => x.color === color)), [color])
  const here = explorer.get(node.key)
  const optionMoves = new Set(node.slot?.options.map((o) => o.uci))
  const total = here ? totalGames(here) : 0
  const otherMoves = (here?.moves ?? [])
    .map((m) => ({ ...m, share: total ? totalGames(m) / total : 0 }))
    .filter((m) => m.share >= 0.02 && !optionMoves.has(m.uci))
    .slice(0, 6)
  const name = here?.opening?.name

  return (
    <div className="flex flex-col gap-3">
      {node.slot && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {node.slot.options.map((o) => (
            <OptionCard
              key={o.name}
              option={o}
              node={node}
              color={color}
              explorer={explorer}
              played={games?.filter((g) => startsWith(g.moves, o.startUci)).length ?? 0}
              onCreate={create}
            />
          ))}
        </div>
      )}
      {otherMoves.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs text-muted">{node.slot ? 'Other moves played here' : 'Moves played here'}</div>
          <div className="flex flex-wrap gap-1.5">
            {otherMoves.map((m) => {
              const s = scoreFor(color, m)
              return (
                <button
                  key={m.uci}
                  className="chip py-1.5"
                  title="Play this move and choose answers to the replies"
                  onClick={() => setPlanChoice(color, node.key, m.uci)}
                >
                  <span className="font-display text-sm font-medium text-ink">{formatMoves([m.san], node.path.length)}</span>
                  <span className="tabular-nums">
                    {pct(m.share)}
                    {s !== null && ` · scores ${pct(s)}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="text-xs text-muted">
        <button
          className="underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-current"
          onClick={() => create(name ? `vs ${name}` : node.title, node.path, node.path)}
        >
          Build your own repertoire from here
        </button>
        {!node.slot && !here && <span className="ml-2">(waiting for opponent statistics to suggest moves)</span>}
      </div>
    </div>
  )
}

function OptionCard({
  option: o,
  node,
  color,
  explorer,
  played,
  onCreate,
}: {
  option: ResolvedOption
  node: DecisionNode
  color: Color
  explorer: Map<string, ExplorerData>
  /** Your games that reached this option. */
  played: number
  onCreate: (name: string, startUci: string[], lineUci: string[]) => void
}) {
  // Popularity and score of the move that defines the option, where it is played.
  const before = startOf(o.startUci.slice(0, -1))
  const data = explorer.get(before.key)
  const defining = o.startUci.at(-1)!
  const share = moveShare(data, defining)
  const stats = data?.moves.find((m) => m.uci === defining)
  const score = stats ? scoreFor(color, stats) : null
  const line = startOf(o.lineUci).sans.slice(node.path.length)
  const definingSan = formatMoves([startOf(o.startUci).sans.at(-1)!], o.startUci.length - 1)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-surface/70 p-3.5 transition hover:border-line-strong">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[17px] leading-tight font-medium">{o.name}</span>
        <span className="ml-auto flex shrink-0 gap-1 text-[11px] font-medium">
          <span className={`rounded-full border px-1.5 ${STYLE_CLS[o.style]}`}>{o.style}</span>
          <span className="rounded-full border border-line-strong px-1.5 text-muted">{THEORY_LABEL[o.theory]}</span>
        </span>
      </div>
      <div className="font-display text-sm text-maple">{formatMoves(line, node.path.length)}</div>
      <p className="text-xs leading-relaxed text-ink/85">{o.about}</p>
      <div className="text-[11px] text-muted">
        {share !== undefined && (
          <>
            {definingSan} is played in {pct(share)} of games
            {score !== null && `, scores ${pct(score)}`}
          </>
        )}
        {played > 0 && (
          <span className="text-info">
            {share !== undefined && ' · '}
            you played it in {played} game{played > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <button
        className={`${o.kind === 'branch' ? 'btn-ghost' : 'btn-primary'} mt-auto px-2.5 py-1.5 text-xs`}
        onClick={() =>
          o.kind === 'branch' ? setPlanChoice(color, node.key, o.uci) : onCreate(repName(node.title, o), o.startUci, o.lineUci)
        }
      >
        {o.kind === 'branch' ? `Play ${formatMoves([o.san], node.path.length)}` : 'Build this repertoire'}
      </button>
    </div>
  )
}
