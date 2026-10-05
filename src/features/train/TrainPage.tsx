import { useLiveQuery } from 'dexie-react-hooks'
import type { Card as FsrsCard } from 'ts-fsrs'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Board, type Arrow } from '../../components/Board'
import { OpeningTrail } from '../../components/OpeningTrail'
import {
  BookIcon,
  CheckIcon,
  CrossIcon,
  EyeIcon,
  FirstIcon,
  LastIcon,
  NextIcon,
  PrevIcon,
  SkipIcon,
  TargetIcon,
  TrainIcon,
} from '../../components/icons'
import { ColorDot, ScoreRing, Toggle } from '../../components/ui'
import { learnedToday, loadMoveRecords, recordAttempt } from '../../db/reviews'
import { db, type RepMove, type Repertoire, type ReviewMode } from '../../db/schema'
import { GLYPH_TONE } from '../../lib/chess/glyphs'
import { engineGlyphOf } from '../../lib/engine/useEngineGlyphs'
import type { Evaluation } from '../../lib/engine/uci'
import { getSettings, useSettings } from '../../db/settings'
import { crossAt, crossIndex } from '../../lib/chess/cross'
import { buildGraph, enumerateLines, type Line } from '../../lib/chess/graph'
import { repStart, startOf, startsWith } from '../../lib/chess/start'
import { buildTree } from '../../lib/chess/tree'
import { buildChapters } from '../../lib/openings/chapters'
import { loadNaming } from '../../lib/openings/naming'
import { formatMoves, moveSquares, playUci, positionKey, replay, START_FEN, type Color } from '../../lib/chess/position'
import { filterHash, totalGames, useOpeningNames, type ExplorerData } from '../../lib/explorer'
import { openingTrail } from '../../lib/openings/names'
import { builderUrl, trainUrl } from '../../lib/routes'
import { KnowledgeBar, KnowledgeChip } from '../../components/Knowledge'
import { describeRecord, emptyCounts, knowledgeOf, weakness, withResult, type Knowledge, type MoveRecord } from '../../lib/srs/knowledge'
import {
  MOVE_LEAD_IN,
  makeRun,
  planLearn,
  planReview,
  planTrain,
  type CardMap,
  type PlannedRun,
  type TrainPool,
  type TrainUnit,
} from '../../lib/srs/plan'
import { isNew } from '../../lib/srs/scheduler'
import { LineRun } from '../../lib/srs/session'
import { useFocusMode } from '../../lib/focusMode'
import { playSound } from '../../lib/sound'
import { MoveInsight } from '../board/MoveInsight'

interface QueuedRun {
  rep: Repertoire
  run: PlannedRun
  /** Other repertoires that go on from where the line ends. */
  continuesIn: string[]
  /** A move missed earlier in the session, asked once more (not graded). */
  retry?: boolean
}

/** Modes you can train in ('game' reviews only come from imported games; 'drill' became 'train'). */
type TrainMode = Exclude<ReviewMode, 'game' | 'drill'>

const MODE_TITLE: Record<TrainMode, string> = { review: 'Review', learn: 'Learn new moves', train: 'Train' }

const UNIT_SIZES: Record<TrainUnit, number[]> = { moves: [10, 20, 40], lines: [5, 10, 20] }

/** What a session trains: one repertoire (or one of its chapters), a colour, or everything. */
interface Scope {
  repId: string | null
  color: Color | null
  /** Moves to the chapter's first position, from the initial position. */
  chapter: string[]
}

interface ScopeRep {
  rep: Repertoire
  lines: Line[]
  cards: CardMap
  records: Map<string, MoveRecord>
  /** Positions in scope where you have a move to play (after the chapter's start). */
  keys: string[]
}

/** Card and answer record per `${repId}|${positionKey}`, for feedback during the session. */
type KnowMap = Map<string, { card: FsrsCard; record?: MoveRecord }>

const knowKey = (repId: string, key: string) => `${repId}|${key}`

/**
 * The repertoires in scope, with their lines (only those through the chapter,
 * if any). A paused repertoire only counts when asked for by name.
 */
async function loadScope(scope: Scope): Promise<ScopeRep[]> {
  const reps = (await db.repertoires.toArray())
    .filter((r) => (scope.repId ? r.id === scope.repId : !r.paused && (!scope.color || r.color === scope.color)))
    .sort((a, b) => (a.color === b.color ? a.createdAt - b.createdAt : a.color === 'white' ? -1 : 1))
  return Promise.all(
    reps.map(async (rep) => {
      const [moves, cards, records] = await Promise.all([
        db.moves.where({ repertoireId: rep.id }).toArray(),
        db.cards.where({ repertoireId: rep.id }).toArray(),
        loadMoveRecords(rep.id),
      ])
      const start = repStart(rep)
      const lines = enumerateLines(buildGraph(moves, rep.color, start.key)).filter(
        (l) => !scope.chapter.length || startsWith([...start.moves, ...l.moves.map((m) => m.uci)], scope.chapter),
      )
      const cardMap: CardMap = new Map(cards.map((c) => [c.positionKey, c.fsrs]))
      const from = Math.max(0, scope.chapter.length - start.moves.length)
      const keys = new Set(lines.flatMap((l) => l.moves.flatMap((m, i) => (m.byMe && i >= from && cardMap.has(m.fromKey) ? [m.fromKey] : []))))
      return { rep, lines, cards: cardMap, records, keys: [...keys] }
    }),
  )
}

function knowMap(scope: ScopeRep[]): KnowMap {
  const out: KnowMap = new Map()
  for (const s of scope) for (const [key, card] of s.cards) out.set(knowKey(s.rep.id, key), { card, record: s.records.get(key) })
  return out
}

/** How many of the scope's moves are at each knowledge level. */
function scopeCounts(scope: ScopeRep[], now: Date): Record<Knowledge, number> {
  const counts = emptyCounts()
  for (const s of scope) for (const k of s.keys) counts[knowledgeOf(s.cards.get(k)!, s.records.get(k), now)]++
  return counts
}

/** Builds the session queue once, from a snapshot of the data. */
async function buildQueue(mode: TrainMode, scope: ScopeRep[], extraNew: number, unit: TrainUnit, size: number): Promise<QueuedRun[]> {
  const settings = await getSettings()
  // Every repertoire, paused or not, to tell where a line goes on in another one.
  const all = await db.repertoires.toArray()
  const withMoves = await Promise.all(all.map(async (rep) => ({ rep, moves: await db.moves.where({ repertoireId: rep.id }).toArray() })))
  const cross = {
    white: crossIndex(withMoves.filter((r) => r.rep.color === 'white')),
    black: crossIndex(withMoves.filter((r) => r.rep.color === 'black')),
  }
  const continuesIn = (rep: Repertoire, run: PlannedRun) =>
    run.line.end === 'leaf' && run.endPly === run.line.moves.length
      ? crossAt(cross[rep.color], run.line.moves.at(-1)!.toKey, rep.id).map((r) => r.rep.name)
      : []
  const now = new Date()

  if (mode === 'train') {
    const pools: TrainPool[] = scope.map((s) => {
      const weak = new Map<string, number>()
      const lastAsked = new Map<string, number>()
      for (const k of s.keys) {
        const card = s.cards.get(k)!
        if (isNew(card)) continue
        const rec = s.records.get(k)
        weak.set(k, weakness(card, rec, now))
        if (rec) lastAsked.set(k, rec.lastTs)
      }
      return { lines: s.lines, weakness: weak, lastAsked }
    })
    return planTrain(pools, unit, size, now).map(({ pool, run }) => {
      const rep = scope[pool].rep
      return { rep, run, continuesIn: continuesIn(rep, run) }
    })
  }

  let newBudget = Math.max(0, settings.newPerDay - (await learnedToday())) + extraNew
  const queue: QueuedRun[] = []
  for (const { rep, lines, cards } of scope) {
    let runs: PlannedRun[] = []
    if (mode === 'review') runs = planReview(lines, cards, now)
    else {
      const weight = await lineWeights(lines, filterHash(settings.explorerFilter))
      runs = planLearn(lines, cards, newBudget, weight)
      newBudget -= runs.reduce((s, r) => s + r.focus.length, 0)
    }
    queue.push(...runs.map((run) => ({ rep, run, continuesIn: continuesIn(rep, run) })))
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
  /** The move just played correctly, to explain. */
  move?: { fen: string; uci: string; label: string }
  /** How well you know the move, after this answer (graded answers only). */
  record?: { level: Knowledge; text: string }
}

interface Stats {
  correct: number
  wrong: number
  mistakes: string[]
  /** Moves graded this session (KnowMap keys), in order. */
  asked: string[]
}

function readExplain() {
  try {
    return localStorage.getItem('explainMoves') === 'on'
  } catch {
    return false
  }
}

function readUnit(): TrainUnit {
  try {
    return localStorage.getItem('trainUnit') === 'lines' ? 'lines' : 'moves'
  } catch {
    return 'moves'
  }
}

export function TrainPage() {
  const [params] = useSearchParams()
  const rawMode = params.get('mode')
  // Old links to the weak-spot drill open Train.
  const mode: TrainMode = rawMode === 'drill' ? 'train' : ((rawMode as TrainMode) || 'review')
  const repId = params.get('rep')
  const colorParam = params.get('color')
  const color: Color | null = !repId && (colorParam === 'white' || colorParam === 'black') ? colorParam : null
  // A chapter only narrows a single repertoire's session.
  const chapterParam = (repId && params.get('chapter')) || ''
  const unitParam = params.get('unit')
  const unit: TrainUnit | null = unitParam === 'moves' || unitParam === 'lines' ? unitParam : null
  const size = Number(params.get('size')) || (unit ? UNIT_SIZES[unit][1] : 0)
  // Train asks what to train first.
  const setup = mode === 'train' && !unit
  const [extraNew, setExtraNew] = useState(0)
  const sessionKey = `${mode}-${repId}-${color}-${chapterParam}-${unit}-${size}-${extraNew}`
  const [loaded, setLoaded] = useState<{ key: string; scope: ScopeRep[]; queue: QueuedRun[]; chapter?: string }>()

  useEffect(() => {
    let live = true
    const chapter = chapterParam ? chapterParam.split(',') : []
    const load = async () => {
      const scope = await loadScope({ repId, color, chapter })
      const [queue, title] = await Promise.all([
        setup ? [] : buildQueue(mode, scope, extraNew, unit ?? 'moves', size),
        repId && chapter.length ? chapterTitle(repId, chapter) : undefined,
      ])
      if (live) setLoaded({ key: sessionKey, scope, queue, chapter: title })
    }
    load()
    return () => {
      live = false
    }
  }, [mode, repId, color, chapterParam, unit, size, setup, extraNew, sessionKey])

  const current = loaded?.key === sessionKey ? loaded : undefined
  if (!current) return <p className="animate-pulse text-muted">Preparing session…</p>
  const { queue, chapter, scope } = current
  const scopeName =
    scope.length === 1 && repId
      ? `${scope[0].rep.name}${chapter ? ` · ${chapter}` : ''}`
      : color
        ? `${color === 'white' ? 'White' : 'Black'} repertoires`
        : 'All repertoires'
  const learned = scope.reduce((n, s) => n + s.keys.filter((k) => !isNew(s.cards.get(k)!)).length, 0)
  if (setup && learned) return <TrainSetup scope={scope} scopeName={scopeName} params={params} />
  if (!queue.length)
    return (
      <div className="card mx-auto mt-6 max-w-md animate-rise p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-brass/40 bg-brass/10 text-brass">
          <ModeIcon mode={mode} size={24} />
        </div>
        <div className="eyebrow">
          {MODE_TITLE[mode]} · {scopeName}
        </div>
        <h1 className="page-title mt-1 mb-2">
          {mode === 'review' ? 'Nothing due' : mode === 'learn' ? 'Done for today' : 'Nothing learned yet'}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {mode === 'review'
            ? 'Nothing is due. Come back later, learn something new, or train what you know.'
            : mode === 'learn'
              ? 'No new moves to learn within today’s limit.'
              : 'Training tests the moves you have learned. Learn a few first.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {mode === 'review' && (
            <>
              <Link className="btn-primary" to={trainUrl('learn', { repId, color, chapter: chapterParam })}>
                <BookIcon size={16} /> Learn new moves
              </Link>
              <Link className="btn-ghost" to={trainUrl('train', { repId, color, chapter: chapterParam })}>
                <TargetIcon size={16} /> Train
              </Link>
            </>
          )}
          {mode === 'learn' && (
            <button className="btn-primary" onClick={() => setExtraNew((n) => n + 5)}>
              Learn 5 more anyway
            </button>
          )}
          {mode === 'train' && (
            <Link className="btn-primary" to={trainUrl('learn', { repId, color, chapter: chapterParam })}>
              <BookIcon size={16} /> Learn new moves
            </Link>
          )}
          <Link className="btn-ghost" to="/">
            Home
          </Link>
        </div>
      </div>
    )
  return (
    <Session
      key={sessionKey}
      mode={mode}
      unit={unit ?? undefined}
      queue={queue}
      know={knowMap(scope)}
      chapter={chapter}
      again={mode === 'train' ? trainUrl('train', { repId, color, chapter: chapterParam }) : undefined}
    />
  )
}

/** Choose moves or lines, and how many, for a training session. */
function TrainSetup({ scope, scopeName, params }: { scope: ScopeRep[]; scopeName: string; params: URLSearchParams }) {
  const [unit, setUnit] = useState<TrainUnit>(readUnit)
  const [size, setSize] = useState(UNIT_SIZES[unit][1])
  const counts = useMemo(() => scopeCounts(scope, new Date()), [scope])
  const pick = (u: TrainUnit) => {
    setUnit(u)
    setSize(UNIT_SIZES[u][1])
    try {
      localStorage.setItem('trainUnit', u)
    } catch {
      // Preference is optional.
    }
  }
  const start = new URLSearchParams(params)
  start.set('mode', 'train')
  start.set('unit', unit)
  start.set('size', String(size))
  const options: { u: TrainUnit; title: string; text: string }[] = [
    {
      u: 'moves',
      title: 'Moves',
      text: 'Single positions from anywhere in your lines, after the last two moves. Quick checks of each move on its own.',
    },
    {
      u: 'lines',
      title: 'Lines',
      text: 'Whole lines, every one of your moves asked. A start shared with an earlier line is only asked once.',
    },
  ]
  return (
    <div className="card mx-auto mt-2 max-w-xl animate-rise p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass/10 text-brass">
          <TargetIcon size={20} />
        </span>
        <div className="min-w-0">
          <div className="eyebrow truncate">Train · {scopeName}</div>
          <h1 className="page-title mt-0.5">What do you really know?</h1>
        </div>
      </div>
      <div className="mt-5">
        <div className="eyebrow mb-2">Your moves here</div>
        <KnowledgeBar counts={counts} />
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Train">
        {options.map((o) => (
          <button
            key={o.u}
            role="radio"
            aria-checked={unit === o.u}
            onClick={() => pick(o.u)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              unit === o.u ? 'border-brass bg-brass/10' : 'border-line bg-surface-2/60 hover:border-line-strong'
            }`}
          >
            <div className="flex items-center gap-2 font-display text-lg font-medium">
              <span className={`h-3 w-3 rounded-full border-2 ${unit === o.u ? 'border-brass bg-brass' : 'border-line-strong'}`} />
              {o.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{o.text}</p>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted">{unit === 'moves' ? 'Moves' : 'Lines'} per session</span>
        {UNIT_SIZES[unit].map((n) => (
          <button key={n} className={n === size ? 'chip chip-on' : 'chip'} onClick={() => setSize(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <Link className="btn-primary flex-1 py-2.5" to={`/train?${start}`}>
          <TargetIcon size={16} /> Start
        </Link>
        <Link className="btn-ghost" to="/">
          Home
        </Link>
      </div>
      {/* How it works, after the choice: the choice is what most visits are for. */}
      <p className="mt-5 border-t border-line/70 pt-4 text-xs leading-relaxed text-muted">
        Any move you have learned can come up, due or not. Moves you missed recently or haven't been asked for a while come up
        more often; a move you miss comes back a few questions later. Early right answers don't change your review schedule,
        but they count towards how well you know each move.
      </p>
    </div>
  )
}

/** The name of the chapter starting after `path` in a repertoire. */
async function chapterTitle(repId: string, path: string[]): Promise<string | undefined> {
  const rep = await db.repertoires.get(repId)
  if (!rep) return undefined
  const moves = await db.moves.where({ repertoireId: rep.id }).toArray()
  const start = repStart(rep)
  const tree = buildTree(buildGraph(moves, rep.color, start.key), start.moves)
  const chapters = buildChapters(tree, await loadNaming())
  return chapters.startingAt(startOf(path).moves)?.title
}

function ModeIcon({ mode, size }: { mode: TrainMode; size?: number }) {
  if (mode === 'learn') return <BookIcon size={size} />
  if (mode === 'train') return <TargetIcon size={size} />
  return <TrainIcon size={size} />
}

/** Questions between a missed move and its second try. */
const RETRY_GAP = 3

function Session({
  mode,
  unit,
  queue: initialQueue,
  know: initialKnow,
  chapter,
  again,
}: {
  mode: TrainMode
  unit?: TrainUnit
  queue: QueuedRun[]
  know: KnowMap
  chapter?: string
  /** Where to start another session like this one. */
  again?: string
}) {
  // Review and training add missed moves back to the queue.
  const retries = mode === 'review' || mode === 'train'
  const [queue, setQueue] = useState(initialQueue)
  // Answer records, updated as you answer.
  const [know, setKnow] = useState(initialKnow)
  const [index, setIndex] = useState(0)
  // The furthest line reached: lines before it are being played again, as practice.
  const [furthest, setFurthest] = useState(0)
  const current = queue[index] as QueuedRun | undefined
  const practice = index < furthest || !!current?.retry
  const [pass, setPass] = useState<'demo' | 'recall'>(mode === 'learn' ? 'demo' : 'recall')
  // LineRun is a small mutable state machine; `tick` re-renders after it changes.
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((n) => n + 1), [])
  const [boardVersion, setBoardVersion] = useState(0)
  const [stats, setStats] = useState<Stats>({ correct: 0, wrong: 0, mistakes: [], asked: [] })
  const [explain, setExplain] = useState(readExplain)
  // The feedback whose explanation was dismissed.
  const [continued, setContinued] = useState(0)

  // Where the line goes on: another line of this repertoire, or another repertoire.
  const endNote = !current
    ? undefined
    : current.run.line.end === 'transposition' && current.run.endPly === current.run.line.moves.length
      ? 'This line transposes into another one you know.'
      : current.continuesIn.length
        ? `This line continues in your ${current.continuesIn.join(', ')} repertoire.`
        : undefined
  const run = useMemo(
    () => (current ? new LineRun(current.run, mode, { demo: pass === 'demo', practice }) : null),
    [current, pass, mode, practice],
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
  // Every position from the initial one: the repertoire's setup moves, then the line.
  const path = useMemo(() => {
    if (!current) return { fens: [], ucis: [], sans: [] }
    const moves = current.run.line.moves
    const last = moves[moves.length - 1]
    const setup = replay(repStart(current.rep).moves)
    return {
      fens: [START_FEN, ...setup.map((p) => p.fen), ...moves.slice(1).map((m) => m.fromFen), playUci(last.fromFen, last.uci)!.fen],
      ucis: [...setup.map((p) => p.uci), ...moves.map((m) => m.uci)],
      sans: [...setup.map((p) => p.san), ...moves.map((m) => m.san)],
    }
  }, [current])
  const settings = useSettings()
  const keys = useMemo(() => path.fens.map(positionKey), [path])
  // The opponent's move just played, if it's a mistake to punish: marked by you, else by the engine.
  const lastTheirs = run && run.ply > 0 ? run.moves[run.ply - 1] : undefined
  const punish = usePunish(lastTheirs && !lastTheirs.byMe ? lastTheirs : undefined)
  const openings = useOpeningNames(keys, settings?.explorerFilter)

  const goToLine = useCallback(
    (i: number) => {
      if (mode === 'learn') setPass('demo')
      setIndex(i)
      setFurthest((f) => Math.max(f, i))
    },
    [mode],
  )
  const next = useCallback(() => {
    if (mode === 'learn' && pass === 'demo') setPass('recall')
    else goToLine(index + 1)
  }, [mode, pass, index, goToLine])

  // Looking back at earlier positions of the line; like feedback, it belongs to one run.
  const [browse, setBrowse] = useState<{ run: LineRun; at: number }>()
  const live = current && run ? repStart(current.rep).moves.length + run.ply : 0
  const view = browse && browse.run === run ? Math.min(browse.at, live) : live
  const browsing = view < live
  // Back at the live position, stop browsing so the view follows the line again.
  const setView = useCallback((at: number) => setBrowse(run && at < live ? { run, at: Math.max(0, at) } : undefined), [run, live])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') setView(view - 1)
      else if (e.key === 'ArrowRight') setView(view + 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, view])

  const fbId = fb && fb.run === run ? fb.id : 0
  // With explanations on, a correct move pauses the line until you continue. Only
  // before the reply: after it you're answering again, and the idea could give it away.
  const explaining = explain && !!feedback?.move && !!run && !run.awaitingUser && continued !== fbId ? feedback.move : undefined

  // Auto-play the opponent's and the mastered moves, and advance when the run is finished.
  // Both wait while you look back at earlier moves.
  useEffect(() => {
    if (!run || explaining || browsing) return
    if (run.finished) {
      // Longer when there's a note to read at the end.
      const t = setTimeout(next, endNote ? 3000 : 900)
      return () => clearTimeout(t)
    }
    if (!run.awaitingUser) {
      const t = setTimeout(() => {
        run.advanceAuto()
        rerender()
      }, 450)
      return () => clearTimeout(t)
    }
  })

  // A chime when a line is done, except after watching a demo, and on the last line,
  // where the end of the session has its own sound.
  const finished = !!run?.finished
  const lastLine = index === queue.length - 1
  useEffect(() => {
    if (!finished || run?.demo || lastLine) return
    const t = setTimeout(() => playSound('line-complete'), 250)
    return () => clearTimeout(t)
  }, [run, finished, lastLine])

  // On a phone the session takes the whole screen; the summary brings the app back.
  useFocusMode(!!run)

  // What one step of the session is, for labels.
  const item = unit === 'moves' ? 'move' : 'line'
  if (!current || !run)
    return (
      <Summary
        mode={mode}
        item={item}
        stats={stats}
        // Ended early: only the steps you got to (the last one reached counts).
        reached={Math.min(queue.length, furthest + 1)}
        total={queue.length}
        know={know}
        again={again}
      />
    )

  const { rep } = current
  const start = repStart(rep)
  const fen = path.fens[view]
  // Names of positions already on the board only: never the one your pending move reaches.
  const trail = openingTrail(openings, view)
  const lastMove = view > 0 ? (moveSquares(path.fens[view - 1], path.ucis[view - 1]) ?? undefined) : undefined
  const expected = run.expected
  const showHint = !browsing && run.awaitingUser && expected && (run.demo || run.mustRetry)
  const hint = showHint ? moveSquares(expected.fromFen, expected.uci) : null
  const arrows: Arrow[] = hint ? [{ from: hint[0], to: hint[1], brush: run.mustRetry ? 'red' : 'green' }] : []

  /** Adds a graded answer to the move's record; returns where the move stands now. */
  const noteAnswer = (key: string, correct: boolean): Feedback['record'] => {
    const k = knowKey(rep.id, key)
    const known = know.get(k)
    if (!known) return undefined
    const record = withResult(known.record, correct, Date.now())
    setKnow((m) => new Map(m).set(k, { card: known.card, record }))
    setStats((s) => ({ ...s, asked: s.asked.includes(k) ? s.asked : [...s.asked, k] }))
    return { level: knowledgeOf(known.card, record, new Date()), text: describeRecord(record) }
  }

  const onMove = async (uci: string) => {
    if (!run.awaitingUser) return
    const res = run.submit(uci)
    if (res.kind === 'correct') {
      let record: Feedback['record']
      if (res.graded) {
        setStats((s) => ({ ...s, correct: s.correct + 1 }))
        record = noteAnswer(res.move.fromKey, true)
        await recordAttempt(rep.id, res.move.fromKey, true, uci, mode)
      }
      const move = { fen: res.move.fromFen, uci: res.move.uci, label: formatMoves([res.move.san], start.moves.length + run.ply - 1) }
      setFeedback(
        res.move.comment
          ? { kind: 'correct', text: `${res.move.san} — ${res.move.comment}`, move, record }
          : { kind: 'correct', text: `${res.move.san} ✓`, move, record },
      )
    } else {
      const exp = 'expected' in res ? res.expected : undefined
      let record: Feedback['record']
      if (res.kind === 'wrong' && res.graded && exp) {
        setStats((s) => ({
          ...s,
          wrong: s.wrong + 1,
          mistakes: [...s.mistakes, formatMoves(path.sans.slice(0, live + 1))],
        }))
        record = noteAnswer(exp.fromKey, false)
        await recordAttempt(rep.id, exp.fromKey, false, uci, mode)
        // In review and training, a missed move is asked once more a little later (not graded).
        if (retries) {
          const retry: QueuedRun = { rep, run: makeRun(current.run.line, [exp.fromKey], MOVE_LEAD_IN), continuesIn: [], retry: true }
          setQueue((q) => {
            const at = Math.min(q.length, index + 1 + RETRY_GAP)
            return [...q.slice(0, at), retry, ...q.slice(at)]
          })
        }
      }
      // Not for "Show move", which is asked for.
      if (uci !== '0000') playSound('wrong')
      setFeedback({
        kind: 'wrong',
        text: `Not your repertoire move. Play ${exp?.san}.${retries && record ? ' It will come back in a moment.' : ''}`,
        record,
      })
      setBoardVersion((v) => v + 1)
    }
    rerender()
  }

  const giveUp = () => onMove('0000')
  // Show move keeps its place under the board, disabled while there's nothing to show.
  const canShow = run.awaitingUser && !run.demo && !run.mustRetry && !browsing
  const endSession = () => setIndex(queue.length)
  const flash = feedback && feedback.kind !== 'info' && fbId ? { kind: feedback.kind, id: fbId } : undefined
  const { startPly, endPly } = current.run
  // Progress counts the planned steps only: a missed move asked again doesn't push the end away.
  const planned = queue.length - queue.filter((q) => q.retry).length
  const plannedBefore = queue.slice(0, index).filter((q) => !q.retry).length
  const step = current.retry ? plannedBefore : plannedBefore + 1
  const progress = current.retry
    ? plannedBefore / planned
    : (plannedBefore + (run.finished ? 1 : (run.ply - startPly) / Math.max(1, endPly - startPly))) / planned

  return (
    // The board is as large as fits above its buttons (at most 560px). Below lg, one column the board's width.
    <div className="mx-auto flex max-w-[var(--board)] flex-col gap-3 [--board:min(560px,max(320px,calc(100dvh-15rem)))] lg:max-w-none">
      <div className="flex items-center gap-2.5">
        <ColorDot color={rep.color} size={14} />
        <div className="min-w-0 font-display text-xl leading-tight font-medium tracking-tight">
          <span className="block truncate sm:inline">{rep.name}</span>
          {chapter && (
            <span className="block truncate text-sm text-muted sm:inline sm:text-xl">
              <span className="max-sm:hidden"> · </span>
              {chapter}
            </span>
          )}
        </div>
        <span className="chip ml-auto shrink-0 py-0.5" title={MODE_TITLE[mode]}>
          <ModeIcon mode={mode} size={13} />
          <span className="max-sm:sr-only">{MODE_TITLE[mode]}</span>
          {mode === 'learn' && <span className="text-brass">· {pass === 'demo' ? 'watch' : 'recall'}</span>}
          {unit && <span className="text-brass max-sm:hidden">· {unit}</span>}
        </span>
        <button
          className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink md:hidden"
          onClick={endSession}
          aria-label="End session"
        >
          <CrossIcon size={20} />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brass to-maple transition-[width] duration-500 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="tabular-nums">
          {item} {step} / {planned}
          {practice && (
            <span className="text-brass" title="Played again: not graded">
              {' '}
              · {current.retry ? 'second try' : 'replay'}, not graded
            </span>
          )}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[var(--board)_minmax(0,1fr)] lg:gap-5">
        <div className="flex flex-col gap-3">
          <Board
            key={boardVersion}
            fen={fen}
            orientation={rep.color}
            movable={run.awaitingUser && !browsing ? rep.color : 'none'}
            lastMove={lastMove}
            arrows={arrows}
            onMove={onMove}
            flash={flash}
          />
          <div className="grid grid-cols-2 gap-2">
            {explaining ? (
              <button className="btn-primary col-span-2 min-h-12 text-[15px]" onClick={() => setContinued(fbId)} autoFocus>
                Continue
              </button>
            ) : (
              <>
                <button
                  className="btn-ghost min-h-12 text-[15px]"
                  onClick={giveUp}
                  disabled={!canShow}
                  title={practice ? 'Replays aren’t graded' : 'Counts as a mistake'}
                >
                  <EyeIcon size={18} /> Show move
                </button>
                <button className="btn-ghost min-h-12 text-[15px]" onClick={() => goToLine(index + 1)}>
                  <SkipIcon size={18} /> Skip {item}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <FeedbackCard
            key={fbId || `${index}-${pass}`}
            feedback={feedback}
            awaiting={run.awaitingUser}
            demo={run.demo}
            autoMine={!run.finished && !run.awaitingUser && !!expected?.byMe}
            punish={
              punish && run.awaitingUser && !run.mustRetry && !browsing && lastTheirs
                ? { glyph: punish, move: formatMoves([lastTheirs.san], start.moves.length + run.ply - 1) }
                : undefined
            }
          />

          {explaining && (
            <div className="card animate-pop px-4 py-3">
              <div className="eyebrow mb-2">What {explaining.label} does</div>
              <MoveInsight key={fbId} fen={explaining.fen} uci={explaining.uci} />
            </div>
          )}

          <div className="card px-4 py-3">
            <div className="-mr-2 mb-1 flex items-center gap-2">
              <span className="eyebrow">Line so far</span>
              <div className="ml-auto flex" title="Look back at the moves so far · Keyboard: ← →">
                <HistoryButton onClick={() => setView(0)} disabled={view <= 0} label="Initial position">
                  <FirstIcon size={18} />
                </HistoryButton>
                <HistoryButton onClick={() => setView(view - 1)} disabled={view <= 0} label="Back">
                  <PrevIcon size={18} />
                </HistoryButton>
                <HistoryButton onClick={() => setView(view + 1)} disabled={!browsing} label="Forward">
                  <NextIcon size={18} />
                </HistoryButton>
                <HistoryButton onClick={() => setView(live)} disabled={!browsing} label="Back to the current position" on={browsing}>
                  <LastIcon size={18} />
                </HistoryButton>
              </div>
            </div>
            {browsing && (
              <button className="mb-1 text-xs text-brass underline-offset-2 hover:underline" onClick={() => setView(live)}>
                Looking back · return to the current position
              </button>
            )}
            <OpeningTrail trail={trail} className="mb-1" />
            <MoveList sans={path.sans.slice(0, live)} view={view} onJump={setView} />
            {endNote && run.finished && <p className="mt-2 text-xs text-muted">↪ {endNote}</p>}
          </div>

          <div className="flex gap-2 lg:mt-auto">
            <button className="btn-ghost" onClick={() => goToLine(index - 1)} disabled={index === 0} title={`Play the previous ${item} again (not graded)`}>
              <PrevIcon size={16} /> Previous {item}
            </button>
            <Link className="btn-ghost" to={builderUrl(rep.id, path.ucis.slice(0, view))} title="Open this position in the builder (ends the session)">
              Open in builder
            </Link>
            <button className="btn-ghost ml-auto max-md:hidden" onClick={endSession}>
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
            <span className="ml-auto" title="Pause after each correct move to show what it threatens and does">
              <Toggle
                label="Explain moves"
                checked={explain}
                onChange={(on) => {
                  setExplain(on)
                  // Turning it on later shouldn't open an explanation for a move already past.
                  setContinued(fbId)
                  try {
                    localStorage.setItem('explainMoves', on ? 'on' : 'off')
                  } catch {
                    // Preference is optional.
                  }
                }}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** '?' or '??' when an opponent move is a mistake: the symbol you set on it, else the engine's (from cached evaluations). */
function usePunish(move: RepMove | undefined): '?' | '??' | undefined {
  const evals = useLiveQuery(async () => {
    if (!move || move.glyph !== undefined) return undefined
    const rows = await db.evalCache.bulkGet([move.fromKey, move.toKey])
    const map = new Map<string, Evaluation>()
    rows.forEach((r) => r && map.set(r.positionKey, r.data as Evaluation))
    return map
  }, [move])
  if (!move) return undefined
  const g = move.glyph !== undefined ? move.glyph : evals && engineGlyphOf(evals, move.fromKey, move.fromFen, move.uci, move.toKey)
  return g === '?' || g === '??' ? g : undefined
}

/** A compact step button for looking back through the line; touch-sized on touch screens. */
function HistoryButton({
  onClick,
  disabled,
  label,
  on,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  /** Highlighted: the way back to the live position while looking back. */
  on?: boolean
  children: ReactNode
}) {
  return (
    <button
      className={`grid size-9 place-items-center rounded-lg transition pointer-coarse:size-11 disabled:pointer-events-none disabled:opacity-30 ${
        on ? 'bg-brass/12 text-brass' : 'text-muted hover:bg-surface-3 hover:text-ink'
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  )
}

/** The moves so far, numbered; click one to look at the position after it. */
function MoveList({ sans, view, onJump }: { sans: string[]; view: number; onJump: (ply: number) => void }) {
  if (!sans.length) return <p className="font-display text-[17px] leading-relaxed text-faint">Starting position</p>
  return (
    <p className="font-display text-[17px] leading-relaxed">
      {sans.map((san, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {i % 2 === 0 && `${i / 2 + 1}. `}
          <button
            className={`rounded px-0.5 transition-colors ${i + 1 === view ? 'bg-maple/15 px-1 text-maple' : 'hover:text-maple'}`}
            onClick={(e) => {
              onJump(i + 1)
              // A lingering focus ring would read as a second highlighted move (keyboard focus stays).
              if (e.detail) e.currentTarget.blur()
            }}
            aria-current={i + 1 === view ? 'step' : undefined}
          >
            {san}
          </button>
        </span>
      ))}
    </p>
  )
}

function FeedbackCard({
  feedback,
  awaiting,
  demo,
  autoMine,
  punish,
}: {
  feedback?: Feedback
  awaiting: boolean
  demo: boolean
  /** The next move is one of the owner's mastered moves, played automatically. */
  autoMine: boolean
  /** The opponent's last move is a mistake to punish. */
  punish?: { glyph: '?' | '??'; move: string }
}) {
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
      <div className="min-w-0">
        {punish && (
          <p className="mb-1 text-sm">
            <span className={`font-semibold ${GLYPH_TONE[punish.glyph]}`}>
              {punish.move}
              {punish.glyph}
            </span>{' '}
            is {punish.glyph === '??' ? 'a blunder' : 'a mistake'}. Find the move that punishes it.
          </p>
        )}
        <p className="text-[15px] leading-snug">{feedback?.text ?? (awaiting ? 'Your move.' : autoMine ? 'Playing known moves…' : 'Watch the reply…')}</p>
        {feedback?.record && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <KnowledgeChip level={feedback.record.level} />
            <span className="tabular-nums">{feedback.record.text}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function Summary({
  mode,
  stats,
  item,
  reached,
  total,
  know,
  again,
}: {
  mode: TrainMode
  stats: Stats
  /** What one step of the session is: a line, or a single move in Train › Moves. */
  item: 'move' | 'line'
  /** Steps you got to before the session ended. */
  reached: number
  total: number
  know: KnowMap
  again?: string
}) {
  const attempts = stats.correct + stats.wrong
  const accuracy = attempts ? stats.correct / attempts : null
  // Not when the session was ended before playing anything. The timeout skips StrictMode's double run.
  useEffect(() => {
    if (!attempts) return
    const t = setTimeout(() => playSound('session-complete'))
    return () => clearTimeout(t)
  }, [attempts])
  // The moves asked, with their cards as the session left them.
  const cards = useLiveQuery(
    () => db.cards.where('[repertoireId+positionKey]').anyOf(stats.asked.map((k) => k.split('|') as [string, string])).toArray(),
    [stats.asked],
  )
  const counts = useMemo(() => {
    if (!cards) return undefined
    const now = new Date()
    const c = emptyCounts()
    for (const card of cards) c[knowledgeOf(card.fsrs, know.get(knowKey(card.repertoireId, card.positionKey))?.record, now)]++
    return c
  }, [cards, know])
  return (
    <div className="card mx-auto mt-6 max-w-md animate-rise p-6 md:p-8">
      <div className="flex items-center gap-5">
        <ScoreRing value={accuracy} size={88} stroke={6} />
        <div>
          <div className="eyebrow">{MODE_TITLE[mode]}</div>
          <h1 className="page-title mt-1">Session complete</h1>
          <p className="mt-1 text-sm text-muted">
            {reached < total ? `${reached} of ${total}` : total} {item}
            {total === 1 ? '' : 's'} · {stats.correct} correct · {stats.wrong} mistake{stats.wrong === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {counts && stats.asked.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow mb-2">
            The {stats.asked.length} move{stats.asked.length === 1 ? '' : 's'} you were asked, now
          </div>
          <KnowledgeBar counts={counts} hideNew />
        </div>
      )}
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
        <Link className="btn-ghost flex-1" to={again ?? trainUrl('train')}>
          <TargetIcon size={16} /> {again ? 'Train again' : 'Train'}
        </Link>
      </div>
    </div>
  )
}
