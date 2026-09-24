import { makeFen } from 'chessops/fen'
import { parsePgn, startingPosition } from 'chessops/pgn'
import { parseSan } from 'chessops/san'
import { makeUci } from 'chessops/util'
import type { Game, GameSpeed } from '../../db/schema'
import { setupPosition, START_FEN, type Color } from '../chess/position'

/** Only the opening matters: moves after this many plies are not stored. */
export const MAX_PLIES = 40

/** Ultrabullet (Lichess) and daily games (Chess.com) are left out. */
export const GAME_SPEEDS: GameSpeed[] = ['bullet', 'blitz', 'rapid', 'classical']
const INITIAL_BOARD = START_FEN.split(' ')[0]

/** Converts SAN moves from the initial position to canonical UCI, stopping at the first illegal one. */
export function sansToUci(sans: string[], maxPlies = MAX_PLIES): { moves: string[]; sans: string[] } {
  const pos = setupPosition(START_FEN)
  const moves: string[] = []
  const out: string[] = []
  for (const san of sans.slice(0, maxPlies)) {
    const move = parseSan(pos, san)
    if (!move) break
    moves.push(makeUci(move))
    out.push(san)
    pos.play(move)
  }
  return { moves, sans: out }
}

const sameUser = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()

interface LichessPlayer {
  user?: { name: string; id: string }
  aiLevel?: number
  rating?: number
}

export interface LichessGameJson {
  id: string
  variant: string
  speed: string
  status: string
  createdAt: number
  initialFen?: string
  players: { white: LichessPlayer; black: LichessPlayer }
  winner?: 'white' | 'black'
  moves?: string
}

/** A Lichess export row (NDJSON) as a Game, or null if it isn't a usable standard game. */
export function parseLichessGame(g: LichessGameJson, user: string, t = Date.now()): Game | null {
  if (g.variant !== 'standard' || g.initialFen || !GAME_SPEEDS.includes(g.speed as GameSpeed)) return null
  if (g.status === 'aborted' || g.status === 'noStart' || !g.moves) return null
  const color: Color | null = sameUser(g.players.white.user?.id, user) || sameUser(g.players.white.user?.name, user)
    ? 'white'
    : sameUser(g.players.black.user?.id, user) || sameUser(g.players.black.user?.name, user)
      ? 'black'
      : null
  if (!color) return null
  const opp = g.players[color === 'white' ? 'black' : 'white']
  const { moves, sans } = sansToUci(g.moves.split(' '))
  if (!moves.length) return null
  return {
    id: `lichess:${g.id}`,
    source: 'lichess',
    url: `https://lichess.org/${g.id}${color === 'black' ? '/black' : ''}`,
    playedAt: g.createdAt,
    speed: g.speed as GameSpeed,
    color,
    opponent: opp.user?.name ?? (opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous'),
    opponentRating: opp.rating,
    result: !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss',
    moves,
    sans,
    createdAt: t,
  }
}

interface ChesscomPlayer {
  username: string
  rating?: number
  result: string
}

export interface ChesscomGameJson {
  url: string
  uuid?: string
  pgn?: string
  end_time: number
  time_class: string
  rules: string
  initial_setup?: string
  white: ChesscomPlayer
  black: ChesscomPlayer
}

const CHESSCOM_DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])

/** A game from a Chess.com monthly archive as a Game, or null if it isn't a usable standard game. */
export function parseChesscomGame(g: ChesscomGameJson, user: string, t = Date.now()): Game | null {
  if (g.rules !== 'chess' || !GAME_SPEEDS.includes(g.time_class as GameSpeed) || !g.pgn) return null
  if (g.initial_setup && g.initial_setup.split(' ')[0] !== INITIAL_BOARD) return null
  const color: Color | null = sameUser(g.white.username, user) ? 'white' : sameUser(g.black.username, user) ? 'black' : null
  if (!color) return null
  const [game] = parsePgn(g.pgn)
  if (!game) return null
  const start = startingPosition(game.headers)
  if (start.isErr || makeFen(start.value.toSetup()).split(' ')[0] !== INITIAL_BOARD) return null
  const sans: string[] = []
  for (const node of game.moves.mainline()) {
    if (sans.length >= MAX_PLIES) break
    sans.push(node.san)
  }
  const parsed = sansToUci(sans)
  if (!parsed.moves.length) return null
  const me = g[color]
  const opp = g[color === 'white' ? 'black' : 'white']
  return {
    id: `chesscom:${g.uuid ?? g.url}`,
    source: 'chesscom',
    url: g.url,
    playedAt: g.end_time * 1000,
    speed: g.time_class as GameSpeed,
    color,
    opponent: opp.username,
    opponentRating: opp.rating,
    result: me.result === 'win' ? 'win' : CHESSCOM_DRAWS.has(me.result) ? 'draw' : 'loss',
    ...parsed,
    createdAt: t,
  }
}
