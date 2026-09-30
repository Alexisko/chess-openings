import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo, useState } from 'react'
import { db } from '../../db/schema'
import type { Settings } from '../../db/settings'
import { useRepertoire } from '../../db/useRepertoire'
import { buildGraph } from '../chess/graph'
import type { Color } from '../chess/position'
import { repStart } from '../chess/start'
import { useExplorerData, type ExplorerData } from '../explorer'
import { asBuilt, ownMovesIn, preparedness } from '../prep/preparedness'
import { usePreparedness } from '../prep/usePreparedness'
import { buildPlan, type CoveredNode, type Plan, type PlanRep, type RepScore } from './plan'

export interface PlanState {
  plan: Plan
  explorer: Map<string, ExplorerData>
  /** Explorer positions still to download. */
  pending: number
  fetchError?: Error
}

/**
 * The live repertoire plan of a colour. The explorer data it needs is
 * downloaded in the background; each answer can reveal new positions to look
 * at, so the set of positions grows until the plan is stable.
 */
export function usePlan(color: Color, settings: Settings | undefined): PlanState | undefined {
  const raw = useLiveQuery(async () => {
    const reps = (await db.repertoires.toArray()).filter((r) => r.color === color).sort((a, b) => a.createdAt - b.createdAt)
    const moves = await db.moves.where('repertoireId').anyOf(reps.map((r) => r.id)).toArray()
    return { reps, moves }
  }, [color])
  const reps = useMemo<PlanRep[] | undefined>(
    () =>
      raw?.reps.map((rep) => ({
        rep,
        graph: buildGraph(
          raw.moves.filter((m) => m.repertoireId === rep.id),
          color,
          repStart(rep).key,
        ),
      })),
    [raw, color],
  )

  const [keysText, setKeysText] = useState('')
  const keys = useMemo(() => (keysText ? keysText.split('\n') : []), [keysText])
  const { cached, pending, fetchError } = useExplorerData(keys, settings?.explorerFilter)
  const choices = settings?.planChoices?.[color]
  const plan = useMemo(
    () => (reps && choices && cached ? buildPlan({ color, reps, choices, explorer: cached }) : undefined),
    [reps, choices, cached, color],
  )

  // Look up (and download) the positions this plan consults; the next render may consult more.
  const planKeys = plan?.keys.join('\n')
  if (planKeys !== undefined && planKeys !== keysText) setKeysText(planKeys)

  return useMemo(
    () => (plan && cached ? { plan, explorer: cached, pending, fetchError } : undefined),
    [plan, cached, pending, fetchError],
  )
}

/**
 * A covered line's preparedness to your N-th move of the game (N = the
 * preparedness target), from where the line enters its repertoire. Your moves
 * before that count as known: they are set up by the plan, not drilled.
 */
export function useLineScore(node: CoveredNode, color: Color, settings: Settings) {
  const data = useRepertoire(node.rep.id)
  const prep = usePreparedness(data, settings.explorerFilter, settings.prepDepth)
  const score = useMemo((): RepScore | undefined => {
    if (data && !data.moves.length) return { built: 0, remembered: 0 }
    if (!data || !prep) return undefined
    const depth = settings.prepDepth - ownMovesIn(node.path, 0, color)
    return {
      built: preparedness({ ...asBuilt(prep.inputs), depth }, node.key).score,
      remembered: preparedness({ ...prep.inputs, depth }, node.key).score,
    }
  }, [data, prep, node.path, node.key, color, settings.prepDepth])
  return { data, score }
}

/** Preparedness per covered position key (built and remembered), reported by the lines that compute it. */
export function useScoreMap(): [Map<string, RepScore>, (repId: string, score: RepScore) => void] {
  const [scores, setScores] = useState(() => new Map<string, RepScore>())
  const report = useCallback((repId: string, score: RepScore) => {
    setScores((m) => {
      const cur = m.get(repId)
      return cur && cur.built === score.built && cur.remembered === score.remembered ? m : new Map(m).set(repId, score)
    })
  }, [])
  return [scores, report]
}
