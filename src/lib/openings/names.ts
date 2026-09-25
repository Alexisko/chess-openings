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
 * A name without the part it shares with the name before it:
 * "Vienna Game: Vienna Gambit" after "Vienna Game" reads "Vienna Gambit".
 */
export function shortName(name: string, previous?: string): string {
  if (!previous) return name
  if (name.startsWith(`${previous}, `)) return name.slice(previous.length + 2)
  const family = previous.split(':')[0]
  if (name.startsWith(`${family}: `)) return name.slice(family.length + 2)
  return name
}
