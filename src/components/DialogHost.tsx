import { useEffect, useRef, useSyncExternalStore } from 'react'
import { closeDialog, currentDialog, subscribeDialogs } from '../lib/dialog'

/** Renders the dialog opened with confirmDialog / promptDialog as a modal. */
export function DialogHost() {
  const req = useSyncExternalStore(subscribeDialogs, currentDialog)
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const d = ref.current
    if (req && d && !d.open) d.showModal()
  }, [req])

  if (!req) return null

  const finish = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok)
    else req.resolve(ok ? (inputRef.current?.value ?? '') : null)
    ref.current?.close()
    closeDialog()
  }
  const paragraphs = req.message === undefined ? [] : Array.isArray(req.message) ? req.message : [req.message]

  return (
    <dialog
      key={req.id}
      ref={ref}
      className="modal"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        finish(false)
      }}
      // A click on the dialog element itself is a click on the backdrop.
      onClick={(e) => e.target === e.currentTarget && finish(false)}
    >
      <form
        className="card p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault()
          finish(true)
        }}
      >
        <h2 id="dialog-title" className="font-display text-xl leading-snug font-medium tracking-tight">
          {req.title}
        </h2>
        {paragraphs.map((p, i) => (
          <p key={i} className="mt-2 text-sm leading-relaxed text-muted">
            {p}
          </p>
        ))}
        {req.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="input mt-4 w-full"
            defaultValue={req.defaultValue}
            placeholder={req.placeholder}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-ghost" onClick={() => finish(false)} autoFocus={req.danger}>
            Cancel
          </button>
          <button className={req.danger ? 'btn-danger-solid' : 'btn-primary'} autoFocus={req.kind === 'confirm' && !req.danger}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
