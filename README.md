# @geohar/pi-plan

A plan sidebar for the [pi coding agent](https://pi.dev). It renders your
[cribsheet](https://github.com/georgeharker/cribsheet) plan — and (soon) the live
subagent fleet — as a persistent TUI widget, wave-ordered by dependency so the
work you can pick up **now** is up top.

## What it does

`pi-plan` consumes `plan-item` snapshots off pi's in-process event bus and renders them:

- **Wave ordering** — each item's *wave* is the longest chain of unsatisfied deps above
  it, so wave 0 is everything that's free to start now; each wave is a set that can be
  worked in parallel. Blocked items show a dim `⋯N` (N unsatisfied deps).
- **Dep-aware** — a dep is satisfied by kind: a note never blocks, a design decision
  blocks only while tainted, a plan item blocks until done (mirrors cribsheet semantics).
- **Actionable first** — plan items you can start are highlighted; design/note context is
  dimmed and trails; done items sink to the bottom.

The crib plan is emitted by the companion source in
[`@geohar/pi-cribsheet`](https://github.com/georgeharker/cribsheet); `pi-plan` is a pure
consumer, so it needs no direct coupling to cribsheet beyond the shared `plan-item` bus
event.

## Install

```sh
pi install npm:@geohar/pi-plan
```

Run pi from a repo whose cribsheet project has plan items; the widget primes on session
start and repaints when you edit the plan.

## Control it with `/plan`

pi widgets are render-only, so the widget is driven by a slash command:

| command | effect |
|---|---|
| `/plan` | toggle expanded ⇄ collapsed |
| `/plan expand` / `/plan collapse` / `/plan hide` / `/plan show` | set state |
| `/plan filter done` | include/exclude done items |
| `/plan filter context` | include/exclude design/note context |

Collapsed is a one-line summary (`▸ Plan  N ready · M blocked   /plan to expand`);
expanded is the wave-ordered tree.

## Settings

`pi-plan` reads `<PI_CODING_AGENT_DIR>/extensions/pi-plan.json` (defaults are written on
first run):

```jsonc
{
  "placement": "aboveEditor",   // aboveEditor | belowEditor
  "defaultState": "expanded",   // expanded | collapsed | hidden
  "showDone": false,            // include done items by default
  "showContext": false          // include design/note context by default
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
