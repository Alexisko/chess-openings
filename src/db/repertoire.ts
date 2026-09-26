import { createEmptyCard } from 'ts-fsrs'
import { buildGraph, cardPositions, movesToRemove } from '../lib/chess/graph'
import { playUci, positionKey, turnOf, type Color } from '../lib/chess/position'
import { repStart, startOf, startsWith } from '../lib/chess/start'
import type { Glyph } from '../lib/chess/glyphs'
import type { ChapterBreak } from '../lib/openings/chapters'
import { db, now, uuid, type AppDB, type PositionNote, type RepMove, type Repertoire } from './schema'

export async function createRepertoire(
  name: string,
  color: Color,
  d: AppDB = db,
  startMoves: string[] = [],
): Promise<Repertoire> {
  const t = now()
  const rep: Repertoire = { id: uuid(), name, color, startMoves: startOf(startMoves).moves, createdAt: t, updatedAt: t }
  await d.repertoires.add(rep)
  return rep
}

export async function renameRepertoire(id: string, name: string, d: AppDB = db) {
  await d.repertoires.update(id, { name, updatedAt: now() })
}

export async function setRepertoirePaused(id: string, paused: boolean, d: AppDB = db) {
  await d.repertoires.update(id, { paused, updatedAt: now() })
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

export class OutsideRepertoireError extends Error {
  constructor(startSans: string[]) {
    super(`This line doesn't start with the repertoire's starting moves (${startSans.join(' ')})`)
  }
}

/**
 * Adds a line of moves (UCI from the initial position) to a repertoire. The
 * repertoire's starting moves are skipped; the line must begin with them.
 * Moves already present are reused. Throws MoveConflictError if one of the
 * owner's moves differs from the repertoire, unless `replace` is set, in which
 * case the old move and everything only reachable through it is removed.
 */
export async function addLine(
  rep: Repertoire,
  uciMoves: string[],
  opts: { replace?: boolean } = {},
  d: AppDB = db,
): Promise<AddLineResult> {
  const start = repStart(rep)
  if (!startsWith(uciMoves, start.moves)) throw new OutsideRepertoireError(start.sans)
  return d.transaction('rw', [d.moves, d.cards, d.repertoires], async () => {
    const added: RepMove[] = []
    let moves = await loadMoves(rep.id, d)
    let fen = start.fen
    for (const uci of uciMoves.slice(start.moves.length)) {
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
    const gone = movesToRemove(moves, rep.color, ids, repStart(rep).key)
    await d.moves.bulkDelete(gone.map((m) => m.id))
    await reconcileCards(rep, d)
    await d.repertoires.update(rep.id, { updatedAt: now() })
    return gone
  })
}

/** Preview of what removing a move would delete (for confirmation dialogs). */
export async function previewRemoval(rep: Repertoire, id: string, d: AppDB = db): Promise<RepMove[]> {
  const moves = await loadMoves(rep.id, d)
  return movesToRemove(moves, rep.color, new Set([id]), repStart(rep).key)
}

/** Ensures there is exactly one card per position where the owner has a move. */
export async function reconcileCards(rep: Repertoire, d: AppDB = db) {
  const moves = await loadMoves(rep.id, d)
  const wanted = new Set(cardPositions(buildGraph(moves, rep.color, repStart(rep).key)))
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

/** Moves that would be deleted if the repertoire started at `startMoves` instead. */
export async function previewStartChange(rep: Repertoire, startMoves: string[], d: AppDB = db): Promise<RepMove[]> {
  const moves = await loadMoves(rep.id, d)
  return movesToRemove(moves, rep.color, new Set(), startOf(startMoves).key)
}

/**
 * Moves the repertoire's starting position. Moves that are no longer reachable
 * from it (the setup moves and branches outside it) are deleted with their cards.
 */
export async function setRepertoireStart(rep: Repertoire, startMoves: string[], d: AppDB = db): Promise<Repertoire> {
  const updated: Repertoire = { ...rep, startMoves: startOf(startMoves).moves, updatedAt: now() }
  await d.transaction('rw', [d.moves, d.cards, d.repertoires], async () => {
    const gone = await previewStartChange(rep, startMoves, d)
    await d.moves.bulkDelete(gone.map((m) => m.id))
    await d.repertoires.put(updated)
    await reconcileCards(updated, d)
  })
  return updated
}

/**
 * Other repertoires of the same colour that would overlap with one starting at
 * `startMoves`: either they already contain that position, or they start
 * inside it (their start comes after these moves).
 */
export async function findOverlaps(
  color: Color,
  startMoves: string[],
  excludeId?: string,
  d: AppDB = db,
): Promise<Repertoire[]> {
  const key = startOf(startMoves).key
  const others = (await d.repertoires.toArray())
    .filter((r) => r.color === color && r.id !== excludeId)
    .sort((a, b) => a.createdAt - b.createdAt)
  const out: Repertoire[] = []
  for (const r of others) {
    const theirStart = repStart(r)
    if (startsWith(theirStart.moves, startMoves)) {
      out.push(r)
      continue
    }
    const g = buildGraph(await loadMoves(r.id, d), r.color, theirStart.key)
    if (g.depth.has(key)) out.push(r)
  }
  return out
}

export async function setMoveComment(id: string, comment: string, d: AppDB = db) {
  await d.moves.update(id, { comment, updatedAt: now() })
}

export async function setMoveGlyph(id: string, glyph: Glyph | '' | undefined, d: AppDB = db) {
  await d.moves.update(id, { glyph, updatedAt: now() })
}

/** Changes what the user wrote about a position, keeping the rest. */
async function updatePosition(key: string, change: Partial<Omit<PositionNote, 'key' | 'updatedAt'>>, d: AppDB) {
  await d.transaction('rw', d.positions, async () => {
    const existing = await d.positions.get(key)
    await d.positions.put({ note: '', tags: [], ...existing, ...change, key, updatedAt: now() })
  })
}

export const setPositionNote = (key: string, note: string, d: AppDB = db) => updatePosition(key, { note }, d)

/** Names the line reaching a position (a chapter or a side line); empty restores the opening name. */
export const setPositionName = (key: string, name: string, d: AppDB = db) =>
  updatePosition(key, { name: name.trim() || undefined }, d)

/** Forces or prevents a chapter start at a position; undefined goes back to the automatic rule. */
export const setChapterBreak = (key: string, chapter: ChapterBreak | undefined, d: AppDB = db) =>
  updatePosition(key, { chapter }, d)
