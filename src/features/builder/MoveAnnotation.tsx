import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { PencilIcon } from '../../components/icons'
import { setChapterBreak, setMoveComment, setMoveGlyph, setPositionName, setPositionNote } from '../../db/repertoire'
import { db, type RepMove } from '../../db/schema'
import { GLYPH_NAMES, GLYPH_TONE, GLYPHS, type Glyph } from '../../lib/chess/glyphs'
import { formatMoves } from '../../lib/chess/position'
import type { Chapter, ChapterBreak } from '../../lib/openings/chapters'
import type { Naming } from '../../lib/openings/naming'
import { renameChapter } from '../../lib/openings/renameChapter'

/**
 * Everything about one repertoire move in a small menu, opened by
 * right-clicking it in the lines: its symbol, comment, the name of the line
 * it starts, its chapter, and the plans in the position it reaches.
 */
export function MoveMenu({
  move,
  ply,
  engineGlyph,
  naming,
  chapter,
  onClose,
}: {
  move: RepMove
  /** Plies from the start position to the move. */
  ply: number
  engineGlyph?: Glyph
  naming?: Naming
  /** The chapter this move starts, if any. */
  chapter?: Chapter
  onClose: () => void
}) {
  const key = move.toKey
  // null = loaded but empty, undefined = still loading.
  const note = useLiveQuery(() => db.positions.get(key).then((n) => n ?? null), [key])
  const current = useLiveQuery(() => db.moves.get(move.id).then((m) => m ?? null), [move.id])
  if (note === undefined || !current) return null
  const breakHere = note?.chapter
  const setBreak = (b: ChapterBreak | undefined) => setChapterBreak(key, b)
  const label = 'mb-1 block text-xs text-muted'
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-2.5 text-sm">
      <div className="font-display text-[15px] font-medium">{formatMoves([move.san], ply - 1)}</div>
      <div>
        <span className={label}>Symbol</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <GlyphPicker id={move.id} engineGlyph={engineGlyph} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor={`menu-comment-${move.id}`}>
          Why {move.san}?
        </label>
        <SavedField
          id={`menu-comment-${move.id}`}
          multiline
          value={current.comment}
          save={(v) => setMoveComment(move.id, v)}
          placeholder="Shown in the lines and after you play it in training."
        />
      </div>
      <div>
        <label className={label} htmlFor={`menu-name-${move.id}`}>
          Line name
        </label>
        <SavedField
          id={`menu-name-${move.id}`}
          value={note?.name ?? ''}
          save={(v) => v.trim() !== (note?.name ?? '') && setPositionName(key, v)}
          placeholder={naming?.opening(key)?.name ?? 'e.g. Hamppe line'}
        />
      </div>
      {(!move.byMe || chapter) && (
        <div>
          <span className={label}>Chapter</span>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {!move.byMe &&
              (
                [
                  [undefined, `Automatic${breakHere ? '' : chapter ? ' (new)' : ' (same)'}`],
                  ['split', 'New chapter'],
                  ['merge', 'Same chapter'],
                ] as const
              ).map(([b, text]) => (
                <button key={text} className={`chip py-0.5 ${breakHere === b ? 'chip-on' : ''}`} onClick={() => setBreak(b)}>
                  {text}
                </button>
              ))}
            {chapter && (
              <button
                className="chip gap-1 py-0.5"
                onClick={() => {
                  onClose()
                  renameChapter(chapter, naming)
                }}
              >
                <PencilIcon size={12} /> Rename chapter
              </button>
            )}
          </div>
        </div>
      )}
      <div>
        <label className={label} htmlFor={`menu-plans-${move.id}`}>
          Plans after {move.san}
        </label>
        <SavedField
          id={`menu-plans-${move.id}`}
          multiline
          value={note?.note ?? ''}
          save={(v) => setPositionNote(key, v)}
          placeholder="Shared by all repertoires."
        />
      </div>
    </div>
  )
}

/**
 * A text field saved when it loses focus, or when it goes away while still
 * focused (a menu closed by Escape or a click elsewhere).
 */
function SavedField({
  id,
  value,
  save,
  multiline,
  placeholder,
}: {
  id: string
  value: string
  save: (value: string) => unknown
  multiline?: boolean
  placeholder?: string
}) {
  const draft = useRef(value)
  const commit = useRef(() => {})
  useEffect(() => {
    commit.current = () => draft.current !== value && save(draft.current)
  })
  useEffect(() => () => commit.current(), [])
  const props = {
    id,
    defaultValue: value,
    placeholder,
    onChange: (e: { target: { value: string } }) => (draft.current = e.target.value),
    onBlur: () => commit.current(),
  }
  return multiline ? (
    <textarea {...props} className="input h-14 w-full resize-y leading-relaxed" />
  ) : (
    <input {...props} className="input w-full" />
  )
}

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
