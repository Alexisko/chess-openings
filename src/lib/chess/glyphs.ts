/** Move symbols, as in a Lichess study. */
export const GLYPHS = ['!!', '!', '!?', '?!', '?', '??'] as const
export type Glyph = (typeof GLYPHS)[number]

export const GLYPH_NAMES: Record<Glyph, string> = {
  '!!': 'Brilliant move',
  '!': 'Good move',
  '!?': 'Interesting move',
  '?!': 'Dubious move',
  '?': 'Mistake',
  '??': 'Blunder',
}

/** Text colour of each symbol (theme tokens). */
export const GLYPH_TONE: Record<Glyph, string> = {
  '!!': 'text-accent',
  '!': 'text-accent',
  '!?': 'text-info',
  '?!': 'text-warn',
  '?': 'text-warn',
  '??': 'text-bad',
}

/** PGN Numeric Annotation Glyphs. */
const NAGS: Record<Glyph, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }

export const glyphToNag = (g: Glyph): number => NAGS[g]

export function nagToGlyph(nag: number): Glyph | undefined {
  return GLYPHS.find((g) => NAGS[g] === nag)
}

export const isGlyph = (s: unknown): s is Glyph => GLYPHS.includes(s as Glyph)
