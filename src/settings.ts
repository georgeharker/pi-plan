// pi-plan's own settings — NOT merged into pi's settings.json. The file lives in pi's
// `extensions/` dir (via getAgentDir(), which honors a relocated PI_CODING_AGENT_DIR),
// alongside other extensions' settings, so it travels with a moved config dir. Matches the
// harness + pi-acp accessor exactly.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type WidgetPlacement = "aboveEditor" | "belowEditor"
export type WidgetState = "expanded" | "collapsed" | "hidden"

export interface PiPlanSettings {
    /** Which editor-relative slot the widget occupies. */
    placement: WidgetPlacement
    /** Initial widget state on session start. */
    defaultState: WidgetState
    /** Include done items by default (else hidden until `/plan filter done`). */
    showDone: boolean
    /** Include design/note context by default (else plan work only). */
    showContext: boolean
    /** Show the subagent fleet alongside the plan. */
    showAgents: boolean
}

const DEFAULTS: PiPlanSettings = {
    placement: "aboveEditor",
    defaultState: "expanded",
    showDone: false,
    showContext: false,
    showAgents: true,
}

/** pi's agent config dir, honoring a relocated dir via PI_CODING_AGENT_DIR
 *  (identical to the harness accessor: `PI_CODING_AGENT_DIR ?? ~/.pi/agent`). */
export function getAgentDir(): string {
    return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent")
}

/** pi-plan's settings file, in pi's extensions/ dir so it follows a relocated config dir. */
export function getSettingsPath(): string {
    return join(getAgentDir(), "extensions", "pi-plan.json")
}

function isObject(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === "object" && !Array.isArray(x)
}

/** Read settings, falling back to defaults for a missing/invalid file or absent keys. */
export function readSettings(path: string = getSettingsPath()): PiPlanSettings {
    try {
        if (!existsSync(path)) return { ...DEFAULTS }
        const data: unknown = JSON.parse(readFileSync(path, "utf-8"))
        if (!isObject(data)) return { ...DEFAULTS }
        return {
            placement: data.placement === "belowEditor" ? "belowEditor" : "aboveEditor",
            defaultState:
                data.defaultState === "collapsed" || data.defaultState === "hidden" ? data.defaultState : "expanded",
            showDone: typeof data.showDone === "boolean" ? data.showDone : DEFAULTS.showDone,
            showContext: typeof data.showContext === "boolean" ? data.showContext : DEFAULTS.showContext,
            showAgents: typeof data.showAgents === "boolean" ? data.showAgents : DEFAULTS.showAgents,
        }
    } catch {
        return { ...DEFAULTS }
    }
}

/** Write the default settings file if none exists, so the options are discoverable. Best effort. */
export function ensureSettingsFile(path: string = getSettingsPath()): void {
    try {
        if (existsSync(path)) return
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(DEFAULTS, null, 2)}\n`, "utf-8")
    } catch {
        /* best effort */
    }
}
