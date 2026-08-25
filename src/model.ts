// The two-group model. Plans are linearized into WAVES (not a DAG tree, which gets
// messy): a dep is satisfied by kind, an item's wave is the longest chain of UNsatisfied
// deps above it, and each wave is a set executable at once. Agents render as a flat
// chronological group.

import type { PlanItem } from "./wire.js"

/** A plan item enriched with its wave position and how many deps still block it. */
export interface PlanRow {
    item: PlanItem
    /** 0 = free now (all deps satisfied); N = behind N waves of unsatisfied deps. */
    wave: number
    /** direct, in-set deps that are not yet satisfied. */
    blockedCount: number
    /** a PLAN item, not done, wave 0 — the set you can actually pick up now.
     *  (design/note are context, never "actionable".) */
    actionable: boolean
}

/** Sort priority so actual work leads and context trails, within a wave. */
function kindRank(kind: string): number {
    if (kind === "plan") return 0
    if (kind === "design") return 1
    if (kind === "note") return 2
    return 3
}

export interface PlanView {
    plans: PlanRow[]
    agents: PlanItem[]
}

function isDone(item: PlanItem): boolean {
    return item.status === "done"
}

/** Does depending on `item` block a dependent? Mirrors crib dep semantics:
 *  note → never; design → blocks only while tainted; plan → blocks until done. */
function isSatisfied(item: PlanItem): boolean {
    if (item.kind === "note") return true
    if (item.kind === "design") return !item.tainted
    return isDone(item)
}

/**
 * Linearize plan items into waves. `wave = 0` when no in-set dep is unsatisfied;
 * otherwise `1 + max(wave of unsatisfied in-set deps)`. Cycle-guarded (a node on the
 * current DFS stack contributes 0, so a cycle can't recurse forever). Ordered by
 * (wave, original index); done items sink to the end.
 */
export function waveOrder(items: PlanItem[]): PlanRow[] {
    const byId = new Map(items.map((i) => [i.id, i]))

    // Unsatisfied, in-set deps for an item (the ones that actually block it here).
    const blockers = (item: PlanItem): PlanItem[] =>
        item.deps.map((d) => byId.get(d)).filter((d): d is PlanItem => !!d && d.id !== item.id && !isSatisfied(d))

    const waveCache = new Map<string, number>()
    const onStack = new Set<string>()
    const waveOf = (item: PlanItem): number => {
        const cached = waveCache.get(item.id)
        if (cached !== undefined) return cached
        if (onStack.has(item.id)) return 0 // cycle: don't recurse
        onStack.add(item.id)
        const bl = blockers(item)
        const w = bl.length === 0 ? 0 : 1 + Math.max(...bl.map(waveOf))
        onStack.delete(item.id)
        waveCache.set(item.id, w)
        return w
    }

    const rows: PlanRow[] = items.map((item) => {
        const blockedCount = blockers(item).length
        const wave = waveOf(item)
        const actionable = item.kind === "plan" && !isDone(item) && wave === 0
        return { item, wave, blockedCount, actionable }
    })

    rows.sort((a, b) => {
        const ad = isDone(a.item) ? 1 : 0
        const bd = isDone(b.item) ? 1 : 0
        if (ad !== bd) return ad - bd // not-done first, done sink to the end
        if (a.wave !== b.wave) return a.wave - b.wave
        const ak = kindRank(a.item.kind)
        const bk = kindRank(b.item.kind)
        if (ak !== bk) return ak - bk // plan work before design/note context
        // Stable tiebreak: the item's OWN id — deterministic regardless of input/dep order.
        return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0
    })
    return rows
}

/** Agents: flat, chronological by startedAt (fallback receiptIndex), both in `meta`. */
export function sortAgents(items: PlanItem[]): PlanItem[] {
    const key = (it: PlanItem): number => {
        const started = Number(it.meta?.startedAt)
        if (Number.isFinite(started)) return started
        const receipt = Number(it.meta?.receiptIndex)
        return Number.isFinite(receipt) ? receipt : 0
    }
    return [...items].sort((a, b) => key(a) - key(b))
}

/** Build the rendered view: plans wave-ordered, agents chronological. Plans come from the
 *  crib bus snapshot; agents from the direct subagent read (see agents.ts). */
export function buildView(planItems: PlanItem[], agentItems: PlanItem[]): PlanView {
    return { plans: waveOrder(planItems), agents: sortAgents(agentItems) }
}
