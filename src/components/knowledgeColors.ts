import type { Knowledge } from '../lib/srs/knowledge'

// Graded like every score: moss for known, amber in between, oxblood for weak.
export const KNOWLEDGE_BG: Record<Knowledge, string> = {
  mastered: 'bg-accent',
  solid: 'bg-accent/40',
  learning: 'bg-warn',
  shaky: 'bg-bad',
  new: 'bg-line-strong',
}

/** The same colours as SVG fills; a move not learned yet is hollow. */
export const KNOWLEDGE_FILL: Record<Knowledge, string> = {
  mastered: 'fill-accent',
  solid: 'fill-accent/40',
  learning: 'fill-warn',
  shaky: 'fill-bad',
  new: 'fill-surface stroke-line-strong',
}
