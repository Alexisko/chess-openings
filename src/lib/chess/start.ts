import type { Repertoire } from '../../db/schema'
import { pgnToLines } from './pgn'
import { positionKey, replay, START_FEN } from './position'

/** Where a repertoire starts: the setup moves and the position they reach. */
export interface StartPosition {
  moves: string[]
  sans: string[]
  fen: string
  key: string
}

const cache = new Map<string, StartPosition>()

export function startOf(moves: string[] = []): StartPosition {
  const id = moves.join(',')
  let hit = cache.get(id)
  if (!hit) {
    const played = replay(moves)
    const fen = played.at(-1)?.fen ?? START_FEN
    hit = { moves: played.map((p) => p.uci), sans: played.map((p) => p.san), fen, key: positionKey(fen) }
    cache.set(id, hit)
  }
  return hit
}

export const repStart = (rep: Pick<Repertoire, 'startMoves'>) => startOf(rep.startMoves ?? [])

/** Parses typed moves like "1.e4 e5 2.Nc3" into UCI. Throws with a readable message. */
export function parseMoves(text: string): string[] {
  if (!text.trim()) return []
  const { lines, errors } = pgnToLines(`${text.trim()} *`)
  if (errors.length || lines.length !== 1) throw new Error(errors[0] ?? 'Enter a single line of moves, like 1.e4 e5 2.Nc3')
  return lines[0]
}

/** Plies played before a position, from the FEN's move number and side to move. */
export function plyOfFen(fen: string): number {
  const [, turn, , , , full] = fen.split(' ')
  return (Number(full || 1) - 1) * 2 + (turn === 'b' ? 1 : 0)
}

/** True when `path` begins with `prefix`. */
export const startsWith = (path: string[], prefix: string[]) =>
  path.length >= prefix.length && prefix.every((u, i) => path[i] === u)
