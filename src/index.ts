// pi-plan: a plan sidebar. Consumes `plan:snapshot` (full-replace) and `plan:update`
// (part-by-part) events off the shared in-process `pi.events` bus (emitted by the cribsheet
// plan source, and any other plan source) and renders them as a persistent TUI widget:
// plans wave-ordered, agents chronological. State accumulates per source `ns` in a PlanState.
//
// pi widgets are render-only, so the widget is controlled by the `/plan` slash command:
// toggle expand<->collapse, hide/show, and filter what's shown. Collapsed is a one-line
// summary with a grey hint; expanded is the wave-ordered tree.

import type { ExtensionAPI, ExtensionContext, UIContext, AutocompleteItem } from "./pi.js"
import { parseSnapshot, parseUpdate, newPlanState, applySnapshot, applyUpdate, planItemsOf } from "./wire.js"
import { buildView, type PlanRow } from "./model.js"
import { renderExpanded, summaryLine } from "./render.js"
import { readSettings, ensureSettingsFile, type WidgetState } from "./settings.js"
import { installAgentSource } from "./agents.js"

const WIDGET_KEY = "plan"

const VERBS = [
    "toggle",
    "expand",
    "collapse",
    "hide",
    "show",
    "agents",
    "show agents",
    "hide agents",
    "filter done",
    "filter context",
]

export default function planSidebar(pi: ExtensionAPI): void {
    const planState = newPlanState()
    let uiCtx: UIContext | undefined

    // Initial widget control state comes from settings (extensions/pi-plan.json); /plan
    // mutates it for the session.
    const settings = readSettings()
    const placement = settings.placement
    let mode: WidgetState = settings.defaultState
    let showDone = settings.showDone
    let showContext = settings.showContext
    let showAgents = settings.showAgents

    const filterPlans = (rows: PlanRow[]): PlanRow[] =>
        rows.filter((r) => (showDone || r.item.status !== "done") && (showContext || r.item.kind === "plan"))

    const render = (): void => {
        if (!uiCtx) return
        if (mode === "hidden") {
            uiCtx.setWidget(WIDGET_KEY, undefined)
            return
        }
        const planItems = planItemsOf(planState)
        const agentItems = showAgents ? agentSource.items() : []
        const view = buildView(planItems, agentItems)
        const plans = filterPlans(view.plans)
        const agents = view.agents
        if (plans.length === 0 && agents.length === 0) {
            uiCtx.setWidget(WIDGET_KEY, undefined)
            return
        }
        const collapsed = mode === "collapsed"
        uiCtx.setWidget(
            WIDGET_KEY,
            (_tui, theme) => ({
                render: () => (collapsed ? summaryLine(plans, agents, theme) : renderExpanded(plans, agents, theme)),
            }),
            { placement },
        )
    }

    const captureUi = (ctx: ExtensionContext): void => {
        if (ctx.ui) uiCtx = ctx.ui
    }

    ensureSettingsFile() // materialize defaults so the options are discoverable

    pi.on("session_start", (_event, ctx) => captureUi(ctx))
    pi.on("turn_end", (_event, ctx) => captureUi(ctx))

    // Render on RECEIPT OF A PLAN from any source (shared in-process bus): full snapshots and
    // part-by-part updates, accumulated per `ns` into planState.
    pi.events.on("plan:snapshot", (data: unknown) => {
        const snap = parseSnapshot(data)
        if (snap && applySnapshot(planState, snap)) render()
    })
    pi.events.on("plan:update", (data: unknown) => {
        const up = parseUpdate(data)
        if (up && applyUpdate(planState, up)) render()
    })

    // Read the subagent fleet directly (the same way pi-acp does) and repaint on change.
    const agentSource = installAgentSource(pi, render)

    // /plan — control the render-only widget.
    pi.registerCommand("plan", {
        description:
            "Plan sidebar: toggle | expand | collapse | hide | show | agents (show agents|hide agents) | filter done|context",
        handler: (args, ctx) => {
            captureUi(ctx)
            const a = args.trim().toLowerCase()
            if (a === "" || a === "toggle") mode = mode === "expanded" ? "collapsed" : "expanded"
            else if (a === "agents") showAgents = !showAgents
            else if (a === "show agents") showAgents = true
            else if (a === "hide agents") showAgents = false
            else if (a === "expand" || a === "show") mode = "expanded"
            else if (a === "collapse") mode = "collapsed"
            else if (a === "hide") mode = "hidden"
            else if (a === "filter done") showDone = !showDone
            else if (a === "filter context") showContext = !showContext
            else if (a.startsWith("filter")) {
                ctx.ui?.notify?.(
                    `plan filters — done=${showDone}, context=${showContext}, agents=${showAgents}`,
                    "info",
                )
                return
            }
            render()
        },
        getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
            const p = prefix.trim()
            const matches = VERBS.filter((v) => v.startsWith(p))
            return matches.length ? matches.map((v) => ({ value: v, label: v })) : null
        },
    })
}
