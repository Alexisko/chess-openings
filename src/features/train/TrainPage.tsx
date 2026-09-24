import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Board, type Arrow } from '../../components/Board'
import { ColorDot } from '../../components/ui'
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
  if (!queue) return <p className="text-muted">Preparing session…</p>
  if (!queue.length)
    return (
      <div className="card mx-auto max-w-md p-4 text-center">
        <h1 className="mb-2 text-lg font-semibold">{MODE_TITLE[mode]}</h1>
        <p className="mb-4 text-sm text-muted">
          {mode === 'review'
            ? 'Nothing is due. Come back later, or learn something new.'
            : mode === 'learn'
              ? 'No new moves to learn within today’s limit.'
              : 'No weak spots found. Nice!'}
        </p>
        <div className="flex justify-center gap-2">
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
  const [fb, setFb] = useState<{ run: LineRun; feedback: Feedback }>()
  const setFeedback = (feedback: Feedback) => run && setFb({ run, feedback })
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

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <ColorDot color={rep.color} />
          <span className="font-medium">{rep.name}</span>
          <span className="ml-auto text-xs text-muted">
            {MODE_TITLE[mode]} · line {index + 1}/{queue.length}
            {mode === 'learn' && ` · ${pass === 'demo' ? 'watch' : 'recall'}`}
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
        />
      </div>

      <div className="flex flex-col gap-3">
        <div
          className={`card min-h-16 p-3 text-sm ${
            feedback?.kind === 'correct'
              ? 'border-accent/60'
              : feedback?.kind === 'wrong'
                ? 'border-bad/60'
                : ''
          }`}
        >
          {feedback?.text ?? (run.awaitingUser ? 'Your move.' : '…')}
        </div>
        <div className="text-sm">
          <div className="mb-1 text-xs text-muted">Line so far</div>
          {lineText(run.ply) || '—'}
          {line.end === 'transposition' && run.finished && (
            <p className="mt-1 text-xs text-muted">↪ This line transposes into another one you know.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {run.awaitingUser && !run.demo && !run.mustRetry && (
            <button className="btn-ghost" onClick={giveUp}>
              Show move (counts as wrong)
            </button>
          )}
          <button className="btn-ghost" onClick={skip}>
            Skip line
          </button>
          <button className="btn-ghost" onClick={() => setIndex(queue.length)}>
            End session
          </button>
        </div>
        <div className="text-xs text-muted">
          {stats.correct} correct · {stats.wrong} mistakes
        </div>
      </div>
    </div>
  )
}

function Summary({ mode, stats, total }: { mode: TrainMode; stats: { correct: number; wrong: number; mistakes: string[] }; total: number }) {
  const attempts = stats.correct + stats.wrong
  return (
    <div className="card mx-auto max-w-md p-4">
      <h1 className="mb-1 text-lg font-semibold">Session complete</h1>
      <p className="mb-3 text-sm text-muted">
        {MODE_TITLE[mode]} · {total} line{total === 1 ? '' : 's'} · {attempts ? Math.round((stats.correct / attempts) * 100) : 0}%
        correct
      </p>
      {stats.mistakes.length > 0 && (
        <>
          <div className="mb-1 text-xs text-muted">Mistakes</div>
          <ul className="mb-3 list-disc pl-5 text-sm">
            {stats.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
      <div className="flex gap-2">
        <Link className="btn-primary" to="/">
          Home
        </Link>
        {stats.mistakes.length > 0 && (
          <Link className="btn-ghost" to="/train?mode=drill">
            Drill weak spots
          </Link>
        )}
      </div>
    </div>
  )
}
