// Tests for the AgentState merge — monotonic status (pi can emit out of order), field
// preservation, terminal-reason precedence, and the display mapping. Against compiled dist/.
import { test } from "node:test"
import assert from "node:assert/strict"
import { statusRank, mergeAgentState, toAgentItem } from "../dist/agents.js"

test("statusRank: pending(0) < in_progress(1) < terminal(2)", () => {
    assert.equal(statusRank("created"), 0)
    assert.equal(statusRank(undefined), 0)
    assert.equal(statusRank("started"), 1)
    assert.equal(statusRank("steered"), 1)
    assert.equal(statusRank("completed"), 2)
    assert.equal(statusRank("failed"), 2)
    assert.equal(statusRank("aborted"), 2)
})

test("merge never downgrades status (out-of-order events)", () => {
    // completed arrives, then a late 'started' — must stay completed.
    const a = mergeAgentState({ id: "x", status: "completed" }, { id: "x", status: "started" })
    assert.equal(a.status, "completed")
    // 'started' before 'created' — must not drop to created/pending.
    const b = mergeAgentState({ id: "x", status: "started" }, { id: "x", status: "created" })
    assert.equal(b.status, "started")
})

test("merge preserves type/description/result/error/duration when incoming omits them", () => {
    const prev = { id: "x", type: "explore", description: "look at X", result: "found it", durationMs: 500 }
    const merged = mergeAgentState(prev, { id: "x", status: "completed" })
    assert.equal(merged.type, "explore")
    assert.equal(merged.description, "look at X")
    assert.equal(merged.result, "found it")
    assert.equal(merged.durationMs, 500)
    assert.equal(merged.status, "completed")
})

test("merge keeps the specific terminal reason over a generic 'failed'", () => {
    // Both terminal; a generic 'failed' must not overwrite a specific 'aborted'.
    const merged = mergeAgentState({ id: "x", status: "aborted" }, { id: "x", status: "failed" })
    assert.equal(merged.status, "aborted")
})

test("toAgentItem: id prefix, display status, name fallback", () => {
    assert.deepEqual(toAgentItem({ id: "42", type: "explore", description: "look", status: "started" }), {
        id: "agent:42",
        kind: "agent",
        name: "look",
        status: "in_progress",
        deps: [],
        meta: {
            agentType: "explore",
            startedAt: undefined,
            durationMs: undefined,
            result: undefined,
            error: undefined,
        },
    })
    // status mapping
    assert.equal(toAgentItem({ id: "1", status: "created" }).status, "pending")
    assert.equal(toAgentItem({ id: "1", status: "completed" }).status, "done")
    assert.equal(toAgentItem({ id: "1", status: "aborted" }).status, "failed")
    // name falls back type -> id when no description
    assert.equal(toAgentItem({ id: "1", type: "review" }).name, "review")
    assert.equal(toAgentItem({ id: "1" }).name, "1")
})
