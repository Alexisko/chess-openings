import type { AppDB, Card, PositionNote, RepMove, Repertoire, ReviewLog, Setting } from './schema'

/**
 * Settings that belong to this device: the Lichess login, and the import
 * rules of the games stored here (games aren't backed up or synced, they
 * are downloaded again).
 */
export const LOCAL_SETTINGS = new Set(['lichessToken', 'lichessUser', 'gamesImportVersion'])

/** The user's own data: what a backup contains and what is synced. */
export interface Snapshot {
  repertoires: Repertoire[]
  positions: PositionNote[]
  moves: RepMove[]
  cards: Card[]
  reviews: ReviewLog[]
  settings: Setting[]
}

export type SnapshotTable = keyof Snapshot
export const SNAPSHOT_TABLES: SnapshotTable[] = ['repertoires', 'positions', 'moves', 'cards', 'reviews', 'settings']

/** Primary key of a record of a snapshot table. */
export const keyOfRow = (table: SnapshotTable, row: object): string =>
  table === 'positions' || table === 'settings' ? (row as { key: string }).key : (row as { id: string }).id

export const snapshotTables = (d: AppDB) => SNAPSHOT_TABLES.map((t) => d[t])

export async function readSnapshot(d: AppDB): Promise<Snapshot> {
  const [repertoires, positions, moves, cards, reviews, settings] = await Promise.all([
    d.repertoires.toArray(),
    d.positions.toArray(),
    d.moves.toArray(),
    d.cards.toArray(),
    d.reviews.toArray(),
    d.settings.toArray(),
  ])
  return { repertoires, positions, moves, cards, reviews, settings: settings.filter((s) => !LOCAL_SETTINGS.has(s.key)) }
}

/** Cards read from JSON have their FSRS dates as strings. */
export const reviveCard = (c: Card): Card => ({
  ...c,
  fsrs: {
    ...c.fsrs,
    due: new Date(c.fsrs.due),
    last_review: c.fsrs.last_review ? new Date(c.fsrs.last_review) : undefined,
  },
})

/** A snapshot parsed from JSON, with dates revived and device settings dropped. */
export function parseSnapshot(data: Snapshot): Snapshot {
  return {
    repertoires: data.repertoires ?? [],
    positions: data.positions ?? [],
    moves: data.moves ?? [],
    cards: (data.cards ?? []).map(reviveCard),
    reviews: data.reviews ?? [],
    settings: (data.settings ?? []).filter((s) => !LOCAL_SETTINGS.has(s.key)),
  }
}
