export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

export function scoreColor(x: number) {
  if (x >= 0.75) return 'text-accent'
  if (x >= 0.4) return 'text-warn'
  return 'text-bad'
}

/** The same scale as a CSS colour, for SVG strokes. */
export function scoreTone(x: number) {
  if (x >= 0.75) return 'var(--color-accent)'
  if (x >= 0.4) return 'var(--color-warn)'
  return 'var(--color-bad)'
}
