import { useLiveQuery } from 'dexie-react-hooks'
import { setMoveComment, setMoveGlyph } from '../../db/repertoire'
import { db } from '../../db/schema'
import { GLYPH_NAMES, GLYPH_TONE, GLYPHS, type Glyph } from '../../lib/chess/glyphs'

/** Symbol and comment of one repertoire move (the Notes panel). */
export function MoveAnnotation({ id, san, engineGlyph }: { id: string; san: string; engineGlyph?: Glyph }) {
  const move = useLiveQuery(() => db.moves.get(id).then((m) => m ?? null), [id])
  if (!move) return null
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">
          Symbol for <span className="font-semibold text-ink">{san}</span>
        </span>
        <GlyphPicker id={id} engineGlyph={engineGlyph} />
      </div>
      <label className="mb-1.5 block text-xs text-muted" htmlFor={`comment-${id}`}>
        Why <span className="font-semibold text-ink">{san}</span>? Shown in the lines and after you play it in training.
      </label>
      <textarea
        id={`comment-${id}`}
        key={`m-${id}`}
        className="input mb-3 h-16 w-full resize-y leading-relaxed"
        defaultValue={move.comment}
        onBlur={(e) => e.target.value !== move.comment && setMoveComment(id, e.target.value)}
      />
    </>
  )
}

/**
 * The six move symbols as toggles. The engine's symbol shows until the user
 * picks another or removes it (remembered as '' so it doesn't come back).
 */
export function GlyphPicker({ id, engineGlyph, onPick }: { id: string; engineGlyph?: Glyph; onPick?: () => void }) {
  const move = useLiveQuery(() => db.moves.get(id).then((m) => m ?? null), [id])
  if (!move) return null
  const glyph = move.glyph === '' ? undefined : move.glyph || engineGlyph
  const fromEngine = !!glyph && move.glyph === undefined
  const pick = async (g: Glyph) => {
    if (g === glyph) await setMoveGlyph(id, g === engineGlyph ? '' : undefined)
    else await setMoveGlyph(id, g === engineGlyph ? undefined : g)
    onPick?.()
  }
  return (
    <>
      {GLYPHS.map((g) => (
        <button
          key={g}
          title={`${GLYPH_NAMES[g]}${g === glyph ? ' (click to remove)' : ''}`}
          aria-pressed={g === glyph}
          onClick={() => pick(g)}
          className={`min-w-8 rounded-md border px-1.5 py-0.5 text-sm font-semibold transition ${
            glyph === g ? `border-brass/70 bg-brass/12 ${GLYPH_TONE[g]}` : 'border-line text-muted hover:border-line-strong hover:text-ink'
          }`}
        >
          {g}
        </button>
      ))}
      {fromEngine && <span className="text-[11px] text-faint">from the engine</span>}
      {move.glyph === '' && engineGlyph && <span className="text-[11px] text-faint">engine&rsquo;s {engineGlyph} hidden</span>}
    </>
  )
}
