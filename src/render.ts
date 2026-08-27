// Render the plan to widget lines (string[]). Two forms share a visual marker + grey
// hint: collapsed (one line, ▸) and expanded (▾ header + wave-ordered rows). Plans show a
// dim "blocked deps" indicator; the actionable set (wave 0, not done) is highlighted.

import type { Theme } from "./pi.js"
import type { PlanItem } from "./wire.js"
import type { PlanRow } from "./model.js"

/** Max plan rows before the expanded view caps with a "…N more" trailer. */
const MAX_ROWS = 18

/** Fallback panel width when the TUI hasn't reported one yet. */
const DEFAULT_WIDTH = 80

// pi's TUI aborts the whole render if any emitted line's VISIBLE width exceeds the
// terminal, so every line this widget returns is clamped. Lines carry SGR color codes
// and OSC-8 hyperlinks; those must be measured as zero-width and preserved when cutting.
// eslint-disable-next-line no-control-regex
const SGR_RE = /\x1b\[[0-9;]*m/
// eslint-disable-next-line no-control-regex
const OSC8_RE = /\x1b\]8;;[^\x1b\x07]*(?:\x07|\x1b\\)/

function charWidth(cp: number): number {
    // Zero-width combining marks / joiners / variation selectors.
    if (cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
    // Wide ranges: CJK, Hangul, fullwidth forms, and emoji planes.
    if (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
    )
        return 2
    return 1
}

/** Visible column width of a styled string, ignoring SGR + OSC-8 escape sequences. */
export function visibleWidth(s: string): number {
    let w = 0
    for (let i = 0; i < s.length;) {
        const rest = s.slice(i)
        const sgr = rest.match(SGR_RE)
        if (sgr && sgr.index === 0) {
            i += sgr[0].length
            continue
        }
        const osc = rest.match(OSC8_RE)
        if (osc && osc.index === 0) {
            i += osc[0].length
            continue
        }
        const cp = s.codePointAt(i) as number
        w += charWidth(cp)
        i += cp > 0xffff ? 2 : 1
    }
    return w
}

/** Clamp a styled line to `max` visible columns, preserving escapes and appending an
 *  ellipsis + SGR reset so color never bleeds past the cut. */
export function truncateToWidth(s: string, max: number): string {
    if (max <= 0) return ""
    if (visibleWidth(s) <= max) return s
    const budget = max - 1 // reserve a column for the ellipsis
    let out = ""
    let w = 0
    for (let i = 0; i < s.length;) {
        const rest = s.slice(i)
        const sgr = rest.match(SGR_RE)
        if (sgr && sgr.index === 0) {
            out += sgr[0]
            i += sgr[0].length
            continue
        }
        const osc = rest.match(OSC8_RE)
        if (osc && osc.index === 0) {
            out += osc[0]
            i += osc[0].length
            continue
        }
        const cp = s.codePointAt(i) as number
        const cw = charWidth(cp)
        if (w + cw > budget) break
        out += String.fromCodePoint(cp)
        w += cw
        i += cp > 0xffff ? 2 : 1
    }
    return `${out}…\x1b[0m`
}

/** Clamp every line to the panel width so pi's renderer never aborts. */
function clamp(lines: string[], width: number): string[] {
    return lines.map((l) => truncateToWidth(l, width))
}

const STATUS_ICON: Record<string, string> = {
    todo: "○",
    pending: "○",
    "in-progress": "◐",
    in_progress: "◐",
    done: "●",
    completed: "●",
    failed: "✗",
    active: "●",
    superseded: "⊘",
}

function icon(status: string | null): string {
    return status ? (STATUS_ICON[status] ?? "•") : "·"
}

function statusColor(status: string | null): string {
    switch (status) {
        case "done":
        case "completed":
        case "active":
            return "success"
        case "failed":
            return "error"
        case "in_progress":
        case "in-progress":
            return "accent"
        default:
            return "dim"
    }
}

function isContext(item: PlanItem): boolean {
    return item.kind !== "plan" && item.kind !== "agent"
}

function renderPlanRow(row: PlanRow, theme: Theme): string {
    const { item } = row
    const marker = theme.fg(statusColor(item.status), icon(item.status))
    const name = row.actionable
        ? theme.fg("accent", item.name)
        : item.status === "done" || isContext(item)
          ? theme.fg("dim", item.name)
          : item.name
    const badge = isContext(item) ? theme.fg("dim", ` [${item.kind}]`) : ""
    const blocked = row.blockedCount > 0 ? theme.fg("dim", ` ⋯${row.blockedCount}`) : ""
    const cyc = row.circular ? theme.fg("error", " ⟲") : ""
    const taint = item.tainted ? theme.fg("warning", " ⚠") : ""
    return `  ${marker} ${name}${badge}${blocked}${cyc}${taint}`
}

function renderAgentItem(item: PlanItem, theme: Theme): string {
    return `  ${theme.fg(statusColor(item.status), icon(item.status))} ${item.name}`
}

interface Counts {
    ready: number
    active: number
    blocked: number
    circular: number
    done: number
}
function counts(plans: PlanRow[]): Counts {
    const c: Counts = { ready: 0, active: 0, blocked: 0, circular: 0, done: 0 }
    for (const r of plans) {
        if (r.item.status === "done") {
            c.done++
            continue
        }
        if (r.item.status === "in_progress" || r.item.status === "in-progress") c.active++
        if (r.circular) c.circular++
        else if (r.actionable) c.ready++
        else if (r.blockedCount > 0) c.blocked++
    }
    return c
}

/** Collapsed form: one line — marker, counts, and a grey hint to expand. */
export function summaryLine(plans: PlanRow[], agents: PlanItem[], theme: Theme, width = DEFAULT_WIDTH): string[] {
    const c = counts(plans)
    const parts: string[] = []
    if (c.ready) parts.push(theme.fg("accent", `${c.ready} ready`))
    if (c.active) parts.push(theme.fg("accent", `${c.active} active`))
    if (c.blocked) parts.push(theme.fg("dim", `${c.blocked} blocked`))
    if (c.circular) parts.push(theme.fg("error", `${c.circular} circular`))
    if (agents.length) parts.push(`${agents.length} agent${agents.length === 1 ? "" : "s"}`)
    const body = parts.length ? "  " + parts.join(theme.fg("dim", " · ")) : theme.fg("dim", "  (empty)")
    return clamp(
        [`${theme.fg("dim", "▸")} ${theme.bold("Plan")}${body}${theme.fg("dim", "   /plan to expand")}`],
        width,
    )
}

/** Expanded form: marker header + wave-ordered rows (capped) + the agent group. */
export function renderExpanded(plans: PlanRow[], agents: PlanItem[], theme: Theme, width = DEFAULT_WIDTH): string[] {
    const lines: string[] = [`${theme.fg("dim", "▾")} ${theme.bold("Plan")}${theme.fg("dim", "   /plan to collapse")}`]
    const shown = plans.slice(0, MAX_ROWS)
    for (const row of shown) lines.push(renderPlanRow(row, theme))
    if (plans.length > shown.length) {
        lines.push(theme.fg("dim", `  … ${plans.length - shown.length} more · /plan filter`))
    }
    if (agents.length > 0) {
        lines.push("")
        lines.push(theme.bold("Agents"))
        for (const it of agents) lines.push(renderAgentItem(it, theme))
    }
    return clamp(lines, width)
}
