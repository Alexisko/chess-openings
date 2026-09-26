/** An opening name as the Lichess explorer gives it ("Vienna Game: Vienna Gambit"). */
export interface OpeningName {
  eco: string
  name: string
}

/** A name along a line and the position (ply) where it first applies. */
export interface NameStep {
  ply: number
  opening: OpeningName
}

/**
 * The opening names met along a line of positions (index = ply), each where it
 * starts. Positions without a name (not in the explorer cache, or past the last
 * named position) keep the name before them, so the last step is the name to
 * show for position `upTo`. Positions after `upTo` are ignored: in training
 * that hides the name of the position your next move would reach.
 */
export function openingTrail(openings: readonly (OpeningName | null | undefined)[], upTo = openings.length - 1): NameStep[] {
  const trail: NameStep[] = []
  openings.slice(0, upTo + 1).forEach((opening, ply) => {
    if (opening && opening.name !== trail.at(-1)?.opening.name) trail.push({ ply, opening })
  })
  return trail
}

/**
 * The variation a name belongs to, without its sub-variation:
 * "Vienna Game: Vienna Gambit, Steinitz Variation" → "Vienna Game: Vienna Gambit".
 * A few family names have a comma of their own ("Vienna Gambit, with Max
 * Lange Defense: Steinitz Gambit"), so only a comma after the colon counts.
 */
export function variationOf(name: string): string {
  const colon = name.indexOf(': ')
  const comma = colon < 0 ? -1 : name.indexOf(', ', colon)
  return comma < 0 ? name : name.slice(0, comma)
}

/**
 * A name without the part it shares with the name before it:
 * "Vienna Game: Vienna Gambit" after "Vienna Game" reads "Vienna Gambit", and
 * "Vienna Game: Vienna Gambit, Steinitz Variation" after another line of the
 * Vienna Gambit reads "Steinitz Variation".
 */
export function shortName(name: string, previous?: string): string {
  if (!previous) return name
  if (name.startsWith(`${previous}, `)) return name.slice(previous.length + 2)
  const variation = variationOf(previous)
  if (name.startsWith(`${variation}, `)) return name.slice(variation.length + 2)
  const family = previous.split(':')[0]
  if (name.startsWith(`${family}: `)) return name.slice(family.length + 2)
  return name
}
