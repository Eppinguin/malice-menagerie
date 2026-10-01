# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Draw Steel Directors (the game's GM role), shared publicly with the Draw Steel community. They build an encounter before the session (Prep) and run it live at the table (Run). All three table scenes are real and equally supported: a laptop behind a screen at an in-person table, a tablet laid flat or propped up (touch primary), and a second monitor beside a VTT for online play.

## Product Purpose

Malice Menagerie is a Director-first encounter builder and combat board for MCDM's Draw Steel. It lets a Director assemble an encounter from every official monster statblock, balance it against the party (EV vs. encounter strength), then run it: track Malice, rounds, activation groups, per-creature Stamina, minion squads, conditions, and roll power rolls with edges/banes in place. Success is a Director who never has to open the Monsters book or a spreadsheet during combat.

## Positioning

Glanceable, always-visible statblock columns (one per monster type) with live tracking layered directly on the statblock, and Malice features pulled and filtered automatically from the encounter's families and levels. Data comes live from SteelCompendium, so it covers every official monster without a curated manifest.

## Operating Context

Used mid-session under time pressure, between player turns, often in dim room light or beside a VTT. Prep happens beforehand at a desk. Terminology is Draw Steel's own: Director, Malice, EV, encounter strength (ES), Victories, Stamina, Stability, Free Strike, characteristics (M/A/R/I/P), power roll tiers (≤11 / 12–16 / 17+), edges and banes, minions/squads, horde/elite/leader/solo organizations, conditions.

## Capabilities and Constraints

- Preact + TypeScript SPA (Vite), state in @preact/signals persisted to localStorage; no backend.
- Monster, Malice, and condition data fetched live from SteelCompendium (steelcompendium.io).
- Two views: Prep (party parameters, monster library with filters/sort/search, encounter groups with drag & drop, difficulty meter) and Run (round counter, Malice counter and dock, acted tally, statblock columns with trackers, conditions, dice rolling).
- Multiple saved encounters in a sidebar.

## Brand Commitments

- Unofficial fan tool published for the Draw Steel community; it should feel at home next to MCDM's Draw Steel material without impersonating MCDM or using its trade dress/logos.
- The user explicitly released all prior identity (logo, dark theme, colors) for redesign.

## Evidence on Hand

- Wordmark and emblem SVGs in `public/` (replaceable).
- No testimonials, user counts, or endorsements exist; none may be invented.

## Product Principles

1. The table comes first: anything needed mid-combat is visible or one tap away.
2. Draw Steel's own vocabulary and rules shapes are the interface; never genericize them.
3. Source truth over curation: render what SteelCompendium says, faithfully.
4. Works equally on laptop, tablet touch, and a VTT-side monitor.
