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

/** Badge colour of each symbol on the board (the same on both themes, white text). */
export const GLYPH_BADGE: Record<Glyph, string> = {
  '!!': '#2f7a3a',
  '!': '#4f8a2b',
  '!?': '#33699a',
  '?!': '#c07a1c',
  '?': '#c0551c',
  '??': '#b53b27',
}

/** PGN Numeric Annotation Glyphs. */
const NAGS: Record<Glyph, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }

export const glyphToNag = (g: Glyph): number => NAGS[g]

export function nagToGlyph(nag: number): Glyph | undefined {
  return GLYPHS.find((g) => NAGS[g] === nag)
}

export const isGlyph = (s: unknown): s is Glyph => GLYPHS.includes(s as Glyph)
