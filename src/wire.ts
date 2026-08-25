// The plan wire contract (Phase A: defined here; extracted to a shared lib in Phase B).
// Two channels, split by OPERATION:
//   plan:snapshot  { ns, seq?, items }              — replace this ns's whole set
//   plan:update    { ns, seq?, upsert?, remove? }   — part-by-part patch
// One item schema; rich fields (kind, tainted, deps) are optional. `ns` attributes the
// source; consumers accumulate into a per-ns PlanState. The wire item field is `title`;
// we keep it as `name` internally so model/render are unchanged.

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

/** A full-replace snapshot for one `ns` (channel `plan:snapshot`). */
export interface PlanSnapshot {
    ns: string
    seq: number
    project?: string
    items: PlanItem[]
}

/** A part-by-part patch for one `ns` (channel `plan:update`). */
export interface PlanUpdate {
    ns: string
    seq: number
    upsert: PlanItem[]
    remove: string[]
}

/** Accumulated plan state: per-ns item maps + last-seen seq for out-of-order guarding. */
export interface PlanState {
    byNs: Map<string, Map<string, PlanItem>>
    lastSeq: Map<string, number>
}

export function newPlanState(): PlanState {
    return { byNs: new Map(), lastSeq: new Map() }
}

function parseItem(raw: unknown): PlanItem | null {
    if (!raw || typeof raw !== "object") return null
    const r = raw as Record<string, unknown>
    if (typeof r.id !== "string") return null
    // `title` is the wire field; tolerate `name` from sources that haven't renamed yet.
    const display = typeof r.title === "string" ? r.title : typeof r.name === "string" ? r.name : r.id
    return {
        id: r.id,
        kind: typeof r.kind === "string" ? r.kind : "plan",
        name: display,
        status: typeof r.status === "string" ? r.status : null,
        deps: Array.isArray(r.deps) ? r.deps.filter((x): x is string => typeof x === "string") : [],
        tainted: typeof r.tainted === "boolean" ? r.tainted : undefined,
        meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : undefined,
    }
}

/** Parse a `plan:snapshot` payload. Returns null when unusable. Accepts `source` as a
 *  legacy alias for `ns`. */
export function parseSnapshot(data: unknown): PlanSnapshot | null {
    if (!data || typeof data !== "object") return null
    const d = data as Record<string, unknown>
    const ns = typeof d.ns === "string" ? d.ns : typeof d.source === "string" ? d.source : null
    if (!ns || !Array.isArray(d.items)) return null
    const items = d.items.map(parseItem).filter((x): x is PlanItem => x !== null)
    return {
        ns,
        seq: typeof d.seq === "number" ? d.seq : 0,
        project: typeof d.project === "string" ? d.project : undefined,
        items,
    }
}

/** Parse a `plan:update` payload. Returns null when unusable or a no-op. */
export function parseUpdate(data: unknown): PlanUpdate | null {
    if (!data || typeof data !== "object") return null
    const d = data as Record<string, unknown>
    const ns = typeof d.ns === "string" ? d.ns : null
    if (!ns) return null
    const upsert = Array.isArray(d.upsert) ? d.upsert.map(parseItem).filter((x): x is PlanItem => x !== null) : []
    const remove = Array.isArray(d.remove) ? d.remove.filter((x): x is string => typeof x === "string") : []
    if (upsert.length === 0 && remove.length === 0) return null
    return { ns, seq: typeof d.seq === "number" ? d.seq : 0, upsert, remove }
}

/** Apply a snapshot in place. Returns true when the state changed (drops stale seq). */
export function applySnapshot(state: PlanState, snap: PlanSnapshot): boolean {
    const last = state.lastSeq.get(snap.ns)
    if (last != null && snap.seq < last) return false
    state.lastSeq.set(snap.ns, snap.seq)
    const next = new Map<string, PlanItem>()
    for (const it of snap.items) next.set(it.id, it)
    state.byNs.set(snap.ns, next)
    return true
}

/** Apply a part-by-part update in place. Returns true when the state changed. */
export function applyUpdate(state: PlanState, up: PlanUpdate): boolean {
    const last = state.lastSeq.get(up.ns)
    if (last != null && up.seq < last) return false
    state.lastSeq.set(up.ns, up.seq)
    const map = state.byNs.get(up.ns) ?? new Map<string, PlanItem>()
    let changed = false
    for (const it of up.upsert) {
        map.set(it.id, it)
        changed = true
    }
    for (const id of up.remove) {
        changed = map.delete(id) || changed
    }
    if (changed) state.byNs.set(up.ns, map)
    return changed
}

/** Flatten accumulated state to a single item list (ns-then-insertion order). */
export function planItemsOf(state: PlanState): PlanItem[] {
    const out: PlanItem[] = []
    for (const map of state.byNs.values()) for (const it of map.values()) out.push(it)
    return out
}
