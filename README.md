# Malice Menagerie

Director-first Draw Steel encounter board inspired by the glanceable encounter model of FreshCutGrass.

## Data source

The app contains no hardcoded monster statblocks and no curated monster manifest.

At startup it reads the recursive tree of:

`SteelCompendium/data-unified` → `main` → `en/unified/json/monster/**`

Every matching English unified statblock at `en/unified/json/monster/**/statblock/*.json` is discovered automatically. The JSON records are fetched directly from the SteelCompendium repository and normalized only for display. New statblocks added to the unified dataset become available without changing this app.

Malice data is discovered from the same unified English JSON tree. This includes family records such as `en/unified/json/monster/goblin/goblin-malice.json` and the generic Basic Malice rule at `en/unified/json/rule/monster/malice.json`. Family features are filtered against the monster families and levels currently in the encounter; Basic Malice is always available. Level-gated family blocks only unlock when an eligible monster is present. “Prior Malice Features” gateway entries are flattened into the lower-level features they grant access to, avoiding duplicate meta-cards. Malice feature text and power-roll tiers are rendered directly from those source records.

Predefined conditions are also discovered from `en/unified/json/condition/*.json`, so the condition picker follows the SteelCompendium condition catalog instead of a hardcoded app list.

## Current interaction model

- Party data exists only for encounter balancing and automatic Malice gain.
- Add the same monster type to multiple activation groups.
- Click a group card in the Encounter panel to make it the active add target. Drag monsters from the library into groups, drag encounter entries between groups, drag entries back to the library to remove them, or drop onto the New group target that appears while dragging.
- Run view is a horizontal kanban board with one always-visible statblock column per monster type.
- Individual copies remain tracked above the shared statblock.
- Rename creature instances inline.
- Current Stamina is one text field:
  - `20` sets current Stamina to 20.
  - `-20` subtracts 20.
  - `+5` adds 5.
- Mark each activation with one click; Next Round resets all activation marks.
- Minions are represented as squad trackers with pooled Stamina and automatic remaining-count display.
- Malice features are sourced from SteelCompendium and filtered to the Basic and level-eligible family options relevant to the encounter. A balanced 3–4 feature set is suggested automatically, while every other eligible feature remains available in a compact library. Features can be added or removed from the encounter set without restriction. Selected features open expanded by default and show full rules text, tier results, and inline roll controls. Split source records such as Iron Jaws are normalized into one complete feature card.
- Conditions use a compact predefined picker populated from SteelCompendium unified condition files; condition descriptions are available on hover.
- Power-roll bonuses resolve numeric modifiers, named characteristics, and expressions such as `Power Roll + highest characteristic` from the active monster statblock.
- Any power roll highlights the resolved tier row in place.

## Stack

The app is a Preact + TypeScript single-page app built with Vite 8 (Rolldown/oxc). State is held in `@preact/signals` and persisted to `localStorage`. There is no backend — SteelCompendium is fetched live from GitHub at runtime, so the app needs network access.

Source layout:

- `src/lib/` — pure helpers (text, repo/fetch, rules, malice parsing), no DOM.
- `src/data.ts` — source-index loading, hydration, and derived catalog signals.
- `src/store.ts` — persisted `AppState`, sanitizer, and all mutations/actions.
- `src/dnd.ts` — pointer-based drag & drop for the Prep view.
- `src/components/` — Preact views (builder, combat, shared statblock/preview).

## Running

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev        # start the dev server
bun run build      # production build to dist/
bun run preview    # serve the production build
bun run typecheck  # tsc --noEmit
```
