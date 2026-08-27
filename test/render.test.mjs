// Tests for the width-clamp that keeps pi's TUI renderer from aborting: every line the
// widget emits must have a VISIBLE width (ignoring SGR + OSC-8 escapes) no wider than the
// panel. Regression for the doRender crash where a 205-col plan row overflowed a 157-col
// terminal. Against compiled dist/.
import { test } from "node:test"
import assert from "node:assert/strict"
import { visibleWidth, truncateToWidth, renderExpanded, summaryLine } from "../dist/render.js"

// A theme that wraps text in real SGR codes, mirroring pi's themed primitives.
const COLOR = { accent: 32, dim: 90, success: 92, error: 91, warning: 93 }
const theme = {
    fg: (c, t) => `\x1b[${COLOR[c] ?? 39}m${t}\x1b[39m`,
    bold: (t) => `\x1b[1m${t}\x1b[22m`,
}

const row = (name, extra = {}) => ({
    item: { id: name, kind: "plan", name, status: "todo", deps: [], ...extra },
    actionable: true,
    blockedCount: 0,
    circular: false,
})

test("visibleWidth ignores SGR and OSC-8 escapes", () => {
    assert.equal(visibleWidth("abc"), 3)
    assert.equal(visibleWidth("\x1b[32mabc\x1b[39m"), 3)
    assert.equal(visibleWidth("\x1b]8;;https://x\x07link\x1b]8;;\x07"), 4)
})

test("truncateToWidth never exceeds the budget and resets color", () => {
    const styled = "\x1b[32m" + "x".repeat(300) + "\x1b[39m"
    const out = truncateToWidth(styled, 40)
    assert.ok(visibleWidth(out) <= 40, `visible ${visibleWidth(out)} > 40`)
    assert.ok(out.endsWith("\x1b[0m"), "must reset SGR at the cut")
})

test("truncateToWidth leaves already-fitting lines untouched", () => {
    const s = "\x1b[90m▸\x1b[39m short"
    assert.equal(truncateToWidth(s, 80), s)
})

test("renderExpanded clamps a long plan row to the panel width", () => {
    const long =
        "Fork: build B — after the wrap-spike, mirror DECLARATIVE ctx.ui dialogs (select/confirm/input/notify) to the app, race the shell, abort loser."
    const lines = renderExpanded([row(long)], [], theme, 60)
    for (const l of lines) assert.ok(visibleWidth(l) <= 60, `line width ${visibleWidth(l)} > 60: ${JSON.stringify(l)}`)
})

test("summaryLine is clamped to a narrow panel", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`item ${i}`))
    const lines = summaryLine(rows, [], theme, 20)
    for (const l of lines) assert.ok(visibleWidth(l) <= 20, `line width ${visibleWidth(l)} > 20`)
})
