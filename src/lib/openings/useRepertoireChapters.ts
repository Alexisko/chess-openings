import { useCallback, useMemo } from 'react'
import type { RepertoireData } from '../../db/useRepertoire'
import { repStart } from '../chess/start'
import { buildTree, opponentBranchKeys, orderTree, type TreeNode } from '../chess/tree'
import { moveShare, useCachedExplorer, type ExplorerFilter } from '../explorer'
import { useChapters, useNaming } from './naming'

/** A repertoire's saved lines (most common replies first) and their chapters. */
export function useRepertoireChapters(data: RepertoireData | null | undefined, filter: ExplorerFilter | undefined) {
  const start = data ? repStart(data.rep).moves : undefined
  const rawTree = useMemo(() => (data && start ? buildTree(data.graph, start) : null), [data, start])
  const branchKeys = useMemo(() => (rawTree ? opponentBranchKeys(rawTree) : []), [rawTree])
  const cached = useCachedExplorer(branchKeys, filter)
  const shareOf = useCallback((parent: TreeNode, child: TreeNode) => moveShare(cached.get(parent.key), child.uci), [cached])
  const tree = useMemo(() => (rawTree ? orderTree(rawTree, shareOf) : null), [rawTree, shareOf])
  const naming = useNaming()
  const chapters = useChapters(tree, naming)
  return { tree, chapters, shareOf, naming }
}
