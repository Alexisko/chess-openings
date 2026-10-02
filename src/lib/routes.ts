/** The Lichess analysis board on a line from the start position, seen from one side. */
export function lichessAnalysisUrl(pgn: string, color: 'white' | 'black') {
  return `https://lichess.org/analysis${pgn ? `/pgn/${encodeURIComponent(pgn)}` : ''}?color=${color}`
}

export function builderUrl(repId: string, uci: string[]) {
  return `/rep/${repId}/build${uci.length ? `?m=${uci.join(',')}` : ''}`
}

export function planUrl(color: 'white' | 'black', path?: string[]) {
  return `/plan/${color}${path?.length ? `?at=${path.join(',')}` : ''}`
}

export type TrainLink = 'review' | 'learn' | 'train'

/**
 * A training session for one repertoire, or one of its chapters (with its
 * sub-chapters, by the id of its first position). The first chapter, which
 * starts where the repertoire does, is the whole repertoire.
 */
export function chapterTrainUrl(mode: TrainLink, repId: string, chapter?: { id: string; node: { uci: string } }) {
  return trainUrl(mode, { repId, chapter: chapter?.node.uci ? chapter.id : undefined })
}

/** A training session for everything, one colour, one repertoire or one chapter of it. */
export function trainUrl(mode: TrainLink, scope: { repId?: string | null; color?: 'white' | 'black' | null; chapter?: string } = {}) {
  const p = new URLSearchParams({ mode })
  if (scope.repId) p.set('rep', scope.repId)
  else if (scope.color) p.set('color', scope.color)
  if (scope.repId && scope.chapter) p.set('chapter', scope.chapter)
  return `/train?${p}`
}

export type GamesTab = 'overview' | 'map' | 'explorer' | 'findings'

/** Query of the games page: a tab, the colour, and (for the explorer) a line of moves. */
export function gamesParams(tab: GamesTab, color: 'white' | 'black', at: string[] = []) {
  const p = new URLSearchParams({ tab, color })
  if (at.length) p.set('at', at.join(','))
  return p
}
