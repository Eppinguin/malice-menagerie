---
version: 1
slug: "src-components-app-tsx"
primary_target: "src/components/App.tsx"
related_targets: ["src/styles.css"]
---

# Surface brief: Malice Menagerie app (Prep + Run)

Scope: whole app shell, Prep view, Run view, drawers/menus. Visitor mode: Operate.
Audience: Draw Steel Directors at the table (laptop, tablet touch, VTT-side monitor), mid-combat, often dim light.
Task: build and balance an encounter; run it with Malice, rounds, stamina, conditions, rolls.
Constraints: every function, state, and copy preserved; light page default with a night page variant for dim rooms.

## Direction contract

THESIS: The app is the Monsters book lying open on the Director's table: printed statblocks set exactly in the Monsters book's grammar (grey header panels, slab-serif names, glyph icons), and the Director's live marks (stamina, ticks, rolls) written on top in blue ballpoint and yellow highlighter. Refuses the dark SaaS dashboard of boxed cards and a single neon accent.

OWN-WORLD: User-pinned book fidelity (from the user's Ajax page scans): white stock, black ink, grey gradient header panels, thin rules with a centred V-notch, bold slab-serif (Bitter) for names, labels and rules text in normal case; Poppins ExtraBold capitals only where the book uses its black page tab (running head, nav, buttons, small labels). MCDM's Draw Steel Glyphs (CC BY-SA 4.0) for tier badges, ability icons, distance/target marks, characteristic blocks and potency blocks. App layer on top: ballpoint blue for everything the Director writes, one yellow highlighter swipe for the rolled tier, crimson reserved for Malice. Flat black spine with the active tab cut from page stock. Night page: same roles on charcoal stock.

STORY: The Director recognises a Draw Steel statblock instantly, finds the round and Malice pool at a glance in the running head, marks acted creatures and stamina in "their pen", and sees the rolled tier highlighted as if marked by hand.

FIRST VIEWPORT: Run view. Left: cloth spine (wordmark, Prep/Run ribbons, encounters). Top: running head with "ROUND 3" in tab capitals left; right, a crimson Malice cartouche with -/+ and "+N next", the acted tally, and a solid ink "Next round" button; a double rule beneath. Below: collapsible Encounter Malice strip, then statblock columns side by side separated by vertical rules, each opening with the book's grey header panel.

FORM: The Bestiary Page, position 1 on my ordered list (my pick, chosen by the user over the roll). Seed key a1742ee7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
