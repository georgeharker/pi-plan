// pi-plan: a plan sidebar. Consumes `plan-item` snapshots off the shared in-process
// `pi.events` bus (emitted by the cribsheet plan source, and later the agent source) and
// renders them as a persistent TUI widget: plans wave-ordered, agents chronological.
//
// pi widgets are render-only, so the widget is controlled by the `/plan` slash command:
// toggle expand<->collapse, hide/show, and filter what's shown. Collapsed is a one-line
// summary with a grey hint; expanded is the wave-ordered tree.

import type { ExtensionAPI, ExtensionContext, UIContext, AutocompleteItem } from "./pi.js"
import { parseSnapshot, type PlanSnapshot } from "./wire.js"
import { buildView, type PlanRow } from "./model.js"
import { renderExpanded, summaryLine } from "./render.js"
import { readSettings, ensureSettingsFile, type WidgetState } from "./settings.js"

const WIDGET_KEY = "plan"
const CUSTOM_TYPE = "plan-item"

const VERBS = ["toggle", "expand", "collapse", "hide", "show", "filter done", "filter context"]

export default function planSidebar(pi: ExtensionAPI): void {
    const sources = new Map<string, PlanSnapshot>()
    let uiCtx: UIContext | undefined

    // Initial widget control state comes from settings (extensions/pi-plan.json); /plan
    // mutates it for the session.
    const settings = readSettings()
    const placement = settings.placement
    let mode: WidgetState = settings.defaultState
    let showDone = settings.showDone
    let showContext = settings.showContext

    const filterPlans = (rows: PlanRow[]): PlanRow[] =>
        rows.filter(r => (showDone || r.item.status !== "done") && (showContext || r.item.kind === "plan"))

    const render = (): void => {
        if (!uiCtx) return
        if (mode === "hidden") {
            uiCtx.setWidget(WIDGET_KEY, undefined)
            return
        }
        const view = buildView(sources)
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

    // Render on RECEIPT OF THE PLAN FROM CRIB (shared in-process bus).
    pi.events.on(CUSTOM_TYPE, (data: unknown) => {
        const snapshot = parseSnapshot(data)
        if (!snapshot) return
        const prev = sources.get(snapshot.source)
        if (prev && prev.seq > snapshot.seq) return
        sources.set(snapshot.source, snapshot)
        render()
    })

    // Gated on the fleet: repaint when the subagent fleet changes.
    for (const channel of [
        "subagents:created",
        "subagents:started",
        "subagents:completed",
        "subagents:failed",
        "subagents:steered",
        "subagents:compacted",
    ]) {
        pi.events.on(channel, () => render())
    }

    // /plan — control the render-only widget.
    pi.registerCommand("plan", {
        description: "Plan sidebar: toggle | expand | collapse | hide | show | filter done|context",
        handler: (args, ctx) => {
            captureUi(ctx)
            const a = args.trim().toLowerCase()
            if (a === "" || a === "toggle") mode = mode === "expanded" ? "collapsed" : "expanded"
            else if (a === "expand" || a === "show") mode = "expanded"
            else if (a === "collapse") mode = "collapsed"
            else if (a === "hide") mode = "hidden"
            else if (a === "filter done") showDone = !showDone
            else if (a === "filter context") showContext = !showContext
            else if (a.startsWith("filter")) {
                ctx.ui?.notify?.(`plan filters — done=${showDone}, context=${showContext}`, "info")
                return
            }
            render()
        },
        getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
            const p = prefix.trim()
            const matches = VERBS.filter(v => v.startsWith(p))
            return matches.length ? matches.map(v => ({ value: v, label: v })) : null
        },
    })
}
