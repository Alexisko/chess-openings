import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Board, type Arrow } from '../../components/Board'
import { BookIcon, CheckIcon, CrossIcon, EyeIcon, SkipIcon, TargetIcon, TrainIcon } from '../../components/icons'
import { ColorDot, ScoreRing } from '../../components/ui'
import { recordAttempt, learnedToday } from '../../db/reviews'
import { db, type Repertoire, type ReviewMode } from '../../db/schema'
import { getSettings } from '../../db/settings'
import { buildGraph, enumerateLines, type Line } from '../../lib/chess/graph'
import { repStart } from '../../lib/chess/start'
import { formatMoves, moveSquares, playUci } from '../../lib/chess/position'
import { filterHash, totalGames, type ExplorerData } from '../../lib/explorer'
import { planDrill, planLearn, planReview, type PlannedRun } from '../../lib/srs/plan'
import { LineRun } from '../../lib/srs/session'

interface QueuedRun {
  rep: Repertoire
  run: PlannedRun
}

/** Modes you can train in ('game' reviews only come from imported games). */
type TrainMode = Exclude<ReviewMode, 'game'>

const MODE_TITLE: Record<TrainMode, string> = { review: 'Review', learn: 'Learn new moves', drill: 'Drill weak spots' }

/** Builds the session queue once, from a snapshot of the data. */
async function buildQueue(mode: TrainMode, repId: string | null, extraNew: number): Promise<QueuedRun[]> {
  const settings = await getSettings()
  const reps = (await db.repertoires.toArray())
    .filter((r) => !repId || r.id === repId)
    .sort((a, b) => (a.color === b.color ? a.createdAt - b.createdAt : a.color === 'white' ? -1 : 1))
  const now = new Date()
  let newBudget = Math.max(0, settings.newPerDay - (await learnedToday())) + extraNew
  const queue: QueuedRun[] = []
  for (const rep of reps) {
    const [moves, cards] = await Promise.all([
      db.moves.where({ repertoireId: rep.id }).toArray(),
      db.cards.where({ repertoireId: rep.id }).toArray(),
    ])
    const lines = enumerateLines(buildGraph(moves, rep.color, repStart(rep).key))
    const cardMap = new Map(cards.map((c) => [c.positionKey, c.fsrs]))
    let runs: PlannedRun[] = []
    if (mode === 'review') runs = planReview(lines, cardMap, now)
    else if (mode === 'drill') runs = planDrill(lines, cardMap, now)
    else {
      const weight = await lineWeights(lines, filterHash(settings.explorerFilter))
      runs = planLearn(lines, cardMap, newBudget, weight)
      newBudget -= runs.reduce((s, r) => s + r.focus.length, 0)
    }
    queue.push(...runs.map((run) => ({ rep, run })))
  }
  return queue
}

/** How often a line occurs (product of opponent move frequencies from cached explorer data). */
async function lineWeights(lines: Line[], hash: string): Promise<(l: Line) => number> {
  const keys = [...new Set(lines.flatMap((l) => l.moves.filter((m) => !m.byMe).map((m) => m.fromKey)))]
  const rows = await db.explorerCache.bulkGet(keys.map((k) => `${hash}|${k}`))
  const data = new Map<string, ExplorerData>()
  rows.forEach((r, i) => r && data.set(keys[i], r.data as ExplorerData))
  return (l) =>
    l.moves
      .filter((m) => !m.byMe)
      .reduce((w, m) => {
        const ex = data.get(m.fromKey)
        const mv = ex?.moves.find((x) => x.uci === m.uci)
        return w * (ex && mv ? totalGames(mv) / Math.max(1, totalGames(ex)) : 0.5)
      }, 1)
}

interface Feedback {
  kind: 'correct' | 'wrong' | 'info'
  text: string
}

export function TrainPage() {
  const [params] = useSearchParams()
  const mode = (params.get('mode') as TrainMode) || 'review'
  const repId = params.get('rep')
  const [extraNew, setExtraNew] = useState(0)
  const sessionKey = `${mode}-${repId}-${extraNew}`
  const [loaded, setLoaded] = useState<{ key: string; queue: QueuedRun[] }>()

  useEffect(() => {
    let live = true
    buildQueue(mode, repId, extraNew).then((queue) => live && setLoaded({ key: sessionKey, queue }))
    return () => {
      live = false
    }
  }, [mode, repId, extraNew, sessionKey])

  const queue = loaded?.key === sessionKey ? loaded.queue : null
  if (!queue) return <p className="animate-pulse text-muted">Preparing session…</p>
  if (!queue.length)
    return (
      <div className="card mx-auto mt-6 max-w-md animate-rise p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-brass/40 bg-brass/10 text-brass">
          <ModeIcon mode={mode} size={24} />
        </div>
        <div className="eyebrow">{MODE_TITLE[mode]}</div>
        <h1 className="page-title mt-1 mb-2">
          {mode === 'review' ? 'Nothing due' : mode === 'learn' ? 'Done for today' : 'No weak spots'}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {mode === 'review'
            ? 'Nothing is due. Come back later, or learn something new.'
            : mode === 'learn'
              ? 'No new moves to learn within today’s limit.'
              : 'No weak spots found. Nice!'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {mode === 'review' && (
            <Link className="btn-primary" to="/train?mode=learn">
              <BookIcon size={16} /> Learn new moves
            </Link>
          )}
          {mode === 'learn' && (
            <button className="btn-primary" onClick={() => setExtraNew((n) => n + 5)}>
              Learn 5 more anyway
            </button>
          )}
          <Link className="btn-ghost" to="/">
            Home
          </Link>
        </div>
      </div>
    )
  return <Session key={sessionKey} mode={mode} queue={queue} />
}

function ModeIcon({ mode, size }: { mode: TrainMode; size?: number }) {
  if (mode === 'learn') return <BookIcon size={size} />
  if (mode === 'drill') return <TargetIcon size={size} />
  return <TrainIcon size={size} />
}

function Session({ mode, queue }: { mode: TrainMode; queue: QueuedRun[] }) {
  const [index, setIndex] = useState(0)
  const [pass, setPass] = useState<'demo' | 'recall'>(mode === 'learn' ? 'demo' : 'recall')
  // LineRun is a small mutable state machine; `tick` re-renders after it changes.
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((n) => n + 1), [])
  const [boardVersion, setBoardVersion] = useState(0)
  const [stats, setStats] = useState({ correct: 0, wrong: 0, mistakes: [] as string[] })

  const current = queue[index] as QueuedRun | undefined
  const run = useMemo(
    () => (current ? new LineRun(current.run, mode, { demo: pass === 'demo' }) : null),
    [current, pass, mode],
  )
  // Feedback belongs to one run, so it resets automatically on the next line or pass.
  const [fb, setFb] = useState<{ run: LineRun; feedback: Feedback; id: number }>()
  const fbCount = useRef(0)
  const setFeedback = (feedback: Feedback) => run && setFb({ run, feedback, id: ++fbCount.current })
  const feedback: Feedback | undefined =
    fb && fb.run === run
      ? fb.feedback
      : run?.demo
        ? { kind: 'info', text: 'New line: play the highlighted moves.' }
        : mode === 'learn'
          ? { kind: 'info', text: 'Now play it from memory.' }
          : undefined
  const fens = useMemo(() => {
    if (!current) return []
    const moves = current.run.line.moves
    const last = moves[moves.length - 1]
    return [...moves.map((m) => m.fromFen), playUci(last.fromFen, last.uci)!.fen]
  }, [current])

  const next = useCallback(() => {
    if (mode === 'learn' && pass === 'demo') setPass('recall')
    else {
      if (mode === 'learn') setPass('demo')
      setIndex((i) => i + 1)
    }
  }, [mode, pass])

  // Auto-play the opponent's moves and advance when the line is finished.
  useEffect(() => {
    if (!run) return
    if (run.finished) {
      const t = setTimeout(next, 900)
      return () => clearTimeout(t)
    }
    if (!run.awaitingUser) {
      const t = setTimeout(() => {
        run.advanceOpponent()
        rerender()
      }, 450)
      return () => clearTimeout(t)
    }
  })

  if (!current || !run) return <Summary mode={mode} stats={stats} total={queue.length} />

  const skip = () => {
    if (mode === 'learn') setPass('demo')
    setIndex((i) => i + 1)
  }

  const { rep } = current
  const line = current.run.line
  // Moves so far, including the repertoire's setup moves (e.g. 1.e4 e5 2.Nc3), numbered correctly.
  const start = repStart(rep)
  const lineText = (ply: number) => formatMoves([...start.sans, ...line.moves.slice(0, ply).map((m) => m.san)])
  const fen = fens[run.ply]
  const prev = run.ply > 0 ? line.moves[run.ply - 1] : undefined
  const lastMove = prev ? (moveSquares(prev.fromFen, prev.uci) ?? undefined) : undefined
  const expected = run.expected
  const showHint = run.awaitingUser && expected && (run.demo || run.mustRetry)
  const hint = showHint ? moveSquares(expected.fromFen, expected.uci) : null
  const arrows: Arrow[] = hint ? [{ from: hint[0], to: hint[1], brush: run.mustRetry ? 'red' : 'green' }] : []

  const onMove = async (uci: string) => {
    if (!run.awaitingUser) return
    const res = run.submit(uci)
    if (res.kind === 'correct') {
      if (res.graded) {
        setStats((s) => ({ ...s, correct: s.correct + 1 }))
        await recordAttempt(rep.id, res.move.fromKey, true, uci, mode)
      }
      setFeedback(
        res.move.comment
          ? { kind: 'correct', text: `${res.move.san} — ${res.move.comment}` }
          : { kind: 'correct', text: `${res.move.san} ✓` },
      )
    } else {
      const exp = 'expected' in res ? res.expected : undefined
      if (res.kind === 'wrong' && res.graded && exp) {
        setStats((s) => ({
          ...s,
          wrong: s.wrong + 1,
          mistakes: [...s.mistakes, lineText(run.ply + 1)],
        }))
        await recordAttempt(rep.id, exp.fromKey, false, uci, mode)
      }
      setFeedback({ kind: 'wrong', text: `Not your repertoire move. Play ${exp?.san}.` })
      setBoardVersion((v) => v + 1)
    }
    rerender()
  }

  const giveUp = () => onMove('0000')
  const fbId = fb && fb.run === run ? fb.id : 0
  const flash = feedback && feedback.kind !== 'info' && fbId ? { kind: feedback.kind, id: fbId } : undefined
  // The line so far, with the last move picked out.
  const words = lineText(run.ply).split(' ')
  const lastWord = run.ply > 0 ? words.pop() : undefined
  const progress = (index + (run.finished ? 1 : run.ply / Math.max(1, line.moves.length))) / queue.length

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <ColorDot color={rep.color} size={14} />
          <span className="truncate font-display text-xl font-medium tracking-tight">{rep.name}</span>
          <span className="chip ml-auto shrink-0 py-0.5">
            <ModeIcon mode={mode} size={13} />
            {MODE_TITLE[mode]}
            {mode === 'learn' && <span className="text-brass">· {pass === 'demo' ? 'watch' : 'recall'}</span>}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brass to-maple transition-[width] duration-500 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="tabular-nums">
            line {index + 1} / {queue.length}
          </span>
        </div>
        <Board
          key={boardVersion}
          fen={fen}
          orientation={rep.color}
          movable={run.awaitingUser ? rep.color : 'none'}
          lastMove={lastMove}
          arrows={arrows}
          onMove={onMove}
          flash={flash}
        />
      </div>

      <div className="flex flex-col gap-4 md:pt-[4.25rem]">
        <FeedbackCard key={fbId || `${index}-${pass}`} feedback={feedback} awaiting={run.awaitingUser} demo={run.demo} />

        <div className="card px-4 py-3">
          <div className="eyebrow mb-1.5">Line so far</div>
          <p className="font-display text-[17px] leading-relaxed">
            {words.join(' ')}
            {lastWord && (
              <>
                {words.length > 0 && ' '}
                <span className="rounded bg-maple/15 px-1 text-maple">{lastWord}</span>
              </>
            )}
            {!lastWord && !words.join('') && <span className="text-faint">Starting position</span>}
          </p>
          {line.end === 'transposition' && run.finished && (
            <p className="mt-2 text-xs text-muted">↪ This line transposes into another one you know.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {run.awaitingUser && !run.demo && !run.mustRetry && (
            <button className="btn-ghost" onClick={giveUp} title="Counts as a mistake">
              <EyeIcon size={16} /> Show move
            </button>
          )}
          <button className="btn-ghost" onClick={skip}>
            <SkipIcon size={16} /> Skip line
          </button>
          <button className="btn-ghost ml-auto" onClick={() => setIndex(queue.length)}>
            End session
          </button>
        </div>
        <div className="flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <CheckIcon size={14} className="text-accent" />
            <span className="font-semibold text-ink tabular-nums">{stats.correct}</span> correct
          </span>
          <span className="flex items-center gap-1.5">
            <CrossIcon size={14} className="text-bad" />
            <span className="font-semibold text-ink tabular-nums">{stats.wrong}</span> mistake{stats.wrong === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  )
}

function FeedbackCard({ feedback, awaiting, demo }: { feedback?: Feedback; awaiting: boolean; demo: boolean }) {
  const kind = feedback?.kind
  const tone =
    kind === 'correct'
      ? 'border-accent/50 bg-accent/8'
      : kind === 'wrong'
        ? 'animate-shake border-bad/60 bg-bad/10'
        : kind === 'info'
          ? 'border-brass/40 bg-brass/8'
          : ''
  const icon =
    kind === 'correct' ? (
      <CheckIcon size={20} />
    ) : kind === 'wrong' ? (
      <CrossIcon size={20} />
    ) : kind === 'info' ? (
      demo ? <EyeIcon size={20} /> : <BookIcon size={20} />
    ) : (
      <span className={`h-2.5 w-2.5 rounded-full bg-maple ${awaiting ? 'animate-pulse' : 'opacity-40'}`} />
    )
  const iconCls =
    kind === 'correct'
      ? 'bg-accent/20 text-accent'
      : kind === 'wrong'
        ? 'bg-bad/20 text-bad'
        : kind === 'info'
          ? 'bg-brass/20 text-brass'
          : 'bg-surface-3'
  return (
    <div className={`card flex min-h-20 animate-pop items-center gap-3.5 px-4 py-3.5 ${tone}`} aria-live="polite">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${iconCls}`}>{icon}</span>
      <p className="text-[15px] leading-snug">{feedback?.text ?? (awaiting ? 'Your move.' : 'Watch the reply…')}</p>
    </div>
  )
}

function Summary({ mode, stats, total }: { mode: TrainMode; stats: { correct: number; wrong: number; mistakes: string[] }; total: number }) {
  const attempts = stats.correct + stats.wrong
  const accuracy = attempts ? stats.correct / attempts : null
  return (
    <div className="card mx-auto mt-6 max-w-md animate-rise p-6 md:p-8">
      <div className="flex items-center gap-5">
        <ScoreRing value={accuracy} size={88} stroke={6} />
        <div>
          <div className="eyebrow">{MODE_TITLE[mode]}</div>
          <h1 className="page-title mt-1">Session complete</h1>
          <p className="mt-1 text-sm text-muted">
            {total} line{total === 1 ? '' : 's'} · {stats.correct} correct · {stats.wrong} mistake{stats.wrong === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {stats.mistakes.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow mb-2">Mistakes</div>
          <ul className="flex flex-col gap-1.5">
            {stats.mistakes.map((m, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-2/70 px-3 py-2 text-sm">
                <CrossIcon size={14} className="mt-0.5 shrink-0 text-bad" />
                <span className="font-display">{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <Link className="btn-primary flex-1" to="/">
          Home
        </Link>
        {stats.mistakes.length > 0 && (
          <Link className="btn-ghost flex-1" to="/train?mode=drill">
            <TargetIcon size={16} /> Drill weak spots
          </Link>
        )}
      </div>
    </div>
  )
}
