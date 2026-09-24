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

/** 'game' logs come from imported games (a wrong move played in a real game). */
export type ReviewMode = 'learn' | 'review' | 'drill' | 'game'

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
  /** For 'game' logs: the imported game the move was played in. */
  gameId?: string
}

export type GameSource = 'lichess' | 'chesscom'
/** Bullet counts here: these are your own games, unlike the explorer statistics. */
export type GameSpeed = 'bullet' | 'blitz' | 'rapid' | 'classical'

/** One of the owner's games, imported from Lichess or Chess.com (opening moves only). */
export interface Game {
  /** Source-prefixed id, e.g. "lichess:abcd1234". */
  id: string
  source: GameSource
  url: string
  /** When the game was played (ms). */
  playedAt: number
  speed: GameSpeed
  /** The colour the owner played. */
  color: Color
  opponent: string
  opponentRating?: number
  result: 'win' | 'draw' | 'loss'
  /** The first moves (canonical UCI from the initial position) and their SAN. */
  moves: string[]
  sans: string[]
  createdAt: number
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
  games!: EntityTable<Game, 'id'>

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
    this.version(2).stores({ games: 'id, source, playedAt' })
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
