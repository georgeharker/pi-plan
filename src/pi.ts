// Narrow, local typing for the slice of pi's ExtensionAPI pi-plan uses. pi ships its
// ExtensionAPI types with the harness rather than as a package we can depend on, so we
// mirror only the surface we touch. Verified against @earendil-works/pi-coding-agent
// (dist/core/extensions/loader.js + runner.js + agent-session.js).

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork"
export type SessionStartEvent = { reason: SessionStartReason; previousSessionFile?: string }
export type SessionShutdownEvent = { reason: string; targetSessionFile?: string }

/** A custom session entry, as built by sessionManager.appendCustomEntry(customType, data). */
export type CustomEntry = {
    type?: string
    customType?: string
    data?: unknown
    id?: string
}
export type EntryAppendedEvent = { entry: CustomEntry }
export type TurnEndEvent = Record<string, never>

/** Themed rendering primitives handed to a widget callback. */
export interface Theme {
    fg(color: string, text: string): string
    bold(text: string): string
}
/** Minimal TUI handle passed to the widget factory. */
export interface TuiApi {
    width?: number
    requestRender?(): void
}
/** A widget component: `render(width)` returns the text to draw. pi's layout calls this
 *  with the available column width (Container.render(width) → child.render(width)); every
 *  returned line MUST fit within it or the TUI aborts doRender. `invalidate` is called on
 *  theme change so the factory can re-capture. */
export interface WidgetComponent {
    render(width?: number): string[]
    invalidate?(): void
}
/** The widget factory registered via setWidget — returns a component, NOT a raw string. */
export type WidgetFactory = (tui: TuiApi, theme: Theme) => WidgetComponent

/** The UI surface (present only in a TUI session). Captured from a hook's ctx. */
export interface UIContext {
    setWidget(
        key: string,
        factory: WidgetFactory | undefined,
        options?: { placement?: "aboveEditor" | "belowEditor" | string },
    ): void
    setStatus(key: string, text: string | undefined): void
    setFooter(render: ((tui: TuiApi, theme: Theme, footerData?: unknown) => string) | undefined): void
    notify?(message: string, level?: "info" | "warn" | "error"): void
}

export interface ExtensionContext {
    cwd: string
    mode: "tui" | "rpc" | "json" | "print"
    hasUI: boolean
    signal?: AbortSignal
    ui?: UIContext
}

export type AutocompleteItem = { value: string; label?: string }
export type CommandSpec = {
    description: string
    handler: (args: string, ctx: ExtensionContext) => void | Promise<void>
    getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null
}

type BusHandler = (data: unknown) => void

export interface ExtensionAPI {
    on(event: "session_start", handler: (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>): void
    on(
        event: "session_shutdown",
        handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>,
    ): void
    on(
        event: "entry_appended",
        handler: (event: EntryAppendedEvent, ctx: ExtensionContext) => void | Promise<void>,
    ): void
    on(event: "turn_end", handler: (event: TurnEndEvent, ctx: ExtensionContext) => void | Promise<void>): void
    /** In-process pub/sub bus (subagents:* etc.). Handler gets only data, no ctx. */
    events: { on(channel: string, handler: BusHandler): () => void; emit(channel: string, data?: unknown): void }
    /** Persist a custom session entry; emits `entry_appended` (also forwarded over RPC). */
    appendEntry(customType: string, data?: unknown): string
    /** Register a slash command (e.g. `/plan`). */
    registerCommand(name: string, spec: CommandSpec): void
}
