import { createEmptyCard } from 'ts-fsrs'
import { buildGraph, cardPositions, movesToRemove } from '../lib/chess/graph'
import { playUci, positionKey, START_FEN, turnOf, type Color } from '../lib/chess/position'
import { db, now, uuid, type AppDB, type RepMove, type Repertoire } from './schema'

export async function createRepertoire(name: string, color: Color, d: AppDB = db): Promise<Repertoire> {
  const t = now()
  const rep: Repertoire = { id: uuid(), name, color, createdAt: t, updatedAt: t }
  await d.repertoires.add(rep)
  return rep
}

export async function renameRepertoire(id: string, name: string, d: AppDB = db) {
  await d.repertoires.update(id, { name, updatedAt: now() })
}

export async function deleteRepertoire(id: string, d: AppDB = db) {
  await d.transaction('rw', [d.repertoires, d.moves, d.cards, d.reviews], async () => {
    await d.moves.where({ repertoireId: id }).delete()
    await d.cards.where({ repertoireId: id }).delete()
    await d.reviews.where({ repertoireId: id }).delete()
    await d.repertoires.delete(id)
  })
}

export function loadMoves(repertoireId: string, d: AppDB = db): Promise<RepMove[]> {
  return d.moves.where({ repertoireId }).toArray()
}

/** Raised when a line needs a different move where the repertoire already has one. */
export class MoveConflictError extends Error {
  readonly fromKey: string
  readonly existing: RepMove
  readonly wantedUci: string
  readonly wantedSan: string

  constructor(fromKey: string, existing: RepMove, wantedUci: string, wantedSan: string) {
    super(`Repertoire already plays ${existing.san} here (wanted ${wantedSan})`)
    this.fromKey = fromKey
    this.existing = existing
    this.wantedUci = wantedUci
    this.wantedSan = wantedSan
  }
}

export interface AddLineResult {
  added: RepMove[]
}

/**
 * Adds a line of moves (UCI from `startFen`) to a repertoire. Moves already
 * present are reused. Throws MoveConflictError if one of the owner's moves
 * differs from the repertoire, unless `replace` is set, in which case the old
 * move and everything only reachable through it is removed.
 */
export async function addLine(
  rep: Repertoire,
  uciMoves: string[],
  opts: { startFen?: string; replace?: boolean } = {},
  d: AppDB = db,
): Promise<AddLineResult> {
  return d.transaction('rw', [d.moves, d.cards, d.repertoires], async () => {
    const added: RepMove[] = []
    let moves = await loadMoves(rep.id, d)
    let fen = opts.startFen ?? START_FEN
    for (const uci of uciMoves) {
      const played = playUci(fen, uci)
      if (!played) throw new Error(`Illegal move ${uci}`)
      const fromKey = positionKey(fen)
      const byMe = turnOf(fen) === rep.color
      const existing = moves.filter((m) => m.fromKey === fromKey)
      if (!existing.some((m) => m.uci === played.uci)) {
        const mine = byMe ? existing[0] : undefined
        if (mine) {
          if (!opts.replace) throw new MoveConflictError(fromKey, mine, played.uci, played.san)
          await removeMoves(rep, new Set([mine.id]), d)
          // The owner's answer changed, so the old card history no longer applies.
          await d.cards.where({ repertoireId: rep.id, positionKey: fromKey }).delete()
          moves = await loadMoves(rep.id, d)
        }
        const t = now()
        const move: RepMove = {
          id: uuid(),
          repertoireId: rep.id,
          fromKey,
          toKey: positionKey(played.fen),
          fromFen: fen,
          uci: played.uci,
          san: played.san,
          byMe,
          comment: '',
          createdAt: t,
          updatedAt: t,
        }
        await d.moves.add(move)
        moves.push(move)
        added.push(move)
      }
      fen = played.fen
    }
    await reconcileCards(rep, d)
    await d.repertoires.update(rep.id, { updatedAt: now() })
    return { added }
  })
}

/** Deletes moves and everything left unreachable; returns the removed moves. */
export async function removeMoves(rep: Repertoire, ids: Set<string>, d: AppDB = db): Promise<RepMove[]> {
  return d.transaction('rw', [d.moves, d.cards, d.repertoires], async () => {
    const moves = await loadMoves(rep.id, d)
    const gone = movesToRemove(moves, rep.color, ids)
    await d.moves.bulkDelete(gone.map((m) => m.id))
    await reconcileCards(rep, d)
    await d.repertoires.update(rep.id, { updatedAt: now() })
    return gone
  })
}

/** Preview of what removing a move would delete (for confirmation dialogs). */
export async function previewRemoval(rep: Repertoire, id: string, d: AppDB = db): Promise<RepMove[]> {
  const moves = await loadMoves(rep.id, d)
  return movesToRemove(moves, rep.color, new Set([id]))
}

/** Ensures there is exactly one card per position where the owner has a move. */
export async function reconcileCards(rep: Repertoire, d: AppDB = db) {
  const moves = await loadMoves(rep.id, d)
  const wanted = new Set(cardPositions(buildGraph(moves, rep.color)))
  const cards = await d.cards.where({ repertoireId: rep.id }).toArray()
  const have = new Set(cards.map((c) => c.positionKey))
  const stale = cards.filter((c) => !wanted.has(c.positionKey)).map((c) => c.id)
  if (stale.length) await d.cards.bulkDelete(stale)
  const t = now()
  const fresh = [...wanted]
    .filter((k) => !have.has(k))
    .map((positionKey) => ({
      id: uuid(),
      repertoireId: rep.id,
      positionKey,
      fsrs: createEmptyCard(new Date(t)),
      createdAt: t,
      updatedAt: t,
    }))
  if (fresh.length) await d.cards.bulkAdd(fresh)
}

export async function setMoveComment(id: string, comment: string, d: AppDB = db) {
  await d.moves.update(id, { comment, updatedAt: now() })
}

export async function setPositionNote(key: string, note: string, d: AppDB = db) {
  const existing = await d.positions.get(key)
  await d.positions.put({ key, note, tags: existing?.tags ?? [], updatedAt: now() })
}
