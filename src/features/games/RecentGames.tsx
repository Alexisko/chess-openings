import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { pct, resultColor, scoreColor } from '../../components/format'
import { ColorDot, Section, Stat } from '../../components/ui'
import { keyToFen } from '../../lib/chess/position'
import { gameKeys, scoreOf, type GameAnalysis, type RepIndex } from '../../lib/games/analyze'
import { usePositionEvals, type EvalRequest } from '../../lib/games/gameEval'
import { wdlOf } from '../../lib/games/gameTree'
import {
  evalTone,
  exitPly,
  formatEval,
  gameOpening,
  OPENING_MOVES,
  openingPly,
  prepSummary,
  type PosEval,
} from '../../lib/games/review'
import { useNaming } from '../../lib/openings/naming'
import { gameUrl } from '../../lib/routes'
import { EvalChip, PrepMoves, ResultBadge } from './GameBadges'

const PAGE = 20
const DAY = 24 * 3600 * 1000

/** Positions to evaluate for a game: where it left your prep, then where the opening ends. */
function evalTargets(a: GameAnalysis): { exit?: string; opening: string } {
  const keys = gameKeys(a.game)
  const exit = exitPly(a)
  return { exit: exit === undefined ? undefined : keys[exit + 1], opening: keys[openingPly(a.game)] }
}

/** Your latest games, newest first: how far your preparation went and what you got out of the opening. */
export function RecentGames({ analyses, reps }: { analyses: GameAnalysis[]; reps: RepIndex[] }) {
  const [shown, setShown] = useState(PAGE)
  const naming = useNaming()
  const list = useMemo(() => [...analyses].sort((a, b) => b.game.playedAt - a.game.playedAt).slice(0, shown), [analyses, shown])
  const requests = useMemo(
    () =>
      list.flatMap((a): EvalRequest[] => {
        const t = evalTargets(a)
        return [...(t.exit ? [{ fen: keyToFen(t.exit) }] : []), { fen: keyToFen(t.opening) }]
      }),
    [list],
  )
  const { evals, pending } = usePositionEvals(requests)
  const repName = useMemo(() => new Map(reps.map((r) => [r.rep.id, r.rep.name])), [reps])

  if (!analyses.length) return <p className="text-sm text-muted">No games for these filters.</p>

  const games = list.map((a) => a.game)
  const wdl = wdlOf(games)
  const score = scoreOf(games)
  const inRep = list.filter((a) => a.repertoireId)
  const right = inRep.length ? inRep.filter((a) => a.outcome !== 'forgot').length / inRep.length : null
  const avgMoves = inRep.length ? inRep.reduce((s, a) => s + a.ownMoves, 0) / inRep.length : null
  const outOfOpening = list.flatMap((a) => {
    const e = evals.get(evalTargets(a).opening)
    return e ? [evalTone(e, a.game.color)] : []
  })
  const ahead = outOfOpening.filter((t) => t === 'ahead').length
  const behind = outOfOpening.filter((t) => t === 'behind').length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={pct(score)} cls={resultColor(score)} label={`score in the last ${list.length} games (${wdl.win} W · ${wdl.draw} D · ${wdl.loss} L)`} />
        <Stat
          value={right === null ? '–' : pct(right)}
          cls={right === null ? 'text-faint' : scoreColor(right)}
          label={`played your repertoire moves every time (${inRep.length} games in a repertoire)`}
        />
        <Stat value={avgMoves === null ? '–' : avgMoves.toFixed(1)} label="of your moves played from your prep, on average" />
        <Stat
          value={outOfOpening.length ? `${ahead} / ${outOfOpening.length}` : '…'}
          cls={ahead > behind ? 'text-accent' : behind > ahead ? 'text-bad' : ''}
          label={`ahead after move ${OPENING_MOVES} (${behind} behind)${pending ? ', evaluating…' : ''}`}
        />
      </div>

      <Section
        title="Recent games"
        right={pending > 0 && <span className="animate-pulse text-xs text-muted">Evaluating {pending} positions…</span>}
      >
        <p className="mb-3 text-xs leading-relaxed text-muted">
          <b className="font-medium text-ink">Prep</b>: your moves played from your repertoire, and how the game left it.{' '}
          <b className="font-medium text-ink">Move {OPENING_MOVES}</b>: the engine's evaluation from your side once the opening is over
          (or where the game ended, if sooner); below it, the evaluation right after the game left your prep. Open a game to review it
          move by move and extend your lines.
        </p>
        <ul className="flex flex-col gap-2">
          {list.map((a) => {
            const t = evalTargets(a)
            return (
              <GameRow
                key={a.game.id}
                a={a}
                opening={naming ? gameOpening(a.game, naming)?.name : undefined}
                repName={a.repertoireId ? repName.get(a.repertoireId) : undefined}
                exitEval={t.exit ? evals.get(t.exit) : null}
                openingEval={evals.get(t.opening)}
              />
            )
          })}
        </ul>
        {analyses.length > shown && (
          <button className="chip mt-3" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, analyses.length - shown)} more
          </button>
        )}
      </Section>
    </>
  )
}

function GameRow({
  a,
  opening,
  repName,
  exitEval,
  openingEval,
}: {
  a: GameAnalysis
  opening?: string
  repName?: string
  /** undefined while evaluating, null when there is nothing to evaluate. */
  exitEval: PosEval | null | undefined
  openingEval: PosEval | null | undefined
}) {
  const g = a.game
  const exit = exitPly(a)
  return (
    <li>
      <Link
        to={gameUrl(g.id)}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2.5 transition hover:border-brass/50 hover:bg-surface-2"
      >
        <ResultBadge result={g.result} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <ColorDot color={g.color} size={10} />
            <span className="truncate font-medium">{g.opponent}</span>
            {g.opponentRating && <span className="hidden shrink-0 text-xs text-muted tabular-nums sm:inline">{g.opponentRating}</span>}
            <span className="hidden shrink-0 text-xs text-faint sm:inline">
              · {g.speed} · {g.source === 'lichess' ? 'Lichess' : 'Chess.com'}
            </span>
            <span className="ml-auto shrink-0 pl-2 text-xs text-faint">{ago(g.playedAt)}</span>
          </div>
          <div className="truncate font-display text-[13px] text-muted italic">{opening ?? '…'}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <PrepMoves a={a} className="shrink-0" />
            {repName && <span className="hidden shrink-0 text-muted sm:inline">in {repName} ·</span>}
            <span className={`truncate ${a.outcome === 'forgot' ? 'text-bad' : 'text-muted'}`}>{prepSummary(a)}</span>
          </div>
        </div>
        <div className="flex w-16 flex-col items-end gap-1 text-right">
          <EvalChip e={openingEval} color={g.color} title={`Evaluation after move ${OPENING_MOVES} (or the last stored move)`} />
          {exit !== undefined && (
            <span className="text-[10px] text-muted tabular-nums" title="Evaluation right after the game left your prep">
              prep {exitEval ? formatEval(exitEval, g.color) : exitEval === null ? '–' : '…'}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

function ago(t: number): string {
  const ms = Date.now() - t
  if (ms < 3600 * 1000) return `${Math.max(1, Math.round(ms / 60000))} min ago`
  if (ms < DAY) return `${Math.round(ms / 3600000)} h ago`
  const days = Math.floor(ms / DAY)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(t).toLocaleDateString()
}
