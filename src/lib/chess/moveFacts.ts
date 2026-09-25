import { attacks, between, bishopAttacks, rookAttacks } from 'chessops/attacks'
import type { Board } from 'chessops/board'
import { normalizeMove } from 'chessops/chess'
import { SquareSet } from 'chessops/squareSet'
import type { Color, Role, Square } from 'chessops/types'
import { makeSquare, opposite, parseUci } from 'chessops/util'
import { setupPosition } from './position'

/** Something a move does that you can see on the board, without an engine. */
export type MoveFact =
  | { kind: 'check' }
  | { kind: 'castles'; side: 'short' | 'long' }
  | { kind: 'develops'; role: Role; square: string }
  | {
      kind: 'attacks'
      role: Role
      square: string
      /** Nothing defends the attacked piece. */
      undefended: boolean
      /** A cheaper piece attacks it, so trading doesn't help. */
      byLower: boolean
      /** The attack comes from another piece the move uncovered. */
      discovered: boolean
    }
  | { kind: 'pins'; role: Role; square: string; to: Role }
  | { kind: 'opens'; pieces: { role: Role; square: string }[] }

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 }

/** Squares a slider needs to gain before a pawn move counts as opening a line for it. */
const OPENS_MIN = 2

/**
 * What a move does on the board: check, castling, development, pieces newly
 * attacked (including discovered attacks), new pins and lines opened for the
 * mover's own pieces. Most telling first.
 */
export function moveFacts(fen: string, uci: string): MoveFact[] {
  const before = setupPosition(fen)
  const parsed = parseUci(uci)
  if (!parsed || !('from' in parsed)) return []
  const move = normalizeMove(before, parsed)
  if (!('from' in move) || !before.isLegal(move)) return []
  const mover = before.turn
  const them = opposite(mover)
  const piece = before.board.get(move.from)!
  const target = before.board.get(move.to)
  const castles = piece.role === 'king' && target?.role === 'rook' && target.color === mover
  const after = before.clone()
  after.play(move)
  const landed = castles ? undefined : move.to

  const facts: MoveFact[] = []
  if (after.isCheck()) facts.push({ kind: 'check' })

  // Pins first: they're rarer and usually the point of the move.
  const pinsBefore = new Set(pins(before.board, mover).map((p) => `${p.pinned}-${p.to}`))
  for (const p of pins(after.board, mover)) {
    if (pinsBefore.has(`${p.pinned}-${p.to}`)) continue
    facts.push({ kind: 'pins', role: after.board.get(p.pinned)!.role, square: makeSquare(p.pinned), to: after.board.get(p.to)!.role })
  }

  const attacked: Extract<MoveFact, { kind: 'attacks' }>[] = []
  for (const sq of after.board[them].diff(after.board.king)) {
    const now = attackersOf(after.board, sq, mover)
    if (now.isEmpty()) continue
    // A piece that was already attacked isn't news (the captured one is gone anyway).
    if (before.board[them].has(sq) && attackersOf(before.board, sq, mover).nonEmpty()) continue
    const role = after.board.get(sq)!.role
    const cheapest = Math.min(...[...now].map((a) => VALUE[after.board.get(a)!.role]))
    attacked.push({
      kind: 'attacks',
      role,
      square: makeSquare(sq),
      undefended: attackersOf(after.board, sq, them).isEmpty(),
      byLower: cheapest < VALUE[role],
      discovered: landed === undefined || !now.has(landed),
    })
  }
  // Attacks that threaten to win something first, then by the value of the target.
  const weight = (a: (typeof attacked)[number]) => (a.undefended || a.byLower ? 100 : 0) + VALUE[a.role]
  facts.push(...attacked.sort((a, b) => weight(b) - weight(a)))

  if (castles) facts.push({ kind: 'castles', side: move.to > move.from ? 'short' : 'long' })
  else if (isDevelopment(piece.role, move.from, mover)) facts.push({ kind: 'develops', role: piece.role, square: makeSquare(move.to) })

  // Sliders (other than the one that moved) that reach further now.
  const opened: { role: Role; square: string }[] = []
  const sliders = after.board[mover].intersect(after.board.bishop.union(after.board.rook).union(after.board.queen))
  for (const sq of sliders) {
    if (sq === landed || castles) continue
    const p = after.board.get(sq)!
    const gained = attacks(p, sq, after.board.occupied).diff(attacks(p, sq, before.board.occupied)).size()
    if (gained >= OPENS_MIN) opened.push({ role: p.role, square: makeSquare(sq) })
  }
  if (opened.length) facts.push({ kind: 'opens', pieces: opened })
  return facts
}

function attackersOf(board: Board, sq: Square, color: Color): SquareSet {
  let out = SquareSet.empty()
  for (const from of board[color]) {
    if (attacks(board.get(from)!, from, board.occupied).has(sq)) out = out.with(from)
  }
  return out
}

/**
 * Pieces of the side not moving that are pinned by a bishop, rook or queen of
 * `color`: to their king, or to a piece worth more than them.
 */
function pins(board: Board, color: Color): { pinned: Square; to: Square }[] {
  const them = opposite(color)
  const out: { pinned: Square; to: Square }[] = []
  const targets = board[them].intersect(board.king.union(board.queen).union(board.rook))
  for (const s of board[color].intersect(board.bishop.union(board.rook).union(board.queen))) {
    const role = board.get(s)!.role
    for (const t of targets) {
      const diagonal = bishopAttacks(s, SquareSet.empty()).has(t)
      const straight = rookAttacks(s, SquareSet.empty()).has(t)
      if (!(diagonal && role !== 'rook') && !(straight && role !== 'bishop')) continue
      const blockers = between(s, t).intersect(board.occupied)
      const pinned = blockers.singleSquare()
      if (pinned === undefined || !board[them].has(pinned)) continue
      const pinnedRole = board.get(pinned)!.role
      const targetRole = board.get(t)!.role
      // A queen "pinned" to a rook, or a piece shielded by its own king, isn't a pin.
      if (pinnedRole === 'king' || (targetRole !== 'king' && VALUE[pinnedRole] >= VALUE[targetRole])) continue
      // Nor is a line the pinning piece itself is worth more than: a queen against a defended rook.
      if (targetRole !== 'king' && VALUE[role] > VALUE[targetRole]) continue
      out.push({ pinned, to: t })
    }
  }
  return out
}

function isDevelopment(role: Role, from: Square, color: Color): boolean {
  if (role !== 'knight' && role !== 'bishop') return false
  const home = color === 'white' ? [1, 6, 2, 5] : [57, 62, 58, 61]
  return home.includes(from)
}

const NAME: Record<Role, string> = { pawn: 'pawn', knight: 'knight', bishop: 'bishop', rook: 'rook', queen: 'queen', king: 'king' }

/** A fact as a short sentence. */
export function describeFact(f: MoveFact): string {
  switch (f.kind) {
    case 'check':
      return 'Gives check.'
    case 'castles':
      return f.side === 'short' ? 'Castles kingside: the king is safe and a rook joins the game.' : 'Castles queenside: the rook lands on the d-file.'
    case 'develops':
      return `Develops the ${NAME[f.role]} to ${f.square}.`
    case 'attacks': {
      const what = `${f.undefended ? 'undefended ' : ''}${NAME[f.role]} on ${f.square}`
      return f.discovered ? `Uncovers an attack on the ${what}.` : `Attacks the ${what}.`
    }
    case 'pins':
      return `Pins the ${NAME[f.role]} on ${f.square} to the ${NAME[f.to]}.`
    case 'opens': {
      const names = f.pieces.map((p) => `the ${NAME[p.role]} on ${p.square}`)
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
      return `Opens lines for ${list}.`
    }
  }
}

/** Whether a fact points at material that could be won (worth highlighting). */
export function isThreatening(f: MoveFact): boolean {
  return f.kind === 'check' || f.kind === 'pins' || (f.kind === 'attacks' && (f.undefended || f.byLower))
}
