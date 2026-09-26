import { setPositionName } from '../../db/repertoire'
import { promptDialog } from '../dialog'
import type { Chapter } from './chapters'
import type { Naming } from './naming'

/** Asks for a chapter's new name (empty goes back to the opening name) and saves it on its position. */
export async function renameChapter(ch: Chapter, naming: Naming | undefined) {
  const name = await promptDialog({
    title: 'Rename chapter',
    message: 'The name shows wherever this position comes up. Leave it empty to use the opening name.',
    defaultValue: ch.custom ? ch.name : '',
    placeholder: ch.custom ? undefined : ch.name,
    confirmLabel: 'Rename',
  })
  if (name === null) return
  await setPositionName(ch.nameKey, name)
  // A name given from the chapter's first move would win over the new one.
  if (ch.nameKey !== ch.node.key && naming?.custom(ch.node.key)) await setPositionName(ch.node.key, '')
}
