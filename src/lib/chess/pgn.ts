import { makeFen } from 'chessops/fen'
import { ChildNode, defaultGame, makePgn, parsePgn, startingPosition, type Node, type PgnNodeData } from 'chessops/pgn'
import { parseSan } from 'chessops/san'
import { makeUci } from 'chessops/util'
import type { RepMove } from '../../db/schema'
import { ROOT_KEY, type RepGraph } from './graph'

/**
 * Extracts every root-to-leaf line (as UCI lists from the standard start) from
 * PGN text, including all variations. Games with a custom start are skipped.
 */
export function pgnToLines(text: string): { lines: string[][]; errors: string[] } {
  const lines: string[][] = []
  const errors: string[] = []
  for (const game of parsePgn(text)) {
    const start = startingPosition(game.headers)
    if (start.isErr) {
      errors.push(`Unsupported starting position: ${start.error.message}`)
      continue
    }
    const initial = start.value
    if (makeFen(initial.toSetup()).split(' ')[0] !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') {
      errors.push('Games starting from a custom position are skipped')
      continue
    }
    const walk = (node: Node<PgnNodeData>, pos: typeof initial, path: string[]) => {
      if (node.children.length === 0) {
        if (path.length) lines.push(path)
        return
      }
      for (const child of node.children) {
        const move = parseSan(pos, child.data.san)
        if (!move) {
          errors.push(`Illegal move ${child.data.san} after ${path.length} plies`)
          if (path.length) lines.push(path)
          continue
        }
        const next = pos.clone()
        next.play(move)
        walk(child, next, [...path, makeUci(move)])
      }
    }
    walk(game.moves, initial, [])
  }
  return { lines, errors }
}

/** Exports a repertoire as a single PGN game with variations. */
export function graphToPgn(g: RepGraph, name: string): string {
  const game = defaultGame<PgnNodeData>()
  game.headers.set('Event', name)
  game.headers.set('Site', 'Opening Trainer')
  game.headers.delete('Result')
  const visit = (key: string, node: Node<PgnNodeData>) => {
    for (const m of g.movesFrom.get(key) ?? []) {
      const child = new ChildNode<PgnNodeData>({ san: m.san, comments: commentsFor(g, m) })
      node.children.push(child)
      if (!g.transpositions.has(m.id)) visit(m.toKey, child)
    }
  }
  visit(ROOT_KEY, game.moves)
  return makePgn(game)
}

function commentsFor(g: RepGraph, m: RepMove): string[] | undefined {
  const parts: string[] = []
  if (m.comment) parts.push(m.comment)
  if (g.transpositions.has(m.id)) parts.push('Transposes')
  return parts.length ? parts : undefined
}
