// Tests for the wave linearization. The core property: waveOrder is a PURE function of
// the graph, so permuting the item order AND each item's deps array must yield identical
// wave / blockedCount / actionable, and the output must still respect the partial order
// (an unsatisfied dep precedes its dependent). Runs against the compiled dist/.
import { test } from "node:test"
import assert from "node:assert/strict"
import { waveOrder, buildView } from "../dist/model.js"

const item = (id, kind, status, deps = [], extra = {}) => ({ id, kind, name: id, status, deps, ...extra })

// Reference graph exercising: plan chain, diamond, done-dep (satisfied), design context
// (active = satisfied), tainted design (blocks), note dep (never blocks).
const base = () => [
    item("plan:A", "plan", "todo", []),
    item("plan:B", "plan", "todo", ["plan:A"]),
    item("plan:C", "plan", "todo", ["plan:B"]),
    item("plan:D", "plan", "todo", ["plan:A", "plan:B"]),
    item("plan:done", "plan", "done", []),
    item("plan:E", "plan", "todo", ["plan:done"]),
    item("design:X", "design", "active", []),
    item("plan:F", "plan", "todo", ["design:X"]),
    item("design:T", "design", "active", [], { tainted: true }),
    item("plan:G", "plan", "todo", ["design:T"]),
    item("note:N", "note", null, []),
    item("plan:H", "plan", "todo", ["note:N"]),
]

// Expected graph-derived facts (independent of input order).
const EXPECT = {
    "plan:A": { wave: 0, blockedCount: 0, actionable: true },
    "plan:B": { wave: 1, blockedCount: 1, actionable: false },
    "plan:C": { wave: 2, blockedCount: 1, actionable: false },
    "plan:D": { wave: 2, blockedCount: 2, actionable: false },
    "plan:done": { wave: 0, blockedCount: 0, actionable: false },
    "plan:E": { wave: 0, blockedCount: 0, actionable: true }, // dep done → satisfied
    "design:X": { wave: 0, blockedCount: 0, actionable: false }, // context, never actionable
    "plan:F": { wave: 0, blockedCount: 0, actionable: true }, // active design dep satisfied
    "design:T": { wave: 0, blockedCount: 0, actionable: false },
    "plan:G": { wave: 1, blockedCount: 1, actionable: false }, // tainted design blocks
    "note:N": { wave: 0, blockedCount: 0, actionable: false },
    "plan:H": { wave: 0, blockedCount: 0, actionable: true }, // note never blocks
}

const mapOf = rows => new Map(rows.map(r => [r.item.id, { wave: r.wave, blockedCount: r.blockedCount, actionable: r.actionable }]))

function shuffle(a, rng) {
    const b = a.slice()
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[b[i], b[j]] = [b[j], b[i]]
    }
    return b
}
// deterministic PRNG so failures reproduce
function mulberry32(seed) {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const permuteDeps = items => items.map(x => ({ ...x, deps: x.deps.slice().reverse() }))

test("reference graph: wave / blockedCount / actionable are exactly right", () => {
    const got = mapOf(waveOrder(base()))
    for (const [id, exp] of Object.entries(EXPECT)) {
        assert.deepEqual(got.get(id), exp, `mismatch for ${id}`)
    }
})

test("permuting item order AND deps order is invariant for wave/blocked/actionable", () => {
    const reference = mapOf(waveOrder(base()))
    const rng = mulberry32(12345)
    for (let k = 0; k < 40; k++) {
        let items = shuffle(base(), rng)
        if (k % 2 === 0) items = permuteDeps(items) // also reverse each deps array
        const got = mapOf(waveOrder(items))
        assert.equal(got.size, reference.size)
        for (const [id, exp] of reference) assert.deepEqual(got.get(id), exp, `perm ${k}, id ${id}`)
    }
})

test("stable id tiebreak → the FULL ordered sequence is identical across every permutation", () => {
    const referenceSeq = waveOrder(base()).map(r => r.item.id)
    const rng = mulberry32(777)
    for (let k = 0; k < 50; k++) {
        const items = k % 2 ? permuteDeps(shuffle(base(), rng)) : shuffle(base(), rng)
        const seq = waveOrder(items).map(r => r.item.id)
        assert.deepEqual(seq, referenceSeq, `perm ${k}: full ordering must be identical`)
    }
})

test("output always respects the partial order: an unsatisfied dep precedes its dependent", () => {
    const rng = mulberry32(999)
    // in the reference graph these are the unsatisfied-dep edges (dep must come first):
    const mustPrecede = [
        ["plan:A", "plan:B"],
        ["plan:B", "plan:C"],
        ["plan:A", "plan:D"],
        ["plan:B", "plan:D"],
        ["design:T", "plan:G"],
    ]
    for (let k = 0; k < 30; k++) {
        const rows = waveOrder(k % 2 ? permuteDeps(shuffle(base(), rng)) : shuffle(base(), rng))
        const pos = new Map(rows.map((r, i) => [r.item.id, i]))
        for (const [a, b] of mustPrecede) {
            assert.ok(pos.get(a) < pos.get(b), `perm ${k}: ${a} must precede ${b}`)
        }
        // not-done items all precede the done one; waves non-decreasing among not-done
        const donePos = pos.get("plan:done")
        let lastWave = -1
        for (const r of rows) {
            if (r.item.status !== "done") {
                assert.ok(pos.get(r.item.id) < donePos, `not-done ${r.item.id} before done`)
                assert.ok(r.wave >= lastWave, `waves non-decreasing among not-done (at ${r.item.id})`)
                lastWave = r.wave
            }
        }
    }
})

test("a dependency cycle terminates and keeps every node", () => {
    const cyclic = [
        item("plan:A", "plan", "todo", ["plan:C"]),
        item("plan:B", "plan", "todo", ["plan:A"]),
        item("plan:C", "plan", "todo", ["plan:B"]),
    ]
    const rows = waveOrder(cyclic)
    assert.equal(rows.length, 3)
    assert.deepEqual(new Set(rows.map(r => r.item.id)), new Set(["plan:A", "plan:B", "plan:C"]))
})

test("dangling deps (dep id not in the set) don't block", () => {
    const rows = waveOrder([item("plan:A", "plan", "todo", ["plan:missing"])])
    assert.equal(rows[0].wave, 0)
    assert.equal(rows[0].blockedCount, 0)
    assert.equal(rows[0].actionable, true)
})

test("buildView: source=plan is wave-ordered, source=agent sorts by startedAt", () => {
    const sources = new Map([
        ["plan", { source: "plan", seq: 0, items: base() }],
        [
            "agent",
            {
                source: "agent",
                seq: 0,
                items: [
                    { id: "agent:2", kind: "agent", name: "second", status: "in_progress", deps: [], meta: { startedAt: 200 } },
                    { id: "agent:1", kind: "agent", name: "first", status: "done", deps: [], meta: { startedAt: 100 } },
                ],
            },
        ],
    ])
    const view = buildView(sources)
    assert.equal(view.plans.length, 12)
    assert.deepEqual(
        view.agents.map(a => a.id),
        ["agent:1", "agent:2"],
    )
})
