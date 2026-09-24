import type { RepGraph } from './graph'
import { playUci, positionKey, START_FEN, turnOf } from './position'

/**
 * Display tree of a repertoire (canonical paths only), rooted at the position
 * reached by `rootPath` (the repertoire's start or a focus position inside it)
 * and extended with the unsaved moves being explored.
 */
export interface TreeNode {
  /** Position key after this node's move (root: the focus position). */
  key: string
  /** Full FEN after this node's move. */
  fen: string
  uci: string
  san: string
  /** UCI moves from the start position to this node. */
  path: string[]
  /** Plies from the start position. */
  ply: number
  byMe: boolean
  /** Not saved in the repertoire yet. */
  draft: boolean
  /** The move reaches a position that the repertoire continues elsewhere. */
  transposition: boolean
  comment: string
  children: TreeNode[]
}

export function buildTree(g: RepGraph, rootPath: string[] = [], draft: string[] = []): TreeNode {
  let fen = START_FEN
  for (const u of rootPath) fen = playUci(fen, u)?.fen ?? fen
  const rootKey = positionKey(fen)
  const root: TreeNode = {
    key: rootKey,
    fen,
    uci: '',
    san: '',
    path: rootPath,
    ply: rootPath.length,
    byMe: false,
    draft: false,
    transposition: false,
    comment: '',
    children: [],
  }

  const expand = (node: TreeNode) => {
    for (const m of g.movesFrom.get(node.key) ?? []) {
      const played = playUci(node.fen, m.uci)
      if (!played) continue
      const child: TreeNode = {
        key: m.toKey,
        fen: played.fen,
        uci: m.uci,
        san: m.san,
        path: [...node.path, m.uci],
        ply: node.ply + 1,
        byMe: m.byMe,
        draft: false,
        transposition: g.transpositions.has(m.id),
        comment: m.comment,
        children: [],
      }
      node.children.push(child)
      if (!child.transposition) expand(child)
    }
  }
  // Only expand the root position if the repertoire actually reaches it.
  if (g.depth.has(rootKey)) expand(root)

  // Graft the unsaved part of the explored line onto the tree.
  if (draft.length >= rootPath.length && rootPath.every((u, i) => draft[i] === u)) {
    let node = root
    for (const uci of draft.slice(rootPath.length)) {
      let child = node.children.find((c) => c.uci === uci)
      if (!child) {
        const played = playUci(node.fen, uci)
        if (!played) break
        child = {
          key: positionKey(played.fen),
          fen: played.fen,
          uci: played.uci,
          san: played.san,
          path: [...node.path, played.uci],
          ply: node.ply + 1,
          byMe: turnOf(node.fen) === g.color,
          draft: true,
          transposition: false,
          comment: '',
          children: [],
        }
        node.children.push(child)
      }
      node = child
    }
  }
  return root
}

/** The node at the end of a path (relative to the tree root), if present. */
export function findNode(root: TreeNode, path: string[]): TreeNode | undefined {
  if (path.length < root.path.length || root.path.some((u, i) => path[i] !== u)) return undefined
  let node: TreeNode | undefined = root
  for (const uci of path.slice(root.path.length)) {
    node = node.children.find((c) => c.uci === uci)
    if (!node) return undefined
  }
  return node
}

/** Move number label for the move played at `ply` (plies before it): "3." for White, "3..." for Black. */
export function moveNumber(ply: number, forceBlack = false): string {
  const n = Math.floor(ply / 2) + 1
  if (ply % 2 === 0) return `${n}.`
  return forceBlack ? `${n}...` : ''
}

/**
 * Orders opponent replies by how often they are played (most common first, so
 * it becomes the main line); unknown shares keep their order, drafts go last.
 */
export function orderTree(node: TreeNode, share: (parent: TreeNode, child: TreeNode) => number | undefined): TreeNode {
  const children = node.children.map((c) => orderTree(c, share))
  if (children.length > 1 && !children[0].byMe) {
    const rank = (c: TreeNode) => (c.draft ? -2 : (share(node, c) ?? -1))
    children.sort((a, b) => rank(b) - rank(a))
  }
  return { ...node, children }
}

/** Positions in the tree where the opponent is to move and there is a choice to show. */
export function opponentBranchKeys(node: TreeNode, out: string[] = []): string[] {
  if (node.children.length && !node.children[0].byMe) out.push(node.key)
  for (const c of node.children) opponentBranchKeys(c, out)
  return out
}

export function allKeys(node: TreeNode, out: string[] = []): string[] {
  out.push(node.key)
  for (const c of node.children) allKeys(c, out)
  return out
}
