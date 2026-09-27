import type { Game, Repertoire } from '../../db/schema'
import { pathTo } from '../chess/graph'
import { formatMoves, playUci, positionKey, START_FEN, turnOf, type Color } from '../chess/position'
import { startsWith } from '../chess/start'
import type { Naming } from '../openings/naming'
import { shortName, variationOf } from '../openings/names'
import { builderUrl, planUrl } from '../routes'
import { gameKeys, scoreOf, type GameAnalysis, type RepIndex } from './analyze'

// Your own games as an opening tree, compared with your repertoires: what you
// play as White and as Black, how you score, and where to prepare.

export interface GameMove {
  uci: string
  san: string
  toKey: string
  games: Game[]
}

/** A position your games reached, and what was played there (most frequent first). */
export interface GameNode {
  key: string
  games: Game[]
  moves: GameMove[]
}

export type GameTree = Map<string, GameNode>

/**
 * The positions of a set of games (usually all of one colour). Keyed by
 * position, so games that transpose into each other meet.
 */
export function buildGameTree(games: Game[]): GameTree {
  const tree: GameTree = new Map()
  const node = (key: string) => {
    let n = tree.get(key)
    if (!n) tree.set(key, (n = { key, games: [], moves: [] }))
    return n
  }
  for (const g of games) {
    const keys = gameKeys(g)
    const seen = new Set<string>()
    keys.forEach((key, ply) => {
      // A position repeated inside one game counts once.
      if (seen.has(key)) return
      seen.add(key)
      const n = node(key)
      n.games.push(g)
      const uci = g.moves[ply]
      if (uci === undefined) return
      let m = n.moves.find((x) => x.uci === uci)
      if (!m) n.moves.push((m = { uci, san: g.sans[ply], toKey: keys[ply + 1], games: [] }))
      m.games.push(g)
    })
  }
  for (const n of tree.values()) n.moves.sort((a, b) => b.games.length - a.games.length)
  return tree
}

export interface Wdl {
  win: number
  draw: number
  loss: number
}

export function wdlOf(games: Game[]): Wdl {
  const w: Wdl = { win: 0, draw: 0, loss: 0 }
  for (const g of games) w[g.result]++
  return w
}

/** Position keys along a line of UCI moves from the initial position (index = ply). */
export function pathKeys(path: string[]): string[] {
  const keys = [positionKey(START_FEN)]
  let fen = START_FEN
  for (const uci of path) {
    const m = playUci(fen, uci)
    if (!m) break
    fen = m.fen
    keys.push(positionKey(fen))
  }
  return keys
}

/** Repertoires (of the colour you play in these games) whose lines reach a position. */
export const activeReps = (key: string, reps: RepIndex[]) => reps.filter((r) => r.graph.depth.has(key))

/**
 * How a move from your games compares with your repertoires:
 * - rep:        a repertoire move (yours, or an opponent reply you have prepared)
 * - deviates:   your move, where your repertoire has another one
 * - unanswered: an opponent move your repertoire has no answer to
 * - none:       no repertoire covers the position, or its line has ended
 */
export type MoveMark = 'rep' | 'deviates' | 'unanswered' | 'none'

export function moveMark(key: string, uci: string, color: Color, reps: RepIndex[]): MoveMark {
  const active = activeReps(key, reps.filter((r) => r.rep.color === color))
  const prepared = active.flatMap((r) => r.graph.movesFrom.get(key) ?? [])
  if (!prepared.length) return 'none'
  if (prepared.some((m) => m.uci === uci)) return 'rep'
  return turnOf(key) === color ? 'deviates' : 'unanswered'
}

export interface GroupStats {
  games: number
  wdl: Wdl
  /** Your score (win = 1, draw = ½). */
  score: number
  /** Share of the games that reached one of your repertoires. */
  inRep: number
  /** Of the games that reached a repertoire: the share where you never played another move than yours. */
  playedRight: number | null
  /** Of the games that reached a repertoire: your moves played from it, on average. */
  avgOwnMoves: number | null
}

export function groupStats(analyses: GameAnalysis[]): GroupStats {
  const games = analyses.map((a) => a.game)
  const inRep = analyses.filter((a) => a.repertoireId)
  return {
    games: games.length,
    wdl: wdlOf(games),
    score: scoreOf(games),
    inRep: games.length ? inRep.length / games.length : 0,
    playedRight: inRep.length ? inRep.filter((a) => a.outcome !== 'forgot').length / inRep.length : null,
    avgOwnMoves: inRep.length ? inRep.reduce((s, a) => s + a.ownMoves, 0) / inRep.length : null,
  }
}

/** Games grouped by opening: family ("Vienna Game"), variation, then the full name. */
export interface OpeningGroup {
  id: string
  /** Name to show, without the part it shares with its parent. */
  label: string
  fullName: string
  eco?: string
  analyses: GameAnalysis[]
  stats: GroupStats
  /** The most common line (UCI) of these games to the position where the name starts. */
  at: string[]
  sans: string[]
  children: OpeningGroup[]
}

const LEVELS = [(n: string) => n.split(':')[0], variationOf, (n: string) => n] as const

/**
 * Groups games by the deepest standard opening name they reached (the user's
 * own names are left out: they don't follow the family / variation pattern).
 * Games without any named position are grouped by their first two moves.
 */
export function openingGroups(analyses: GameAnalysis[], naming: Pick<Naming, 'opening'>): OpeningGroup[] {
  interface Acc {
    fullName: string
    eco?: string
    analyses: GameAnalysis[]
    lines: Map<string, { n: number; at: string[]; sans: string[] }>
    children: Map<string, Acc>
  }
  const root = new Map<string, Acc>()
  for (const a of analyses) {
    const keys = gameKeys(a.game)
    const names = keys.map((k) => naming.opening(k))
    let last = -1
    names.forEach((n, i) => n && (last = i))
    const final = last >= 0 ? names[last]! : undefined
    let level = root
    let prev: string | undefined
    for (const cut of LEVELS) {
      const label = final ? cut(final.name) : formatMoves(a.game.sans.slice(0, 2)) || 'Starting position'
      if (label === prev) continue
      prev = label
      let acc = level.get(label)
      if (!acc) level.set(label, (acc = { fullName: label, analyses: [], lines: new Map(), children: new Map() }))
      acc.analyses.push(a)
      // The line to the first position where this level's name applies.
      const ply = final ? names.findIndex((n) => n && cut(n.name) === label) : Math.min(2, a.game.moves.length)
      if (final) acc.eco ??= names[ply]?.eco
      const at = a.game.moves.slice(0, ply)
      const id = at.join(',')
      const line = acc.lines.get(id)
      if (line) line.n++
      else acc.lines.set(id, { n: 1, at, sans: a.game.sans.slice(0, ply) })
      level = acc.children
      if (!final) break
    }
  }
  const finish = (level: Map<string, Acc>, parent?: string, prefix = ''): OpeningGroup[] =>
    [...level.values()]
      .map((acc) => {
        const line = [...acc.lines.values()].sort((x, y) => y.n - x.n)[0]
        const id = `${prefix}/${acc.fullName}`
        return {
          id,
          label: shortName(acc.fullName, parent),
          fullName: acc.fullName,
          eco: acc.eco,
          analyses: acc.analyses,
          stats: groupStats(acc.analyses),
          at: line.at,
          sans: line.sans,
          children: finish(acc.children, acc.fullName, id),
        }
      })
      .sort((x, y) => y.analyses.length - x.analyses.length || x.fullName.localeCompare(y.fullName))
  return finish(root)
}

export type BuilderTarget =
  | { kind: 'builder'; url: string; rep: Repertoire; /** The line goes past the repertoire's end. */ past: boolean }
  | { kind: 'plan'; url: string }
  | { kind: 'new'; url: string }

/**
 * Where to prepare a line from your games:
 * - in (or past the end of) a repertoire: the builder, at this line, following
 *   the repertoire's own move order up to where the game left it;
 * - before a repertoire's starting moves: the guided plan for the colour;
 * - otherwise: a new repertoire starting with these moves.
 */
export function builderTarget(path: string[], sans: string[], color: Color, reps: RepIndex[]): BuilderTarget {
  const keys = pathKeys(path)
  let best: { r: RepIndex; ply: number } | undefined
  for (const r of reps) {
    if (r.rep.color !== color) continue
    for (let ply = keys.length - 1; ply >= 0; ply--) {
      if (!r.graph.depth.has(keys[ply])) continue
      if (!best || ply > best.ply) best = { r, ply }
      break
    }
  }
  if (best) {
    const { r, ply } = best
    const line = [...r.start.moves, ...pathTo(r.graph, keys[ply]).map((m) => m.uci), ...path.slice(ply)]
    return { kind: 'builder', url: builderUrl(r.rep.id, line), rep: r.rep, past: ply < keys.length - 1 }
  }
  if (reps.some((r) => r.rep.color === color && startsWith(r.start.moves, path)))
    return { kind: 'plan', url: planUrl(color, path) }
  return { kind: 'new', url: `/?newColor=${color}&newStart=${encodeURIComponent(formatMoves(sans))}` }
}
