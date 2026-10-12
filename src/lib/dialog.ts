/**
 * Promise-based replacements for window.confirm and window.prompt, shown by
 * <DialogHost /> in the app's own style. Requests queue up and open one at a time.
 */

interface Base {
  title: string
  /** Paragraphs of explanation. */
  message?: string | string[]
  confirmLabel?: string
  /** Style the confirm button as destructive. */
  danger?: boolean
  /** Seconds the confirm button stays disabled, counting down, so it can't be clicked by reflex. */
  confirmDelay?: number
}

export type DialogRequest = { id: number } & (
  | (Base & { kind: 'confirm'; resolve: (ok: boolean) => void })
  | (Base & { kind: 'prompt'; defaultValue?: string; placeholder?: string; resolve: (value: string | null) => void })
)

let queue: DialogRequest[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function subscribeDialogs(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const currentDialog = (): DialogRequest | undefined => queue[0]

/** Closes the open dialog; the host resolves its promise first. */
export function closeDialog() {
  queue = queue.slice(1)
  emit()
}

export function confirmDialog(opts: Base): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: nextId++, kind: 'confirm', resolve }]
    emit()
  })
}

export function promptDialog(opts: Base & { defaultValue?: string; placeholder?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: nextId++, kind: 'prompt', resolve }]
    emit()
  })
}

/** Asks before creating a repertoire whose positions another repertoire already covers. */
export function confirmOverlap(names: string[]) {
  return confirmDialog({
    title: 'Overlapping repertoire',
    message:
      `This overlaps with ${names.map((n) => `“${n}”`).join(', ')}: the same positions would be in two ` +
      'repertoires and be drilled twice.',
    confirmLabel: 'Create anyway',
  })
}

/** Asks before deleting a repertoire, saying how many moves go with it. */
export function confirmDeleteRepertoire(name: string, moves: number) {
  return confirmDialog({
    title: `Delete “${name}”?`,
    message: [
      moves > 0
        ? `${moves} move${moves === 1 ? '' : 's'} will be lost, with their notes and review history.`
        : 'It has no moves yet.',
      'This cannot be undone.',
    ],
    confirmLabel: 'Delete repertoire',
    danger: true,
    confirmDelay: moves > 0 ? 3 : 0,
  })
}
