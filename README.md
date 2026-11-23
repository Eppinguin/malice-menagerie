# Malice Menagerie

A Director-first Draw Steel encounter builder and runner, inspired by FreshCutGrass.

**Live app:** [malice-menagerie.pages.dev](https://malice-menagerie.pages.dev)

No account, no backend — encounters are saved locally in your browser, and monster statblocks, Malice features, and conditions load live from [SteelCompendium](https://github.com/SteelCompendium/data-unified).

## Features

- **Prep & Run views:** Build encounters by dragging monsters into activation groups, balance against your party's EV, then switch to a horizontal kanban board with one always-visible statblock column per monster type.
- **Fast Stamina & turn tracking:** Track individual copies above each statblock, rename creatures inline, enter Stamina as absolute (`20`) or relative (`-12`, `+5`), and mark activations with one click. Advancing the round resets activations and calculates Malice gain automatically.
- **Minions & captains:** Squads share a Stamina pool, show standing minion counts, support adding/removing minions by set or individually (hold `−`/`+` or Shift), attach a creature as captain (applying _With Captain_ benefits and Stamina bonuses), and calculate multi-minion signature damage.
- **Malice features:** Automatically filters Basic and level-eligible family Malice features for the encounter, suggests a balanced 3–4 feature set, and tracks active effects and round expirations.
- **Inline power rolls & conditions:** Click any ability, characteristic, or Malice power roll to roll with edges/banes and highlight the resolved tier in place. Conditions use the SteelCompendium catalog with hover descriptions.
- **Negotiations:** Run Draw Steel social encounters on one screen with Interest (0–5) and Patience (0–5) tracks, all twelve Heroes book archetypes plus one-tap improvised NPCs, motivations and pitfalls, player-first argument resolution (including lies, repeats, Natural 19–20s, and Read the NPC), undoable history, and an inline rules reference.

## Owlbear Rodeo integration

An optional companion extension connects your encounter directly to an Owlbear Rodeo room — no account or server needed. Malice works identically without it.

**Install:**

1. In Owlbear Rodeo, open **Extensions → Add Custom Extension** and paste:
   `https://malice-menagerie.pages.dev/obr/manifest.json`
2. Enable **Malice Menagerie** in your room.
3. Connect from Malice (**Settings → Integrations → Owlbear Rodeo**) or from the extension popover in Owlbear.

**What it does:**

- **Encounter & token sync:** Send a whole encounter or individual combatants to free grid cells (visible or hidden for ambushes), scaled to their Draw Steel monster size. Re-sending is additive and never deletes tokens without asking; defeated or unlinked tokens can be cleaned up from the card or Settings.
- **Token artwork:** Uses readable monster initials by default, with an opt-in toggle in the extension popover for TooManyTokens artwork (custom GM token art is always preserved).
- **Two-way Stamina sync:** Current Stamina and creature maximums stay in sync in both directions, including shared minion squad pools and captain detachment when a captain falls.
- **Map controls:** Hide/reveal tokens (with attached overlays), select, or pan to a creature or squad from its combat card, optionally follow Owlbear token selection back in Malice, and nickname scenes.
- **Compatible OBR extensions:**
  - **Draw Steel Tools:** Automatically links monster statblocks and minion groups (with a searchable picker for ambiguous matches).
  - **Token Labels / Marked!:** Two-way sync for the nine Draw Steel conditions on creatures (per-minion conditions stay on the map).
  - **Rings Initiative** (opt-in): Two-way sync for activation groups, turns, and rounds.
  - **Connected Dice** (opt-in): Rolls Malice ability, characteristic, and Malice power rolls directly in Owlbear (public or GM-only).

## Development & self-hosting

Built with Preact, TypeScript, `@preact/signals`, and Vite 8. Everything compiles to static files in `dist/` (the app at `/` and the Owlbear extension at `/obr/`, with `public/_headers` enabling CORS for `/obr/*`), so you can self-host the whole stack on any static host (e.g. Cloudflare Pages). When hosted over HTTPS, both the app and extension automatically pair with their own origin.

Requires [Bun](https://bun.sh) or pnpm:

```bash
pnpm install
pnpm dev            # app dev server
pnpm dev:obr        # OBR extension dev server (/obr/)
pnpm build          # build app (dist/) + OBR extension (dist/obr/)
pnpm preview        # preview combined production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # oxlint
pnpm fmt:check      # oxfmt --check
pnpm test           # Vitest unit tests
pnpm check          # full typecheck, lint, format, test, and build check
```

For testing the Owlbear bridge locally or running the live-room checklist, see [`obr/HARNESS.md`](obr/HARNESS.md) and [`obr/MANUAL-ACCEPTANCE.md`](obr/MANUAL-ACCEPTANCE.md).
