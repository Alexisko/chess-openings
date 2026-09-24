import { parseUci } from 'chessops/util'
import type { Game, Repertoire } from '../../db/schema'
import { pathTo, type RepGraph } from '../chess/graph'
import { keyOf, setupPosition, START_FEN, turnOf, type Color } from '../chess/position'
import type { StartPosition } from '../chess/start'

/**
 * Where a game left preparation:
 * - forgot:      you played something else where your repertoire has a move
 * - opp-left:    the opponent played a move you have no answer to
 * - prep-ended:  your line had ended, so you were on your own
 * - in-prep:     the game (or its stored opening) ended while still in preparation
 * - not-covered: the game never reached one of your repertoires
 */
export type Outcome = 'forgot' | 'opp-left' | 'prep-ended' | 'in-prep' | 'not-covered'

export interface GameAnalysis {
  game: Game
  outcome: Outcome
  repertoireId?: string
  /** Index in game.moves of the move that left preparation (= plies played before it). */
  ply: number
  /** Position where preparation was left. */
  key: string
  /** Own moves played from the repertoire before leaving it. */
  ownMoves: number
  /** For 'forgot': the repertoire move you should have played. */
  expected?: { uci: string; san: string }
}

export interface RepIndex {
  rep: Repertoire
  graph: RepGraph
  start: StartPosition
}

const keyCache = new Map<string, string[]>()

/** Position keys before every move of a game (plus the final position). Games never change, so this is cached. */
export function gameKeys(game: Game): string[] {
  let keys = keyCache.get(game.id)
  if (!keys) {
    const pos = setupPosition(START_FEN)
    keys = [keyOf(pos)]
    for (const uci of game.moves) {
      pos.play(parseUci(uci)!)
      keys.push(keyOf(pos))
    }
    keyCache.set(game.id, keys)
  }
  return keys
}

function walk(game: Game, keys: string[], r: RepIndex, startPly: number): GameAnalysis {
  const base = { game, repertoireId: r.rep.id }
  let ownMoves = 0
  for (let ply = startPly; ; ply++) {
    const key = keys[ply]
    const uci = game.moves[ply]
    if (uci === undefined) return { ...base, outcome: 'in-prep', ply, key, ownMoves }
    const prepared = r.graph.movesFrom.get(key) ?? []
    if (turnOf(key) === game.color) {
      const mine = prepared[0]
      if (!mine) return { ...base, outcome: 'prep-ended', ply, key, ownMoves }
      if (mine.uci !== uci) return { ...base, outcome: 'forgot', ply, key, ownMoves, expected: { uci: mine.uci, san: mine.san } }
      ownMoves++
    } else {
      if (!prepared.length) return { ...base, outcome: 'prep-ended', ply, key, ownMoves }
      if (!prepared.some((m) => m.uci === uci)) return { ...base, outcome: 'opp-left', ply, key, ownMoves }
    }
  }
}

const commonPrefix = (a: string[], b: string[]) => {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * Compares a game with the repertoires of the colour you played. A repertoire
 * applies when the game passes through its starting position (by any move
 * order); if several do, the one you stayed in longest wins.
 */
export function analyzeGame(game: Game, reps: RepIndex[]): GameAnalysis {
  const keys = gameKeys(game)
  const mine = reps.filter((r) => r.rep.color === game.color)
  let best: GameAnalysis | undefined
  for (const r of mine) {
    const startPly = keys.indexOf(r.start.key)
    if (startPly < 0) continue
    const a = walk(game, keys, r, startPly)
    if (!best || a.ply > best.ply) best = a
  }
  if (best) return best

  // Not covered: report the move that left every repertoire's starting moves.
  // With no repertoire for this colour, group White games by the reply to your first move.
  const ply = mine.length
    ? Math.max(...mine.map((r) => commonPrefix(game.moves, r.start.moves)))
    : game.color === 'white'
      ? 1
      : 0
  return { game, outcome: 'not-covered', ply, key: keys[Math.min(ply, keys.length - 1)], ownMoves: 0 }
}

export interface FindingMove {
  uci: string
  san: string
  games: Game[]
}

/**
 * Games that left preparation the same way at the same position. Opponent
 * replies you don't answer and openings outside your repertoires are one
 * finding per move, since each needs its own preparation; forgotten moves and
 * line ends are one finding per position, listing what was played there.
 */
export interface Finding {
  id: string
  outcome: Exclude<Outcome, 'in-prep'>
  repertoireId?: string
  color: Color
  key: string
  /** Moves (UCI from the initial position) that lead to `key`, and their SAN. */
  path: string[]
  sans: string[]
  /** Who is to move at `key`. */
  mover: 'me' | 'opponent'
  expected?: { uci: string; san: string }
  /** What was played at `key`, most frequent first. */
  moves: FindingMove[]
  games: Game[]
  /** Your score in these games (win = 1, draw = ½). */
  score: number
  lastPlayed: number
}

export const scoreOf = (games: Game[]) =>
  games.length ? games.reduce((s, g) => s + (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0), 0) / games.length : 0

/**
 * Groups analyses into findings, most frequent first. Paths inside a
 * repertoire follow the repertoire's own move order, so they can be opened in
 * the builder even when the game got there by transposition.
 */
export function collectFindings(analyses: GameAnalysis[], reps: RepIndex[]): Finding[] {
  const byId = new Map(reps.map((r) => [r.rep.id, r]))
  const groups = new Map<string, Finding>()
  for (const a of analyses) {
    if (a.outcome === 'in-prep') continue
    const uci = a.game.moves[a.ply]
    if (uci === undefined) continue
    const perMove = a.outcome === 'opp-left' || a.outcome === 'not-covered'
    const id = `${a.outcome}|${a.repertoireId ?? a.game.color}|${a.key}${perMove ? `|${uci}` : ''}`
    let f = groups.get(id)
    if (!f) {
      const r = a.repertoireId ? byId.get(a.repertoireId) : undefined
      const inRep = r ? pathTo(r.graph, a.key) : []
      const viaRep = r && (inRep.length > 0 || a.key === r.graph.root)
      f = {
        id,
        outcome: a.outcome,
        repertoireId: a.repertoireId,
        color: a.game.color,
        key: a.key,
        path: viaRep ? [...r.start.moves, ...inRep.map((m) => m.uci)] : a.game.moves.slice(0, a.ply),
        sans: viaRep ? [...r.start.sans, ...inRep.map((m) => m.san)] : a.game.sans.slice(0, a.ply),
        mover: turnOf(a.key) === a.game.color ? 'me' : 'opponent',
        expected: a.expected,
        moves: [],
        games: [],
        score: 0,
        lastPlayed: 0,
      }
      groups.set(id, f)
    }
    f.games.push(a.game)
    f.lastPlayed = Math.max(f.lastPlayed, a.game.playedAt)
    let m = f.moves.find((x) => x.uci === uci)
    if (!m) f.moves.push((m = { uci, san: a.game.sans[a.ply], games: [] }))
    m.games.push(a.game)
  }
  const out = [...groups.values()]
  for (const f of out) {
    f.score = scoreOf(f.games)
    f.moves.sort((a, b) => b.games.length - a.games.length)
  }
  return out.sort((a, b) => b.games.length - a.games.length || b.lastPlayed - a.lastPlayed)
}

export interface RepSummary {
  repertoireId: string
  games: number
  /** Average own moves played from the repertoire. */
  avgOwnMoves: number
  forgot: number
  score: number
}

/** Per repertoire: how many games reached it, how deep you stayed in it, and how you scored. */
export function summarizeByRepertoire(analyses: GameAnalysis[]): RepSummary[] {
  const groups = new Map<string, GameAnalysis[]>()
  for (const a of analyses) {
    if (!a.repertoireId) continue
    const list = groups.get(a.repertoireId)
    if (list) list.push(a)
    else groups.set(a.repertoireId, [a])
  }
  return [...groups.entries()].map(([repertoireId, list]) => ({
    repertoireId,
    games: list.length,
    avgOwnMoves: list.reduce((s, a) => s + a.ownMoves, 0) / list.length,
    forgot: list.filter((a) => a.outcome === 'forgot').length,
    score: scoreOf(list.map((a) => a.game)),
  }))
}
