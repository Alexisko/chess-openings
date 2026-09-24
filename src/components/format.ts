export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

export function scoreColor(x: number) {
  if (x >= 0.75) return 'text-accent'
  if (x >= 0.4) return 'text-warn'
  return 'text-bad'
}
