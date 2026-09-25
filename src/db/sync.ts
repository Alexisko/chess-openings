import type { Fingerprints, LocalChanges } from '../lib/sync/merge'
import { loadMoves, reconcileCards, removeMoves } from './repertoire'
import type { AppDB, Card, RepMove } from './schema'
import { SNAPSHOT_TABLES } from './snapshot'

/** What this device and the server last agreed on. */
export interface SyncBase {
  /** Lowercase Lichess username the data was synced as. */
  user: string
  /** Server version of that copy. */
  version: number
  fingerprints: Fingerprints
  syncedAt: number
}

export async function getSyncBase(d: AppDB): Promise<SyncBase | undefined> {
  return (await d.syncState.get('base'))?.value as SyncBase | undefined
}

export async function setSyncBase(d: AppDB, base: SyncBase) {
  await d.syncState.put({ key: 'base', value: base })
}

export async function applyChanges(d: AppDB, changes: LocalChanges) {
  for (const t of SNAPSHOT_TABLES) {
    const { put, del } = changes[t]
    const table = d[t] as unknown as { bulkPut(rows: object[]): Promise<unknown>; bulkDelete(keys: string[]): Promise<void> }
    if (del.length) await table.bulkDelete(del)
    if (put.length) await table.bulkPut(put)
  }
}

const byAge = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id)
const newestFirst = (a: { updatedAt: number; id: string }, b: { updatedAt: number; id: string }) =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

/**
 * Repairs what a merge of edits made on two devices can leave behind. Every
 * choice depends only on the data, so both devices repair it the same way.
 * - Moves, cards and reviews of a deleted repertoire are removed.
 * - The same move added on both devices is kept once.
 * - Two different moves of yours in one position (each device picked one):
 *   the most recent wins, and the other's continuation is removed.
 * - Duplicate cards for one position: the most recently reviewed is kept and
 *   the other's review history moves to it.
 * - Cards are reconciled with the moves.
 */
export async function repairAfterMerge(d: AppDB) {
  const reps = await d.repertoires.toArray()
  const repIds = new Set(reps.map((r) => r.id))
  const orphan = (row: { repertoireId: string }) => !repIds.has(row.repertoireId)
  await d.moves.filter(orphan).delete()
  await d.cards.filter(orphan).delete()
  await d.reviews.filter(orphan).delete()

  for (const rep of reps) {
    const moves = await loadMoves(rep.id, d)
    const seen = new Set<string>()
    const dupes: string[] = []
    const kept: RepMove[] = []
    for (const m of moves.sort(byAge)) {
      const k = `${m.fromKey}|${m.uci}`
      if (seen.has(k)) dupes.push(m.id)
      else {
        seen.add(k)
        kept.push(m)
      }
    }
    if (dupes.length) await d.moves.bulkDelete(dupes)

    const answered = new Set<string>()
    const replaced = new Set<string>()
    for (const m of kept.filter((m) => m.byMe).sort(newestFirst)) {
      if (answered.has(m.fromKey)) replaced.add(m.id)
      else answered.add(m.fromKey)
    }
    if (replaced.size) await removeMoves(rep, replaced, d)

    const cards = await d.cards.where({ repertoireId: rep.id }).toArray()
    const keep = new Map<string, Card>()
    for (const c of cards.sort(newestFirst)) if (!keep.has(c.positionKey)) keep.set(c.positionKey, c)
    for (const c of cards) {
      const winner = keep.get(c.positionKey)!
      if (winner.id === c.id) continue
      await d.reviews.where({ cardId: c.id }).modify({ cardId: winner.id })
      await d.cards.delete(c.id)
    }
    await reconcileCards(rep, d)
  }
}
