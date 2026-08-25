// The `plan-item` wire contract (Phase A: defined here; extracted to a shared lib in
// Phase B). A source emits a full-replace SNAPSHOT of its slice; consumers keep a
// per-source map keyed by `source` and replace on each snapshot.

/** One node. `kind` is passed through verbatim from the source (plan|design|note|agent). */
export interface PlanItem {
    /** Namespaced id, `<kind>:<slug>` (crib) or `agent:<id>`. */
    id: string
    kind: string
    name: string
    status: string | null
    /** must-precede refs (this item depends on these), by node id. */
    deps: string[]
    tainted?: boolean
    meta?: Record<string, unknown>
}

/** A full replace-the-slice snapshot for one `source`. `seq` drops out-of-order arrivals. */
export interface PlanSnapshot {
    source: string
    seq: number
    project?: string
    items: PlanItem[]
}

/** Parse the `data` of a `plan-item` custom entry into a snapshot. Returns null when the
 *  payload is unusable (caller leaves its per-source slice as-is). */
export function parseSnapshot(data: unknown): PlanSnapshot | null {
    if (!data || typeof data !== "object") return null
    const d = data as Record<string, unknown>
    if (typeof d.source !== "string" || !Array.isArray(d.items)) return null

    const items: PlanItem[] = []
    for (const raw of d.items) {
        if (!raw || typeof raw !== "object") continue
        const r = raw as Record<string, unknown>
        if (typeof r.id !== "string") continue
        items.push({
            id: r.id,
            kind: typeof r.kind === "string" ? r.kind : "plan",
            name: typeof r.name === "string" ? r.name : r.id,
            status: typeof r.status === "string" ? r.status : null,
            deps: Array.isArray(r.deps) ? r.deps.filter((x): x is string => typeof x === "string") : [],
            tainted: typeof r.tainted === "boolean" ? r.tainted : undefined,
            meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : undefined,
        })
    }
    return {
        source: d.source,
        seq: typeof d.seq === "number" ? d.seq : 0,
        project: typeof d.project === "string" ? d.project : undefined,
        items,
    }
}
