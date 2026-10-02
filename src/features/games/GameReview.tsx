import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Board, type Arrow } from '../../components/Board'
import { ArrowLeft, ExternalIcon, FirstIcon, LastIcon, NextIcon, PrevIcon } from '../../components/icons'
import { ColorDot, Section } from '../../components/ui'
import { loadRepIndex } from '../../db/games'
import { db, type Game } from '../../db/schema'
import { GLYPH_NAMES, GLYPH_TONE, type Glyph } from '../../lib/chess/glyphs'
import { moveSquares, playUci, positionKey, replay, START_FEN, turnOf } from '../../lib/chess/position'
import { analyzeGame, type GameAnalysis, type RepIndex } from '../../lib/games/analyze'
import { usePositionEvals } from '../../lib/games/gameEval'
import { activeReps, builderTarget, type BuilderTarget } from '../../lib/games/gameTree'
import { MAX_PLIES } from '../../lib/games/parse'
import {
  chancesFor,
  exitPly,
  gameOpening,
  moveGlyph,
  moveNumber,
  numbered,
  OPENING_MOVES,
  openingPly,
  prepSummary,
  reviewMoves,
  type PosEval,
  type ReviewMark,
  type ReviewMove,
} from '../../lib/games/review'
import { useNaming } from '../../lib/openings/naming'
import { trainUrl } from '../../lib/routes'
import { EvalChip, PrepMoves, ResultBadge } from './GameBadges'

const MARK_CLS: Record<ReviewMark, string> = {
  start: 'text-muted',
  rep: 'text-accent',
  forgot: 'bg-bad/15 font-semibold text-bad',
  'opp-left': 'bg-info/15 font-semibold text-info',
  ended: 'bg-warn/15 font-semibold text-warn',
  uncovered: 'bg-surface-3 font-semibold text-ink',
  after: 'text-ink',
}

/** One of your games, move by move: where it left your preparation, what the engine thinks, and links to extend your lines. */
export function GameReview() {
  const { id = '' } = useParams()
  const game = useLiveQuery(() => db.games.get(id).then((g) => g ?? null), [id])
  const reps = useLiveQuery(() => loadRepIndex(), [])
  if (game === undefined || !reps) return null
  if (game === null)
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <p className="text-sm text-muted">This game isn't on this device. Import your games first.</p>
      </div>
    )
  return <Review game={game} reps={reps} />
}

function BackLink() {
  return (
    <Link to="/games?tab=recent" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-brass">
      <ArrowLeft size={14} /> Recent games
    </Link>
  )
}

function Review({ game, reps }: { game: Game; reps: RepIndex[] }) {
  const naming = useNaming()
  const a = useMemo(() => analyzeGame(game, reps), [game, reps])
  const moves = useMemo(() => reviewMoves(a, reps), [a, reps])
  const fens = useMemo(() => [START_FEN, ...replay(game.moves).map((m) => m.fen)], [game])
  const keys = useMemo(() => fens.map(positionKey), [fens])
  const n = game.moves.length
  const exit = exitPly(a)
  const color = game.color

  // The position shown (= moves played) lives in the URL. A game opens where it left your
  // prep, before the move that left it: your repertoire move and the one played show as arrows.
  const [params, setParams] = useSearchParams()
  const asked = Number(params.get('ply'))
  const cursor = params.has('ply') && Number.isInteger(asked) ? Math.max(0, Math.min(n, asked)) : Math.min(a.ply, n)
  const go = (ply: number) => setParams({ ply: String(Math.max(0, Math.min(n, ply))) }, { replace: true })

  const requests = useMemo(() => fens.map((fen, i) => ({ fen, parent: i ? keys[i - 1] : undefined })), [fens, keys])
  const { evals, pending } = usePositionEvals(requests)
  const evalAt = (ply: number) => evals.get(keys[ply])
  const glyphs = moves.map((m) => {
    const before = evalAt(m.ply)
    const after = evalAt(m.ply + 1)
    return before && after ? moveGlyph(before, after, m.uci, m.ply % 2 ? 'black' : 'white') : undefined
  })

  const keyActions = useRef({ go, cursor })
  useEffect(() => {
    keyActions.current = { go, cursor }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey) return
      const { go, cursor } = keyActions.current
      if (e.key === 'ArrowLeft') go(cursor - 1)
      else if (e.key === 'ArrowRight') go(cursor + 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(Infinity)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fen = fens[cursor]
  const key = keys[cursor]
  const here = evalAt(cursor)
  const next = moves[cursor] as ReviewMove | undefined
  const rep = a.repertoireId ? reps.find((r) => r.rep.id === a.repertoireId) : undefined
  // Repertoire moves at this position (from the repertoire the game reached, else any of your colour).
  const repMoves = (rep ? [rep] : activeReps(key, reps.filter((r) => r.rep.color === color))).flatMap((r) => r.graph.movesFrom.get(key) ?? [])
  const myTurn = turnOf(fen) === color

  const arrows: Arrow[] = []
  if (myTurn)
    for (const m of repMoves) {
      const sq = moveSquares(fen, m.uci)
      if (sq) arrows.push({ from: sq[0], to: sq[1], brush: 'green' })
    }
  if (next?.mark === 'forgot') {
    const sq = moveSquares(fen, next.uci)
    if (sq) arrows.push({ from: sq[0], to: sq[1], brush: 'red' })
  }
  if (here?.best && !repMoves.some((m) => m.uci === here.best)) {
    const sq = moveSquares(fen, here.best)
    if (sq) arrows.push({ from: sq[0], to: sq[1], brush: 'blue' })
  }
  const lastMove = cursor ? (moveSquares(fens[cursor - 1], game.moves[cursor - 1]) ?? undefined) : undefined
  const lastGlyph = cursor ? glyphs[cursor - 1] : undefined

  const opening = naming ? gameOpening(game, naming) : undefined
  const exitEval = exit === undefined ? undefined : evalAt(exit + 1)
  const openingEval = evalAt(openingPly(game))

  return (
    <div className="stagger flex flex-col gap-5">
      <BackLink />
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <ResultBadge result={game.result} size="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="flex items-center gap-2 font-display text-xl font-medium tracking-tight">
              <ColorDot color={color} />
              vs {game.opponent}
            </h1>
            {game.opponentRating && <span className="text-sm text-muted tabular-nums">{game.opponentRating}</span>}
            <span className="text-xs text-faint">
              {game.speed} · {new Date(game.playedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <div className="truncate font-display text-sm text-muted italic">{opening?.name ?? ' '}</div>
        </div>
        <a
          href={game.url}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost self-start px-3 py-1.5 text-xs"
          title={`Open the game on ${game.source === 'lichess' ? 'Lichess' : 'Chess.com'}`}
        >
          <span className="hidden sm:inline">{game.source === 'lichess' ? 'Lichess' : 'Chess.com'}</span> <ExternalIcon size={13} />
        </a>
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/60 pt-3 text-sm">
          <Fact label="Prep">
            <PrepMoves a={a} suffix="of your moves" />
            {rep && (
              <Link to={`/rep/${rep.rep.id}`} className="ml-1.5 text-muted hover:text-maple">
                in {rep.rep.name}
              </Link>
            )}
          </Fact>
          <Fact label="Left prep">
            <span className={a.outcome === 'forgot' ? 'text-bad' : ''}>{prepSummary(a)}</span>
          </Fact>
          {exit !== undefined && (
            <Fact label="Right after">
              <EvalChip e={exitEval} color={color} />
            </Fact>
          )}
          <Fact label={openingPly(game) < OPENING_MOVES * 2 ? `End (move ${Math.ceil(n / 2)})` : `Move ${OPENING_MOVES}`}>
            <EvalChip e={openingEval} color={color} />
          </Fact>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Board
            fen={fen}
            orientation={color}
            movable="none"
            lastMove={lastMove}
            arrows={arrows}
            glyph={lastGlyph && lastMove ? { square: lastMove[1], glyph: lastGlyph } : undefined}
          />
          <div className="grid grid-cols-4 gap-2" title="Keyboard: ← → Home End">
            <button className="btn-ghost" onClick={() => go(0)} disabled={!cursor} aria-label="Start">
              <FirstIcon />
            </button>
            <button className="btn-ghost" onClick={() => go(cursor - 1)} disabled={!cursor} aria-label="Back">
              <PrevIcon />
            </button>
            <button className="btn-ghost" onClick={() => go(cursor + 1)} disabled={cursor >= n} aria-label="Forward">
              <NextIcon />
            </button>
            <button className="btn-ghost" onClick={() => go(n)} disabled={cursor >= n} aria-label="End">
              <LastIcon />
            </button>
          </div>
          <EvalGraph
            chances={keys.map((k) => {
              const e = evals.get(k)
              return e ? chancesFor(e, color) : null
            })}
            cursor={cursor}
            exit={exit}
            opening={openingPly(game)}
            onPick={go}
          />
          <p className="text-[11px] leading-relaxed text-muted">
            Arrows: <span className="font-semibold text-accent">green</span> your repertoire,{' '}
            <span className="font-semibold text-info">blue</span> the engine's best move,{' '}
            <span className="font-semibold text-bad">red</span> the move you played instead of yours.
            {pending > 0 && <span className="animate-pulse"> Evaluating {pending} positions…</span>}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <PositionPanel
            game={game}
            a={a}
            reps={reps}
            cursor={cursor}
            fen={fen}
            next={next}
            here={here}
            repSans={repMoves.map((m) => m.san)}
            glyph={next ? glyphs[cursor] : undefined}
          />
          <Section title="Moves">
            <MoveTable moves={moves} glyphs={glyphs} cursor={cursor} exit={exit} onPick={go} />
            {n >= MAX_PLIES && (
              <p className="mt-3 text-xs text-muted">
                Only the first {MAX_PLIES / 2} moves of each game are imported.{' '}
                <a href={game.url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  See the whole game
                </a>
                .
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] tracking-wide text-faint uppercase">{label}</span>
      <span className="flex items-center">{children}</span>
    </div>
  )
}

/** What happened at the position shown, and where to take it in the builder. */
function PositionPanel({
  game,
  a,
  reps,
  cursor,
  fen,
  next,
  here,
  repSans,
  glyph,
}: {
  game: Game
  a: GameAnalysis
  reps: RepIndex[]
  cursor: number
  fen: string
  next?: ReviewMove
  here: PosEval | null | undefined
  repSans: string[]
  glyph?: Glyph
}) {
  const color = game.color
  const path = game.moves.slice(0, cursor)
  const sans = game.sans.slice(0, cursor)
  const target = (extra?: { uci: string; san: string }) =>
    builderTarget(extra ? [...path, extra.uci] : path, extra ? [...sans, extra.san] : sans, color, reps)
  const best = here?.best ? playUci(fen, here.best) : null
  const myTurn = turnOf(fen) === color
  const who = next?.mine ? 'You' : 'They'

  let story: ReactNode
  if (!next) story = <>The stored moves end here.</>
  else {
    const mv = <b className="font-semibold text-ink">{numbered(game, next.ply)}</b>
    story = {
      start: <>{who} played {mv}, one of your repertoire's starting moves.</>,
      rep: next.mine ? <>You played {mv} from your repertoire.</> : <>They played {mv}, a reply you have prepared.</>,
      forgot: (
        <>
          You played {mv}, but your repertoire plays{' '}
          <b className="font-semibold text-accent">
            {moveNumber(next.ply)}
            {a.expected?.san}
          </b>
          .
        </>
      ),
      'opp-left': <>They played {mv}: your repertoire has no answer to it.</>,
      ended: <>Your line ended here. {who} played {mv}.</>,
      uncovered: <>None of your repertoires covers {mv}.</>,
      after: <>{who} played {mv}.</>,
    }[next.mark]
  }

  // Ways to extend your lines from here: the move played (when it isn't already in
  // your repertoire, or is the one you forgot) and the engine's best move.
  const actions: { label: string; target: BuilderTarget; title: string }[] = []
  if (next && (next.mark === 'opp-left' || next.mark === 'ended' || next.mark === 'after' || next.mark === 'uncovered'))
    actions.push({
      label: next.mine ? `Add ${next.san}` : `Answer ${next.san}`,
      target: target(next),
      title: next.mine ? 'Open the builder with the move you played, ready to save' : 'Open the builder after their move, to prepare your answer',
    })
  // Only where your repertoire has no move yet: replacing one is the builder's call.
  if (myTurn && best && best.uci !== next?.uci && !repSans.length && next?.mark !== 'start')
    actions.push({ label: `Add ${best.san} (engine)`, target: target(best), title: "Open the builder with the engine's best move, ready to save" })

  const here_ = target()
  return (
    <Section
      title={cursor ? `After ${numbered(game, cursor - 1)}` : 'Starting position'}
      right={
        here && (
          <span className="flex items-center gap-2 text-xs text-muted">
            {best && <span>best {best.san}</span>}
            <EvalChip e={here} color={color} title="Engine evaluation from your side" />
          </span>
        )
      }
    >
      <p className="text-sm leading-relaxed text-muted">
        {story}
        {glyph && (
          <span className={`ml-1.5 font-semibold ${GLYPH_TONE[glyph]}`}>
            {glyph} {GLYPH_NAMES[glyph].toLowerCase()}
          </span>
        )}
      </p>
      {repSans.length > 0 && next?.mark !== 'forgot' && (
        <p className="mt-1 text-xs text-muted">
          {myTurn ? 'Your repertoire: ' : 'Replies you have prepared: '}
          <span className="font-display font-semibold text-accent">{repSans.join(', ')}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((x) => (
          <Link key={x.label} to={x.target.url} className="btn-primary px-3 py-1.5 text-xs" title={x.title}>
            {x.label}
          </Link>
        ))}
        {next?.mark === 'forgot' && a.repertoireId && (
          <Link to={trainUrl('train', { repId: a.repertoireId })} className="btn-primary px-3 py-1.5 text-xs">
            Train this repertoire
          </Link>
        )}
        <Link to={here_.url} className="btn-ghost px-3 py-1.5 text-xs">
          {here_.kind === 'builder' ? 'Open in builder' : here_.kind === 'plan' ? 'Open in plan' : 'New repertoire from here'}
        </Link>
      </div>
    </Section>
  )
}

/** The moves in two columns, as on Lichess, coloured by how they compare with your repertoire. */
function MoveTable({
  moves,
  glyphs,
  cursor,
  exit,
  onPick,
}: {
  moves: ReviewMove[]
  glyphs: (Glyph | undefined)[]
  cursor: number
  exit?: number
  onPick: (ply: number) => void
}) {
  const rows: ReactNode[] = []
  for (let i = 0; i < moves.length; i += 2) {
    const cell = (m?: ReviewMove) =>
      m ? (
        <td className="py-0.5 pr-1">
          <button
            className={`w-full rounded px-1.5 py-0.5 text-left font-display ${MARK_CLS[m.mark]} ${
              cursor === m.ply + 1 ? 'ring-2 ring-brass' : 'hover:bg-surface-3'
            }`}
            onClick={() => onPick(m.ply + 1)}
            title={MARK_TITLE[m.mark]}
          >
            {m.san}
            {glyphs[m.ply] && <span className={`ml-0.5 font-sans text-xs font-bold ${GLYPH_TONE[glyphs[m.ply]!]}`}>{glyphs[m.ply]}</span>}
          </button>
        </td>
      ) : (
        <td />
      )
    rows.push(
      <tr key={i}>
        <td className="w-8 pr-1 text-right text-xs text-faint tabular-nums">{i / 2 + 1}</td>
        {cell(moves[i])}
        {cell(moves[i + 1])}
      </tr>,
    )
    if (exit !== undefined && (exit === i || exit === i + 1))
      rows.push(
        <tr key={`exit-${i}`}>
          <td />
          <td colSpan={2} className="py-1 text-[10px] font-semibold tracking-wider text-brass uppercase">
            — out of your prep —
          </td>
        </tr>,
      )
  }
  return (
    <>
      <table className="w-full text-sm">
        <tbody>{rows}</tbody>
      </table>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {(['rep', 'forgot', 'opp-left', 'ended'] as const).map((m) => (
          <li key={m} className="flex items-center gap-1">
            <span className={`rounded px-1 font-display ${MARK_CLS[m]}`}>a</span> {MARK_TITLE[m]}
          </li>
        ))}
      </ul>
    </>
  )
}

const MARK_TITLE: Record<ReviewMark, string> = {
  start: 'Starting move of the repertoire',
  rep: 'Repertoire move',
  forgot: 'You forgot your move',
  'opp-left': 'No answer prepared',
  ended: 'Your line had ended',
  uncovered: 'No repertoire covers this',
  after: 'Out of your prep',
}

/** Your winning chances along the game (above the line: you're better), like Lichess's graph. */
function EvalGraph({
  chances,
  cursor,
  exit,
  opening,
  onPick,
}: {
  chances: (number | null)[]
  cursor: number
  exit?: number
  opening: number
  onPick: (ply: number) => void
}) {
  const W = Math.max(1, chances.length - 1) * 10
  const H = 60
  const x = (i: number) => i * 10
  const y = (c: number) => H / 2 - (c * H) / 2
  const pts = chances.flatMap((c, i) => (c === null ? [] : [[x(i), y(c)] as const]))
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ')
  const area = pts.length ? `${line} L${pts.at(-1)![0]},${H / 2} L${pts[0][0]},${H / 2} Z` : ''
  return (
    <div className="card overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-16 w-full cursor-pointer"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          onPick(Math.round(((e.clientX - box.left) / box.width) * (chances.length - 1)))
        }}
        role="img"
        aria-label="Evaluation graph"
      >
        <defs>
          <clipPath id="eval-top">
            <rect x="0" y="0" width={W} height={H / 2} />
          </clipPath>
          <clipPath id="eval-bottom">
            <rect x="0" y={H / 2} width={W} height={H / 2} />
          </clipPath>
        </defs>
        {area && (
          <>
            <path d={area} fill="var(--color-accent)" fillOpacity={0.3} clipPath="url(#eval-top)" />
            <path d={area} fill="var(--color-bad)" fillOpacity={0.3} clipPath="url(#eval-bottom)" />
            <path d={line} fill="none" stroke="var(--color-muted)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
          </>
        )}
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--color-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={x(opening)} x2={x(opening)} y1={0} y2={H} stroke="var(--color-faint)" strokeDasharray="2 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {exit !== undefined && (
          <line x1={x(exit + 1)} x2={x(exit + 1)} y1={0} y2={H} stroke="var(--color-brass)" strokeDasharray="4 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        )}
        <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--color-brass)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between border-t border-line/60 px-2 py-1 text-[10px] text-faint">
        <span>{exit !== undefined ? <span className="text-brass">┊ out of prep</span> : 'Your winning chances'}</span>
        <span>┊ move {Math.ceil(opening / 2)}</span>
      </div>
    </div>
  )
}
