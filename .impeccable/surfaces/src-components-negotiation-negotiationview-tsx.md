---
version: 2
slug: "src-components-negotiation-negotiationview-tsx"
primary_target: "src/components/negotiation/NegotiationView.tsx"
related_targets:
  [
    "src/styles.css",
    "src/lib/negotiation.ts",
    "src/store.ts",
    "src/components/App.tsx",
    "src/components/negotiation/NegotiationSwitcher.tsx",
    "src/components/negotiation/NegotiationCreate.tsx",
    "src/components/negotiation/NegotiationTracks.tsx",
    "src/components/negotiation/TraitLists.tsx",
    "src/components/negotiation/ResolverPanel.tsx",
    "src/components/negotiation/NegotiationLog.tsx",
    "src/components/negotiation/NegotiationRules.tsx",
  ]
---

# Surface brief: Malice Menagerie — Negotiation (`Negotiate`)

Scope: the whole negotiation view, its spine library, Quick Create, and the live cockpit. Visitor mode: Operate.
Audience: Draw Steel Directors at the table, mid-session, often dim light, laptop, tablet touch, or beside a VTT.
Task: spin up an NPC in ≤5 seconds (1-tap quick improv, grouped archetype, or 12-trait deck) and run a negotiation live — hold Interest and Patience, tap a trait to stage an argument, apply the player's tier in one tap (or optionally roll in-app), and remember what was offered.
Constraints: the visual world is fixed (DESIGN.md's Bestiary Page); every number and outcome comes from MCDM's Draw Steel Heroes negotiation rules; no backend, localStorage only.

## Direction contract

THESIS: the negotiation page is the Heroes book's negotiation spread, distilled into a one-screen live cockpit built for mid-session improvisation. One-time setup collapses out of the way once play begins; Interest (5–0 response ladder, active rung circled by hand) and Patience (five ink boxes + dashed `0`) anchor the left column; tap-to-stage Motivations and Pitfalls sit directly above a player-first Argument / Read resolver on the right.

OWN-WORLD: the incumbent Bestiary Page, unchanged — white stock, black ink, flat grey panels with a rule and V-notch, bold Bitter for headings/controls, Poppins for 10.5px tab labels, ballpoint blue for everything the Director writes or marks, crimson untouched (it means Malice).

STORY: mid-session, the Director clicks `Negotiate` (or `+ New NPC` in the topbar), taps a Quick Improv Impression band (or a grouped archetype with Moves/Avoid previews, or `Blank NPC` with the shared 12-trait deck), lands straight in the one-screen cockpit, taps the trait a hero appealed to or stumbled into, and taps the tier the player rolled on physical/VTT dice (or rolls via the compact optional `Roll 2d10` bar). Interest, Patience, spent motivations, and auto-revealed pitfalls update in place, with single-tap Undo on everything.

FIRST VIEWPORT: the running head "Negotiation" with the NPC's live state and `+ New NPC` beside it. Below it the compact grey sheet head (NPC name in pen, inline "What the heroes want", `Edit setup` toggle over the one-line summary). Below it two columns fitting cleanly above the fold on laptop: Interest 5–0 + Patience 5–0 on the left; Motivations & Pitfalls (tap to stage, inline notes, Shuffle, shared 12-chip Edit deck) stacked above the two-tab Resolver (`An argument` | `Read the NPC`, always-clickable tier rows, optional memo, compact `Or roll here` bar) on the right. Below the cockpit sit `What's been said` and `<details>The rules</details>` closed by default.

FORM: the negotiation spread of the book the rest of the app is already made of — one-screen live cockpit with collapsible setup and always-reachable Quick Create.

## Decisions taken with the user

- Named `Negotiate` in the sidebar (`Prep` · `Run` · `Negotiate`) and `Negotiation` as the page heading (preserving internal `view: "talk"` for saved-state compatibility).
- Always-reachable Quick Create via topbar `+ New NPC`, spine `+ New`, and collapsed rail: 1-tap Quick Improv across 3 Impression bands, 12 archetypes grouped with trait previews, and top-level `Blank NPC`.
- Player-rolled first: all three tier rows are always 1-tap clickable (supporting physical dice, VTT dice, and free Tier 3 roleplay), with a compact optional `Roll 2d10` helper below.
- One-screen 2-column live cockpit: setup starts collapsed on Quick Improv and archetypes; tapping a trait stages it directly; `Read the NPC` folds into a WAI-ARIA tab inside the Resolver; no separate "Accept offer" UI since the current rung already is the state.
- Non-blocking recovery everywhere: `Take it back` for arguments/reads (including pitfall auto-reveal restore) and Undo toasts for trait edits, shuffles, resets, attitude restarts, archetype swaps, and NPC deletion.
