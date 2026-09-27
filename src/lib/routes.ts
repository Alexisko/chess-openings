export function builderUrl(repId: string, uci: string[]) {
  return `/rep/${repId}/build${uci.length ? `?m=${uci.join(',')}` : ''}`
}

export function planUrl(color: 'white' | 'black', path?: string[]) {
  return `/plan/${color}${path?.length ? `?at=${path.join(',')}` : ''}`
}

/**
 * A training session for one repertoire, or one of its chapters (with its
 * sub-chapters). The first chapter, which starts where the repertoire does, is the whole repertoire.
 */
export function trainUrl(mode: 'review' | 'learn' | 'drill', repId: string, chapter?: { id: string; node: { uci: string } }) {
  return `/train?mode=${mode}&rep=${repId}${chapter?.node.uci ? `&chapter=${chapter.id}` : ''}`
}

export type GamesTab = 'overview' | 'explorer' | 'findings'

/** Query of the games page: a tab, the colour, and (for the explorer) a line of moves. */
export function gamesParams(tab: GamesTab, color: 'white' | 'black', at: string[] = []) {
  const p = new URLSearchParams({ tab, color })
  if (at.length) p.set('at', at.join(','))
  return p
}
