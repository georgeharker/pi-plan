// Render the plan to widget lines (string[]). Two forms share a visual marker + grey
// hint: collapsed (one line, ▸) and expanded (▾ header + wave-ordered rows). Plans show a
// dim "blocked deps" indicator; the actionable set (wave 0, not done) is highlighted.

import type { Theme } from "./pi.js"
import type { PlanItem } from "./wire.js"
import type { PlanRow } from "./model.js"

/** Max plan rows before the expanded view caps with a "…N more" trailer. */
const MAX_ROWS = 18

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
    const taint = item.tainted ? theme.fg("warning", " ⚠") : ""
    return `  ${marker} ${name}${badge}${blocked}${taint}`
}

function renderAgentItem(item: PlanItem, theme: Theme): string {
    return `  ${theme.fg(statusColor(item.status), icon(item.status))} ${item.name}`
}

interface Counts {
    ready: number
    active: number
    blocked: number
    done: number
}
function counts(plans: PlanRow[]): Counts {
    const c: Counts = { ready: 0, active: 0, blocked: 0, done: 0 }
    for (const r of plans) {
        if (r.item.status === "done") {
            c.done++
            continue
        }
        if (r.item.status === "in_progress" || r.item.status === "in-progress") c.active++
        if (r.actionable) c.ready++
        else if (r.blockedCount > 0) c.blocked++
    }
    return c
}

/** Collapsed form: one line — marker, counts, and a grey hint to expand. */
export function summaryLine(plans: PlanRow[], agents: PlanItem[], theme: Theme): string[] {
    const c = counts(plans)
    const parts: string[] = []
    if (c.ready) parts.push(theme.fg("accent", `${c.ready} ready`))
    if (c.active) parts.push(theme.fg("accent", `${c.active} active`))
    if (c.blocked) parts.push(theme.fg("dim", `${c.blocked} blocked`))
    if (agents.length) parts.push(`${agents.length} agent${agents.length === 1 ? "" : "s"}`)
    const body = parts.length ? "  " + parts.join(theme.fg("dim", " · ")) : theme.fg("dim", "  (empty)")
    return [`${theme.fg("dim", "▸")} ${theme.bold("Plan")}${body}${theme.fg("dim", "   /plan to expand")}`]
}

/** Expanded form: marker header + wave-ordered rows (capped) + the agent group. */
export function renderExpanded(plans: PlanRow[], agents: PlanItem[], theme: Theme): string[] {
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
    return lines
}
