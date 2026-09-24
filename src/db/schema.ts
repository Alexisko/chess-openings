import Dexie, { type EntityTable } from 'dexie'
import type { Card as FsrsCard } from 'ts-fsrs'
import type { Color } from '../lib/chess/position'

// Every synced record carries a UUID and timestamps so that a sync layer can be
// added later without migrating data. Review logs are append-only events.

export interface Repertoire {
  id: string
  name: string
  color: Color
  /**
   * Moves (UCI, from the initial position) leading to where this repertoire
   * starts, e.g. 1.e4 e5 2.Nc3 for a Vienna repertoire. They are set up, not
   * drilled, and scores are measured from the position they reach. Missing on
   * repertoires created before this existed, meaning the initial position.
   */
  startMoves?: string[]
  createdAt: number
  updatedAt: number
}

/** A position in any repertoire, keyed by its move-order independent key. */
export interface PositionNote {
  key: string
  note: string
  tags: string[]
  updatedAt: number
}

export interface RepMove {
  id: string
  repertoireId: string
  fromKey: string
  toKey: string
  /** Full FEN before the move (for replaying / display). */
  fromFen: string
  uci: string
  san: string
  /** True when the repertoire owner makes this move. */
  byMe: boolean
  comment: string
  createdAt: number
  updatedAt: number
}

/** One card per position where it is the owner's turn: "play your move here". */
export interface Card {
  id: string
  repertoireId: string
  positionKey: string
  fsrs: FsrsCard
  createdAt: number
  updatedAt: number
}

export type ReviewMode = 'learn' | 'review' | 'drill'

export interface ReviewLog {
  id: string
  cardId: string
  repertoireId: string
  ts: number
  /** ts-fsrs Rating; 0 means "not graded" (e.g. correct on a card that wasn't due). */
  rating: number
  playedUci: string
  correct: boolean
  mode: ReviewMode
}

export interface ExplorerCacheEntry {
  key: string
  data: unknown
  fetchedAt: number
}

export interface EvalCacheEntry {
  positionKey: string
  depth: number
  data: unknown
  source: 'cloud' | 'local'
  updatedAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  repertoires!: EntityTable<Repertoire, 'id'>
  positions!: EntityTable<PositionNote, 'key'>
  moves!: EntityTable<RepMove, 'id'>
  cards!: EntityTable<Card, 'id'>
  reviews!: EntityTable<ReviewLog, 'id'>
  explorerCache!: EntityTable<ExplorerCacheEntry, 'key'>
  evalCache!: EntityTable<EvalCacheEntry, 'positionKey'>
  settings!: EntityTable<Setting, 'key'>

  constructor(name = 'opening-trainer') {
    super(name)
    this.version(1).stores({
      repertoires: 'id',
      positions: 'key',
      moves: 'id, repertoireId, [repertoireId+fromKey]',
      cards: 'id, repertoireId, [repertoireId+positionKey]',
      reviews: 'id, cardId, repertoireId, ts',
      explorerCache: 'key',
      evalCache: 'positionKey',
      settings: 'key',
    })
  }
}

export const db = new AppDB()

let lastNow = 0
/** Strictly increasing timestamp, so records created in the same millisecond keep their order. */
export const now = () => {
  const t = Date.now()
  lastNow = t > lastNow ? t : lastNow + 1
  return lastNow
}
export const uuid = () => crypto.randomUUID()
