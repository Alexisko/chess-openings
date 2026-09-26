import { positionKey, replay } from '../chess/position'
import { moveNumber, type TreeNode } from '../chess/tree'
import { shortName, variationOf, type OpeningName } from './names'

/**
 * A repertoire's lines split into chapters, like a Lichess study. The owner
 * has one move per position, so lines only split on opponent moves: at such
 * a branch, a reply that leads to another variation ("Vienna Game: Vienna
 * Gambit" rather than "Vienna Game") starts a chapter. Replies within the same
 * variation, even a different sub-variation (after the comma), stay in the
 * chapter as side lines. The user can force or prevent a chapter start at a
 * position and give any position a name of their own.
 */

/** Forces ('split') or prevents ('merge') a chapter start at a position. */
export type ChapterBreak = 'split' | 'merge'

export interface ChapterSources {
  /** Standard opening name of a position (the bundled Lichess names). */
  opening: (key: string) => OpeningName | undefined
  /** Name the user gave a position. */
  custom?: (key: string) => string | undefined
  breaks?: (key: string) => ChapterBreak | undefined
}

export interface Chapter {
  /** Path of the first move, joined (the tree root's for the first chapter). */
  id: string
  /** Node of the move that starts the chapter (the tree root for the first chapter). */
  node: TreeNode
  /** Full name ("Vienna Game: Vienna Gambit"), or the user's name for it. */
  name: string
  /** The name without what it shares with the chapter above ("Vienna Gambit"). */
  title: string
  custom: boolean
  /** The standard opening the chapter is named after, if any. */
  opening?: OpeningName
  parent?: Chapter
  children: Chapter[]
  /** Nodes in this chapter, not in its sub-chapters, in tree order (its first node first). */
  nodes: TreeNode[]
  /** Lines (leaves) in this chapter, not in its sub-chapters. */
  lines: number
}

export interface LineName {
  name: string
  custom: boolean
}

export interface Chapters {
  /** Top-level chapters. */
  roots: Chapter[]
  /** Every chapter, in outline order (a chapter before its sub-chapters). */
  list: Chapter[]
  /**
   * Chapter a node belongs to. Undefined for nodes outside the tree, and for
   * the tree root when it only leads into chapters (it has no line of its own).
   */
  of: (path: string[]) => Chapter | undefined
  /** Chapter whose first move is this node's. */
  startingAt: (path: string[]) => Chapter | undefined
  /** Name of a side line inside a chapter, starting with this node's move. */
  lineName: (path: string[]) => LineName | undefined
}

const pathId = (path: string[]) => path.join(',')
const moveLabel = (n: TreeNode) => `${moveNumber(n.ply - 1, true)}${n.san}`

export function buildChapters(root: TreeNode, src: ChapterSources): Chapters {
  let rootOpening: OpeningName | undefined
  for (const m of replay(root.path)) rootOpening = src.opening(positionKey(m.fen)) ?? rootOpening

  /**
   * The opening after a move and the owner's reply to it: names often apply
   * one move later (2...Nf6 3.f4 is the Vienna Gambit), and it's the reply
   * that defines the line you learn.
   */
  const ahead = (node: TreeNode, opening: OpeningName | undefined) => {
    const own = src.opening(node.key) ?? opening
    const reply = node.byMe ? undefined : node.children.find((c) => c.byMe)
    return (reply && src.opening(reply.key)) || own
  }

  const byNode = new Map<string, Chapter>()
  const starting = new Map<string, Chapter>()
  const sideLines: { node: TreeNode; before: OpeningName | undefined }[] = []
  const list: Chapter[] = []

  const open = (node: TreeNode, parent: Chapter | undefined, opening: OpeningName | undefined): Chapter => {
    const ch: Chapter = { id: pathId(node.path), node, name: '', title: '', custom: false, opening, parent, children: [], nodes: [], lines: 0 }
    parent?.children.push(ch)
    list.push(ch)
    return ch
  }

  const walk = (node: TreeNode, ch: Chapter, opening: OpeningName | undefined) => {
    byNode.set(pathId(node.path), ch)
    ch.nodes.push(node)
    if (!node.children.length) ch.lines++
    const branch = node.children.length > 1
    let continued = false
    for (const child of node.children) {
      const childOpening = src.opening(child.key) ?? opening
      const brk = child.byMe ? undefined : src.breaks?.(child.key)
      const next = child.byMe ? undefined : ahead(child, opening)
      const starts =
        brk === 'split' || (brk !== 'merge' && branch && !child.byMe && variationOf(next?.name ?? '') !== variationOf(opening?.name ?? ''))
      if (starts) {
        const sub = open(child, ch, next)
        starting.set(sub.id, sub)
        walk(child, sub, childOpening)
      } else {
        // The first reply that stays is the chapter's main line; the others are its side lines.
        if (continued) sideLines.push({ node: child, before: opening })
        continued = true
        walk(child, ch, childOpening)
      }
    }
  }

  const first = open(root, undefined, ahead(root, rootOpening))
  walk(root, first, rootOpening)

  // A root that branches straight into chapters has no line of its own: its chapters are the top level.
  let roots = [first]
  if (first.lines === 0 && first.nodes.length === 1) {
    roots = first.children
    for (const c of roots) c.parent = undefined
    list.shift()
    byNode.delete(first.id)
  }

  const nameGroup = (group: Chapter[], above: OpeningName | undefined) => {
    let names = group.map((ch) => {
      if (!ch.opening) return ch === first ? 'Main line' : moveLabel(ch.node)
      const variation = variationOf(ch.opening.name)
      // A chapter in the same variation as the one above (split by hand) goes by its sub-variation.
      return above && variation === variationOf(above.name) ? ch.opening.name : variation
    })
    const titleOf = (i: number) => (group[i].opening ? shortName(names[i], above?.name) : names[i])
    const clashes = (i: number) => group.some((_, j) => j !== i && titleOf(j) === titleOf(i)) || names[i] === above?.name
    // Siblings with the same title: first try their full names, then add the move they start with.
    names = group.map((ch, i) => (clashes(i) && ch.opening ? ch.opening.name : names[i]))
    names = group.map((ch, i) => (clashes(i) ? `${names[i]} (${moveLabel(ch.node)})` : names[i]))
    group.forEach((ch, i) => {
      const custom = src.custom?.(ch.node.key)
      ch.custom = !!custom
      ch.name = custom || names[i]
      ch.title = custom || titleOf(i)
    })
    for (const ch of group) nameGroup(ch.children, ch.opening ?? above)
  }
  nameGroup(roots, roots[0] === first ? undefined : rootOpening)

  const lineNames = new Map<string, LineName>()
  for (const { node, before } of sideLines) {
    const custom = src.custom?.(node.key)
    const opening = ahead(node, before)
    if (custom) lineNames.set(pathId(node.path), { name: custom, custom: true })
    else if (opening && opening.name !== before?.name)
      lineNames.set(pathId(node.path), { name: shortName(opening.name, before?.name), custom: false })
  }

  return {
    roots,
    list,
    of: (path) => byNode.get(pathId(path)),
    startingAt: (path) => starting.get(pathId(path)),
    lineName: (path) => lineNames.get(pathId(path)),
  }
}

/** Nodes of a chapter, with those of its sub-chapters when `deep`. */
export function chapterNodes(ch: Chapter, deep = true): TreeNode[] {
  return deep ? [...ch.nodes, ...ch.children.flatMap((c) => chapterNodes(c))] : ch.nodes
}
