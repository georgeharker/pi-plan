# @geohar/pi-plan

A plan sidebar for the [pi coding agent](https://pi.dev). It renders your
[cribsheet](https://github.com/georgeharker/cribsheet) plan **and** the live subagent
fleet as a persistent TUI widget, wave-ordered by dependency so the work you can pick up
**now** is up top.

## What it does

`pi-plan` accumulates plan events off pi's in-process bus and renders them, alongside the
live subagent fleet it reads directly:

- **Wave ordering** — each item's *wave* is the longest chain of unsatisfied deps above
  it, so wave 0 is everything that's free to start now; each wave is a set that can be
  worked in parallel. Blocked items show a dim `⋯N` (N unsatisfied deps).
- **Dep-aware** — a dep is satisfied by kind: a note never blocks, a design decision
  blocks only while tainted, a plan item blocks until done (mirrors cribsheet semantics).
- **Actionable first** — plan items you can start are highlighted; design/note context is
  dimmed and trails; done items sink to the bottom.
- **Live subagents** — the running subagent fleet is read straight off the `subagents:*`
  bus and shown as a separate **Agents** group (toggle with `/plan agents`).

The crib plan is emitted by the companion source in
[`@geohar/pi-cribsheet`](https://github.com/georgeharker/cribsheet), but `pi-plan` is a
**generic** consumer — any source can drive it by publishing the [plan bus
protocol](#plan-bus-protocol) below, with no coupling to cribsheet.

## Plan bus protocol

`pi-plan` listens on two `pi.events` channels, **split by operation**. A source publishes
a full snapshot to replace its slice, or part-by-part updates to patch it. State is kept
per source namespace (`ns`), so multiple sources coexist in one view.

### Channels

**`plan:snapshot`** — replace *all* items for a namespace:

```jsonc
{ "ns": "cribsheet", "seq": 7, "items": [ /* PlanItem[] */ ] }
```

**`plan:update`** — patch a namespace part-by-part:

```jsonc
{ "ns": "mytool", "seq": 8, "upsert": [ /* PlanItem[] */ ], "remove": ["id-1", "id-2"] }
```

### PlanItem

Rich fields are optional — a simple source can emit just `id` + `title`:

```ts
{
    id: string        // stable, unique within the ns
    title: string     // display text
    status?: string   // "done" sinks to the bottom; "in-progress"/"active" is highlighted
    deps?: string[]   // ids (same ns) this item depends on; omit for a flat list
    kind?: string     // "plan" | "design" | "note"  (default "plan")
    tainted?: boolean // design-kind only: blocks its dependents while true
}
```

### Semantics

- **`ns`** attributes the source; `pi-plan` accumulates a per-`ns` map. `snapshot`
  replaces the whole map for that `ns`; `update` upserts items by `id` and deletes the
  `remove` ids.
- **`seq`** (optional, monotonic per `ns`) drops out-of-order deliveries.
- **Dep satisfaction is kind-aware**: a `note` never blocks; a `design` blocks only while
  `tainted`; a `plan` blocks until its `status` is done.
- **Wave** = the longest chain of unsatisfied deps above an item; wave 0 is actionable now.
- Pick the channel that fits: a source that has the whole list emits `plan:snapshot`; a
  source that produces items piecemeal emits `plan:update`.

Minimal emit (any pi extension, in-process):

```ts
pi.events.emit("plan:snapshot", {
    ns: "mytool",
    items: [{ id: "a", title: "do a thing", status: "todo" }],
})
```

> The same protocol is bridged to ACP by
> [`@geohar/pi-acp`](https://github.com/georgeharker/pi-acp) (it re-emits these events over
> RPC and maps them to an ACP `plan`), so a source that speaks it surfaces in both the pi
> TUI and ACP clients.

## Install

```sh
pi install npm:@geohar/pi-plan
```

Run pi from a repo whose cribsheet project has plan items; the widget primes on session
start and repaints when you edit the plan or the subagent fleet changes.

## Control it with `/plan`

pi widgets are render-only, so the widget is driven by a slash command:

| command | effect |
|---|---|
| `/plan` | toggle expanded ⇄ collapsed |
| `/plan expand` / `/plan collapse` / `/plan hide` / `/plan show` | set state |
| `/plan agents` | toggle the subagent group |
| `/plan show agents` / `/plan hide agents` | set the subagent group |
| `/plan filter done` | include/exclude done items |
| `/plan filter context` | include/exclude design/note context |

Collapsed is a one-line summary (`▸ Plan  N ready · M blocked · K agents   /plan to
expand`); expanded is the wave-ordered tree followed by the **Agents** group.

## Settings

`pi-plan` reads `<PI_CODING_AGENT_DIR>/extensions/pi-plan.json` (defaults are written on
first run):

```jsonc
{
  "placement": "aboveEditor",   // aboveEditor | belowEditor
  "defaultState": "expanded",   // expanded | collapsed | hidden
  "showDone": false,            // include done items by default
  "showContext": false,         // include design/note context by default
  "showAgents": true            // show the live subagent group by default
}
```

`/plan` overrides these for the session; the file sets the defaults.

## Development

```sh
npm install
npm run build     # tsc → dist/
npm test          # tsc && node --test
```

The extension entry is `./src/index.ts` (declared in `package.json` `pi.extensions`),
loaded directly from source via jiti — no build step is needed for local loading. Point
a local checkout at pi with a **bare path** in `settings.json` `packages[]` (there is no
`local:` scheme): `"/abs/path/to/pi-plan"`.

## License

MIT © George Harker
