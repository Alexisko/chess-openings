import { Chess, normalizeMove } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen'
import { makeSan } from 'chessops/san'
import { makeSquare, makeUci, parseUci } from 'chessops/util'
import type { Color } from 'chessops/types'

export type { Color }

/** Full FEN of the starting position. */
export const START_FEN = INITIAL_FEN

export function setupPosition(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
}

/**
 * Identity of a position regardless of move order: board, side to move,
 * castling rights and a *legal* en-passant square. Move counters are dropped
 * so transpositions share the same key.
 */
export function positionKey(fen: string): string {
  return keyOf(setupPosition(fen))
}

/** Position key of a chessops position (see positionKey). */
export function keyOf(pos: Chess): string {
  return makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ')
}

/** Full FEN (with counters) from a position. */
export function toFen(pos: Chess): string {
  return makeFen(pos.toSetup())
}

export function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

export interface PlayedMove {
  /** Canonical UCI (castling as king-takes-rook, e.g. e1h1, like Lichess). */
  uci: string
  san: string
  fen: string
}

/**
 * Plays a UCI move (either castling notation accepted) and returns the
 * canonical move and resulting FEN, or null if illegal.
 */
export function playUci(fen: string, uci: string): PlayedMove | null {
  const pos = setupPosition(fen)
  const parsed = parseUci(uci)
  if (!parsed) return null
  const move = normalizeMove(pos, parsed)
  if (!pos.isLegal(move)) return null
  const san = makeSan(pos, move)
  pos.play(move)
  return { uci: makeUci(move), san, fen: toFen(pos) }
}

/** Canonical form of a UCI move in a position (so e1g1 and e1h1 compare equal). */
export function canonicalUci(fen: string, uci: string): string | null {
  return playUci(fen, uci)?.uci ?? null
}

export function sameMove(fen: string, a: string, b: string): boolean {
  const ca = canonicalUci(fen, a)
  return ca !== null && ca === canonicalUci(fen, b)
}

/** Legal destinations in the shape chessground expects. */
export function legalDests(fen: string): Map<string, string[]> {
  const dests = chessgroundDests(setupPosition(fen))
  return dests as unknown as Map<string, string[]>
}

export function isCheck(fen: string): boolean {
  return setupPosition(fen).isCheck()
}

/** From/to squares for drawing a move; castling is shown as the king's move. */
export function moveSquares(fen: string, uci: string): [string, string] | null {
  const pos = setupPosition(fen)
  const parsed = parseUci(uci)
  if (!parsed || !('from' in parsed)) return null
  const move = normalizeMove(pos, parsed)
  if (!('from' in move)) return null
  const piece = pos.board.get(move.from)
  const target = pos.board.get(move.to)
  if (piece?.role === 'king' && target?.role === 'rook' && target.color === piece.color) {
    const kingTo = move.to > move.from ? move.from + 2 : move.from - 2
    return [makeSquare(move.from), makeSquare(kingTo)]
  }
  return [makeSquare(move.from), makeSquare(move.to)]
}

const PROMOTIONS = ['queen', 'knight', 'rook', 'bishop'] as const

/**
 * Whether one position follows another by a single legal move, and whether
 * that move captures; null when they aren't one move apart.
 */
export function moveBetween(fromFen: string, toFen: string): { capture: boolean } | null {
  const pos = setupPosition(fromFen)
  const target = positionKey(toFen)
  for (const [from, dests] of pos.allDests()) {
    const pawn = pos.board.get(from)?.role === 'pawn'
    for (const to of dests) {
      const lastRank = to >> 3 === 0 || to >> 3 === 7
      for (const promotion of pawn && lastRank ? PROMOTIONS : [undefined]) {
        const next = pos.clone()
        next.play({ from, to, promotion })
        if (keyOf(next) === target) return { capture: next.board.occupied.size() < pos.board.occupied.size() }
      }
    }
  }
  return null
}

/** Replays a list of UCI moves from a FEN. Throws on an illegal move. */
export function replay(uci: string[], fen = START_FEN): PlayedMove[] {
  const out: PlayedMove[] = []
  let cur = fen
  for (const u of uci) {
    const m = playUci(cur, u)
    if (!m) throw new Error(`Illegal move ${u} in ${cur}`)
    out.push(m)
    cur = m.fen
  }
  return out
}

/** "1. e4 e5 2. Nf3" style text for a list of SAN moves starting at a given ply. */
export function formatMoves(sans: string[], startPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = startPly + i
      if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`
      return i === 0 ? `${Math.floor(ply / 2) + 1}... ${san}` : san
    })
    .join(' ')
}

/** A full FEN for a position key (move counters are irrelevant to lookups). */
export function keyToFen(key: string): string {
  return `${key} 0 1`
}
