// Direct subagent read — the SAME way pi-acp sources them (its src/acp/subagent-plan.ts
// + pi-extension.ts): subscribe the 6 `subagents:*` bus channels, merge monotonically by
// status rank, and clear on session_shutdown. In-process, so no appendEntry. Enrichment
// (result/error/timing) comes from the globalThis pi-subagents manager (getRecord), since
// the `subagents:record` custom entry isn't delivered to in-process extension handlers.
//
// We keep a LIVE fleet of AgentState (not a snapshot): a mutable Map<id, AgentState> merged
// across lifecycle events, so `items()` always reflects the current active/finished agents.

import type { ExtensionAPI } from "./pi.js"
import type { PlanItem } from "./wire.js"

/** The kept state of one subagent, merged across its lifecycle events. */
export interface AgentState {
    id: string
    type?: string
    description?: string
    /** raw pi-subagents lifecycle status. */
    status?: string
    startedAt?: number
    durationMs?: number
    result?: string
    error?: string
}

const IN_PROGRESS_STATUSES = new Set(["started", "running", "steered", "compacted"])
const FAILED_STATUSES = new Set(["failed", "stopped", "aborted", "error"])

/** Lifecycle rank: pending(0) < in_progress(1) < terminal(2). pi can emit out of order. */
export function statusRank(status: string | undefined): number {
    const s = String(status ?? "").toLowerCase()
    if (s === "completed" || FAILED_STATUSES.has(s)) return 2
    if (IN_PROGRESS_STATUSES.has(s)) return 1
    return 0
}

/** Merge an incoming lifecycle event into the kept state: preserve type/description/result,
 *  never downgrade status, keep the specific terminal reason over a generic `failed`.
 *  (Port of pi-acp's mergeSubagent.) */
export function mergeAgentState(prev: AgentState | undefined, incoming: AgentState): AgentState {
    const merged: AgentState = { ...prev, ...incoming }
    if (prev?.type && !incoming.type) merged.type = prev.type
    if (prev?.description && !incoming.description) merged.description = prev.description
    if (prev?.result && !incoming.result) merged.result = prev.result
    if (prev?.error && !incoming.error) merged.error = prev.error
    if (prev?.durationMs != null && incoming.durationMs == null) merged.durationMs = prev.durationMs
    if (prev) {
        const prevStatus = String(prev.status ?? "").toLowerCase()
        const inStatus = String(incoming.status ?? "").toLowerCase()
        const prevRank = statusRank(prevStatus)
        const inRank = statusRank(inStatus)
        if (prevRank > inRank) merged.status = prev.status
        else if (prevRank === 2 && inRank === 2 && inStatus === "failed" && prevStatus !== "failed")
            merged.status = prev.status
    }
    return merged
}

/** Map a raw lifecycle status to the display status the model/render use. */
function displayStatus(status: string | undefined): string {
    const s = String(status ?? "").toLowerCase()
    if (s === "completed") return "done"
    if (FAILED_STATUSES.has(s)) return "failed"
    if (IN_PROGRESS_STATUSES.has(s)) return "in_progress"
    return "pending"
}

/** An AgentState → a `kind:"agent"` plan item for the model's Agents group. */
export function toAgentItem(a: AgentState): PlanItem {
    const name = a.description?.trim() || a.type || a.id
    return {
        id: `agent:${a.id}`,
        kind: "agent",
        name,
        status: displayStatus(a.status),
        deps: [],
        meta: {
            agentType: a.type,
            startedAt: a.startedAt,
            durationMs: a.durationMs,
            result: a.result,
            error: a.error,
        },
    }
}

const LIFECYCLE: Record<string, string> = {
    "subagents:created": "created",
    "subagents:started": "started",
    "subagents:completed": "completed",
    "subagents:failed": "failed",
    "subagents:steered": "steered",
    "subagents:compacted": "compacted",
}

function str(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined
}
function num(v: unknown): number | undefined {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** Best-effort read of pi-subagents' in-process manager for enrichment (no `list`, so
 *  per-id `getRecord` only). Returns the record's timing/result/error if present. */
function managerRecord(id: string): Partial<AgentState> {
    try {
        const mgr = (globalThis as { [k: symbol]: unknown })[Symbol.for("pi-subagents:manager")] as
            { getRecord?: (id: string) => unknown } | undefined
        const rec = mgr?.getRecord?.(id) as
            { startedAt?: unknown; completedAt?: unknown; result?: unknown; error?: unknown } | undefined
        if (!rec) return {}
        const startedAt = num(rec.startedAt)
        const completedAt = num(rec.completedAt)
        return {
            startedAt,
            durationMs:
                startedAt != null && completedAt != null && completedAt >= startedAt
                    ? completedAt - startedAt
                    : undefined,
            result: str(rec.result),
            error: str(rec.error),
        }
    } catch {
        return {}
    }
}

export interface AgentSource {
    /** Current fleet as agent plan items. */
    items(): PlanItem[]
    /** Raw kept state (active + finished), for callers that need more than plan items. */
    fleet(): AgentState[]
}

/**
 * Subscribe the subagent lifecycle and maintain the merged fleet (a live Map of AgentState).
 * `onChange` fires on every update so the caller can repaint.
 */
export function installAgentSource(pi: ExtensionAPI, onChange: () => void): AgentSource {
    const fleet = new Map<string, AgentState>()

    const record =
        (status: string) =>
        (data: unknown): void => {
            const p = (data ?? {}) as { id?: unknown; type?: unknown; description?: unknown }
            const id = str(p.id)
            if (!id) return
            const prev = fleet.get(id)
            const now = Date.now()
            const incoming: AgentState = {
                id,
                type: str(p.type),
                description: str(p.description),
                status,
                startedAt: prev?.startedAt ?? (IN_PROGRESS_STATUSES.has(status) ? now : undefined),
                ...managerRecord(id),
            }
            fleet.set(id, mergeAgentState(prev, incoming))
            onChange()
        }

    for (const [channel, status] of Object.entries(LIFECYCLE)) pi.events.on(channel, record(status))
    pi.on("session_shutdown", () => {
        fleet.clear()
        onChange()
    })

    return {
        items: () => [...fleet.values()].map(toAgentItem),
        fleet: () => [...fleet.values()],
    }
}
