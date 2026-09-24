import { canonicalUci, turnOf } from '../chess/position'

/** One engine line, score always from White's point of view. */
export interface PvLine {
  cp?: number
  mate?: number
  /** Moves in canonical UCI. */
  pv: string[]
}

export interface Evaluation {
  fen: string
  depth: number
  lines: PvLine[]
  source: 'cloud' | 'local'
}

export interface UciInfo {
  depth: number
  multipv: number
  cp?: number
  mate?: number
  pv: string[]
}

/** Parses a UCI `info` line with a score and pv; returns null for other output. */
export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null
  const tokens = line.split(' ')
  const info: UciInfo = { depth: 0, multipv: 1, pv: [] }
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'depth') info.depth = Number(tokens[++i])
    else if (t === 'multipv') info.multipv = Number(tokens[++i])
    else if (t === 'score') {
      const kind = tokens[++i]
      const value = Number(tokens[++i])
      if (kind === 'cp') info.cp = value
      else if (kind === 'mate') info.mate = value
      // Skip "lowerbound"/"upperbound" markers.
      if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') return null
    } else if (t === 'pv') {
      info.pv = tokens.slice(i + 1)
      break
    }
  }
  if (info.cp === undefined && info.mate === undefined) return null
  return info
}

/**
 * Converts an engine score into a White-relative PV line with a canonical first
 * move. UCI engines report scores for the side to move; Lichess cloud evals are
 * already White-relative.
 */
export function toPvLine(
  fen: string,
  info: Pick<UciInfo, 'cp' | 'mate' | 'pv'>,
  relativeTo: 'side' | 'white' = 'side',
): PvLine {
  const sign = relativeTo === 'white' || turnOf(fen) === 'white' ? 1 : -1
  const pv: string[] = []
  // Only the first move needs canonicalising for comparisons.
  if (info.pv.length) pv.push(canonicalUci(fen, info.pv[0]) ?? info.pv[0], ...info.pv.slice(1))
  return {
    cp: info.cp === undefined ? undefined : info.cp * sign,
    mate: info.mate === undefined ? undefined : info.mate * sign,
    pv,
  }
}

/** A comparable number for a White-relative score (mates are huge). */
export function scoreValue(l: Pick<PvLine, 'cp' | 'mate'>): number {
  if (l.mate !== undefined) return l.mate > 0 ? 100000 - l.mate : -100000 - l.mate
  return l.cp ?? 0
}

export function formatScore(l: Pick<PvLine, 'cp' | 'mate'>): string {
  if (l.mate !== undefined) return `${l.mate > 0 ? '' : '-'}M${Math.abs(l.mate)}`
  const v = (l.cp ?? 0) / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}
