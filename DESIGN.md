---
name: Malice Menagerie
description: The Draw Steel Monsters book open on the Director's table, with the Director's own marks written on top.
colors:
  white-stock: "#fbfbfa"
  sheet: "#ffffff"
  panel-grey: "#efefed"
  field: "#ffffff"
  ink: "#141414"
  ink-secondary: "#3b3b39"
  ink-tertiary: "#62625e"
  ink-hover: "#3a3a38"
  hairline-rule: "#c9c9c5"
  strong-rule: "#85857f"
  tab-black: "#141414"
  on-tab: "#f7f7f5"
  ballpoint-pen: "#1d4ea8"
  pen-wash: "rgba(29, 78, 168, 0.1)"
  pen-line: "rgba(29, 78, 168, 0.42)"
  highlighter: "#f4dc4f"
  on-highlighter: "#141414"
  malice-crimson: "#a8231f"
  malice-ink: "#8e1c19"
  on-malice: "#fbf2ec"
  down-ink: "#1b1814"
  diff-trivial: "#716859"
  diff-easy: "#3f6a4a"
  diff-standard: "#56642a"
  diff-hard: "#94600f"
  diff-extreme: "#1b1814"
  tincture-ochre: "#8a5a14"
  tincture-vert: "#2f6b3f"
  tincture-purpure: "#6d3f8c"
  tincture-teal: "#1e6a78"
  tincture-sanguine: "#8c4a2f"
  tincture-slate: "#4f5a6b"
  spine-black: "#141414"
  spine-raised: "#262626"
  spine-line: "#3a3a3a"
  on-spine: "#f7f7f5"
  on-spine-dim: "#a8a8a4"
  brand-horn: "#e2584d"
  brand-eye: "#f4dc4f"
typography:
  running-head:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "clamp(30px, 3vw, 40px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.015em"
  section:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
  headline:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0"
  title:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  numeral:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum, lnum"
  stat-value:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum, lnum"
  stat-label:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
  pen-hand:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  rules-line:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  button:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
  control:
    fontFamily: "Bitter Variable, Bitter, Georgia, serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
  tab-label:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
  wordmark:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.03em"
  wordmark-sub:
    fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.39em"
  glyph:
    fontFamily: "Draw Steel Glyphs"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0"
rounded:
  hairline: "1px"
  print: "2px"
  plate: "3px"
  panel: "6px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  gutter: "36px"
components:
  button-primary:
    backgroundColor: "{colors.tab-black}"
    textColor: "{colors.on-tab}"
    typography: "{typography.button}"
    rounded: "{rounded.print}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.on-tab}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.print}"
    padding: "10px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-grey}"
  button-secondary-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white-stock}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.print}"
    padding: "7px 12px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white-stock}"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.tab-label}"
    rounded: "{rounded.print}"
    padding: "2px 6px 1px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.print}"
    padding: "9px 11px"
  statblock-panel:
    backgroundColor: "{colors.panel-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.panel}"
    padding: "9px 12px"
  encounter-box:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
  malice-counter:
    backgroundColor: "transparent"
    textColor: "{colors.malice-ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.print}"
    padding: "4px 12px 4px 14px"
    height: "50px"
  malice-step:
    backgroundColor: "transparent"
    textColor: "{colors.malice-ink}"
    rounded: "{rounded.print}"
    size: "32px"
  malice-step-hover:
    backgroundColor: "{colors.malice-crimson}"
    textColor: "{colors.on-malice}"
  roll-button:
    backgroundColor: "transparent"
    textColor: "{colors.ballpoint-pen}"
    typography: "{typography.control}"
    rounded: "{rounded.print}"
    padding: "4px 11px 3px"
  roll-button-hover:
    backgroundColor: "{colors.ballpoint-pen}"
    textColor: "{colors.field}"
  tier-badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.glyph}"
    width: "40px"
  tier-badge-rolled:
    textColor: "{colors.ballpoint-pen}"
  rolled-tier:
    textColor: "{colors.ink}"
    borderColor: "{colors.ballpoint-pen}"
    borderWidth: "1.35px"
  condition-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ballpoint-pen}"
    borderColor: "{colors.ballpoint-pen}"
    borderWidth: "1.2px"
    padding: "3px 10px 2px 13px"
  spine-tab-active:
    backgroundColor: "{colors.white-stock}"
    textColor: "{colors.ink}"
    padding: "10px 14px 10px 10px"
  toast:
    backgroundColor: "{colors.tab-black}"
    textColor: "{colors.on-tab}"
    rounded: "{rounded.print}"
    padding: "11px 16px 10px"
---

# Design System: Malice Menagerie

## Overview

**Creative North Star: "The Bestiary Page"**

The app is the Draw Steel Monsters book lying open on the Director's table, set in the book's own statblock grammar. Everything printed is black ink on white stock. Each statblock opens with a flat grey header panel carrying the creature's name in a bold slab serif. Below it, a row of stats prints the number above its bold label, characteristics read as "Might +5" with a glyph block for the first letter, and abilities are laid out line by line as the book prints them. Draw Steel's own glyphs mark tiers, ability types, distance and target, and potency. The chrome uses the statblock's bold serif too, in normal case: "Round 1", "Next round", "Roll". Geometric capitals survive only on the wordmark, tags and the smallest labels, as the book keeps its sans for the page tab.

Everything the Director does is written on top of that print in a second hand, in ballpoint blue. Values the Director enters (names, Stamina, quantities) are typeset in blue Bitter, never a handwriting face, because they must read at a glance mid-combat. The marks they make are drawn by hand over the print: the rolled tier circled twice, the roll worked out as a sum with its answer ruled off twice, a turn ticked, a downed creature crossed through, a condition ringed and crossed off. Malice is crimson ink: an outlined counter in the running head, never a filled block. A flat black spine binds the page on the left, and the active tab is cut from the page stock.

Density is the density of a rulebook, not a dashboard. Structure comes from thin rules, V-notched dividers and a 3px double rule under the running head, not from floating cards. Statblocks sit side by side on the board as whole pages divided by vertical rules. Colour is law rather than decoration: each hue has one meaning. The same book also exists as a night page (charcoal stock, bone ink, the same roles), a user toggle persisted in `localStorage` that defaults to `prefers-color-scheme`. The world refuses the dark SaaS dashboard of boxed cards and a single neon accent.

**Key Characteristics:**
- Printed ink and the Director's pen are two separate layers, and the palette keeps them apart.
- Flat grey header panels with slab-serif names open every statblock and the Encounter box.
- One voice: bold Bitter sets the statblock and the chrome, in normal case. Poppins capitals are for the wordmark, tags and small labels only.
- Draw Steel Glyphs carry the book's own symbols.
- Thin rules with a centred V-notch carry structure. Boxes are the exception.
- Crimson appears only where Malice is, as ink and outline.
- Print is crisp and controls stay printed; game state is marked by hand on top.
- One motion: marks are drawn on left to right like a pen stroke.

## Colors

Neutral black ink on white stock, with flat grey header panels and two reserved inks laid over it: ballpoint blue and Malice crimson.

### Primary
- **Ink** (`ink`, also `tab-black`): statblock and body text, primary buttons, active chips, the Down cross, the double rule under the running head. On the night page ink becomes bone (#ece5d6), so the night primary button and toast invert to bone on charcoal.
- **Ink Secondary / Tertiary** (`ink-secondary`, `ink-tertiary`): keywords, legends and meta lines, then small labels, placeholders and disabled text.

### Secondary
- **Ballpoint Pen** (`ballpoint-pen`, with `pen-wash` and `pen-line`): everything the Director writes or rolls. Instance names, stamina values, the stamina fill and its handle, acted ticks and the acted strike-through, condition chips, roll buttons and results, the rolled tier badge and the loop around the rolled tier, quantity numbers, party inputs, the caret, focus outlines and focused input borders. Night #93b4f0.

### Tertiary
- **Highlighter** (`highlighter`, text `on-highlighter`): native text selection only. Night #e6c73e. Selected text is always dark ink on the yellow (night #1a1815), never the page ink, which is bone at night.
- **Malice Crimson** (`malice-crimson`, `malice-ink`, `on-malice`): the outlined Malice counter in the running head and its −/+ steps, the opened Encounter Malice panel's 2px top rule, the strip's heading and skull glyph, Malice costs, the outlined Malice use and spend buttons, and the Round 1 Malice figure in Prep. `malice-crimson` draws borders and hover fills (night #c83a30, lifted so outlines hold 3:1 on charcoal); `malice-ink` is the text form (night #ef7a6e); `on-malice` is text on a filled hover.

### Neutral
- **White Stock** (`white-stock`): the ground of every view, the colour of the active spine tab, and the fill of the V-notch. Night #1a1815.
- **Panel Grey** (`panel-grey`, CSS `--tint`): the flat header panel on statblocks and the Encounter box, and the hover wash on outlined controls. Night #27231e.
- **Sheet / Field** (`sheet`, `field`): instance cards and the Encounter box body; input wells.
- **Hairline Rule / Strong Rule** (`hairline-rule`, `strong-rule`): cell and card borders; statblock dividers and V-notches, lane dividers, outlined buttons, chip and tag borders, scrollbars.
- **Spine Black** (`spine-black`, `spine-raised`, `spine-line`, `on-spine`, `on-spine-dim`): the spine only, a flat black with no texture.
### Brand
- **Brand Horn / Brand Eye** (`brand-horn`, `brand-eye`; night horn #e8665a, eye #f2d85a): the horns and eyes of the horned M, on the spine and in the favicon only. Horn is a lifted crimson so it holds on spine black, where `malice-crimson` would sink.

### Group Tinctures
- **Ochre, Vert, Purpure, Teal, Sanguine, Slate** (`tincture-*`, CSS `--g0`..`--g5`): a small square swatch on activation-group selects, filters and headings. Night values are lifted (for example ochre #d9a653).

### Difficulty Ramp
- **Trivial, Easy, Standard, Hard, Extreme** (`diff-*`): the Monsters book's five bands, as the Prep difficulty word and the budget ruler fill. Extreme, the top band, is heavy ink with an underline. It is never red.

### Named Rules
**The Malice Is Crimson Rule.** Crimson (`--malice`) means Malice and nothing else. A crimson element that does not show, change or spend the Malice pool is wrong.

**The Crimson Ink Rule.** Malice is written in crimson ink and outline on the page: the counter, its steps and the use buttons are transparent with a 1px crimson border and crimson text, and fill solid crimson only on hover.

**The Horned Initial Rule.** The wordmark's horned M is the one place crimson and yellow appear outside their laws: the horns are the "Malice" in the name, the eyes glare from the notch. They stay on the mark (spine, collapsed rail, favicon) and never travel into the page as decoration.

**The Director's Pen Rule.** Anything the Director writes, marks or rolls is set in ballpoint blue. Printed book content is never blue.

**The Hand-Mark Rule.** Hand-drawn strokes mark game state, never controls. Buttons, inputs, selects, focus rings and rules text stay printed and crisp. A mark is thin (1.2–2.1px), seeded so it keeps its shape across re-renders, and drawn on once when the state it records begins. Words and numbers inside or beside a mark stay typeset in Bitter. A mark must carry state the Director needs and cannot already read elsewhere: no struck-out history, no tally of what a heading already says.

**The Circled Roll Rule.** The rolled tier is circled in ballpoint blue never filled or highlighted. The roll result stays on the Roll line: the working is trimmed before the line is allowed to wrap. The printed result under the loop stays ink, so it reads exactly as the book prints it. Highlighter yellow is left to native text selection.

**The Heavy Ink Rule.** Danger, removal, Down and EXTREME are set in heavy ink (an ink cross over a downed slip, a bold underline, an ink outline on hover), never in red, because red already means Malice.

**The Tincture Rule.** Group tinctures tag activation groups only. They never signal status, difficulty or emphasis.

**The Same Roles At Night Rule.** The night page swaps values, not meanings. Every role token has a night value, and components reference roles, never literals.

## Typography

**Voice Font:** Bitter Variable, roman and italic (with Georgia), a bold slab serif
**Label Font:** Poppins 600 / 800 (with system-ui), capitals only
**Glyph Font:** Draw Steel Glyphs (MCDM, CC BY-SA 4.0, shipped in `src/assets/fonts/` with its license and credited in the footer)

Bitter and Poppins are self-hosted through Fontsource.

**Character:** A bold slab serif does what the Monsters book does: names, labels, stats, rules text and here the chrome as well, all in normal case. A heavy geometric sans in small capitals is the book's page tab, kept to the wordmark, tags and the smallest labels.

### Hierarchy
- **Running Head** (Bitter 700, clamp(30px, 3vw, 40px), 1, 0.015em): "Round 3", "Prep". 32px on phones. Beside it, the encounter legend in Bitter 17px, ink-secondary.
- **Section** (Bitter 700, 26px, 1): Prep section headings ("Monster library"); the party line title at 21px.
- **Headline** (Bitter 700, 21px, 1.15): creature names in the statblock header panel and the Encounter box heading. Library entries use 19px.
- **Title** (Bitter 700, 16px, 1.25): ability, trait and Malice feature names. The bold kind on the same line (cost or ability type) is 14px 700. The power-roll line is 17px 700.
- **Numeral** (Bitter 700, 32px, tabular lining): the Malice pool (30px on phones). The same weight at 40px for the Prep encounter EV, 24px for the acted tally, 21px for stamina in pen.
- **Stat Value / Stat Label** (Bitter 400 20px over Bitter 700 13px): the stat row, number above its bold label. Characteristics use 16px values under a 12.5px 700 name that starts with a 15px glyph block. Modified stats add an 11px 600 pen note.
- **Pen Hand** (Bitter 600, 17px, pen blue): creature instance names and other Director-written text.
- **Body** (Bitter 400, 14.5px, 1.5): trait and effect prose. **Rules Line** (14px, 1.45): keyword, action, distance and target lines. **Meta** (13.5px, 1.4): keyword lines under the name, the EV line, library meta. Library ability lists and encounter subtitles are italic; statblock keyword lines are roman.
- **Button** (Bitter 700, 15px, normal case): primary buttons, 16px for "Next round"; secondary 14px 700; compact 13px. Navigation tabs 17px 700.
- **Control** (Bitter 600–700, 13.5px, normal case): chips (600), Roll and Malice use buttons (700), text buttons and spine buttons (600). Mini buttons and the Malice add control 13px; the sort select 14px 600; the Winded tag 14px 600 in ink; drop banners 14px 700.
- **Tab Label** (Poppins 600, 10.5px, 0.05em, uppercase, ink-tertiary): field labels, the spine heading, filter, sort and group labels, party metric captions, the acted label and the Malice label (13px, in malice ink).
- **Wordmark** (Poppins 800, uppercase): "MALICE" at 34px, 0.03em, its initial the horned M (`BrandM`, an authored SVG: the original emblem's letter recut at display weight, ~12% over size so its inner shoulders meet the cap line, feet on the baseline). "MENAGERIE" beneath at 15px, tracked 0.39em to the same measure. The collapsed rail shows the horned M alone.
- **Glyph** (Draw Steel Glyphs 400): tier badges 27px, ability icons 16px on the name line and 13px in the distance and target line, characteristic blocks 15px, potency blocks 1.05em inline.

Live sizes in the stylesheet: 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 19, 20, 21, 24, 26, 27, 30, 32, 34 and 40px, plus clamp(30px, 3vw, 40px) and 1.05em. Every one of these is a legitimate step (12px is the inline glyph in Malice costs and the movement line; 34px is the wordmark). The stylesheet also still declares 10, 25, 31 and 36px and two older running-head clamps, all overridden later by the "Book fidelity" and "One voice" sections, so they never render. Sizes below 10.5px are not part of the ramp (see Don'ts); the library `.tag` (8.5px), the spine count badge (9px) and the drag ghost's label (10px) currently break that floor and are defects, not steps.

### Named Rules
**The One Voice Rule.** Bold Bitter in normal case speaks for the statblock and the chrome alike: names, stats, labels, rules text, the running head, buttons, chips, navigation, Roll and Malice controls. Poppins capitals are allowed only on the wordmark, tags and the small label group.

**The Glyph Rule.** Draw Steel Glyphs sets only the book's own symbols: tier badges (`!` `@` `#` for ≤11 / 12–16 / 17+), ability icons mapped from the data's emoji, distance and target marks, characteristic letter blocks, the Malice skull and potency blocks such as "M<4". A glyph is always `aria-hidden` beside real text, or carries `role="img"` with a spoken label ("Might less than 4").

**The Column-Keeping Rule.** Every number that changes in place uses `tabular-nums lining-nums`.

## Layout

A two-part shell: a 244px flat black spine (68px when collapsed) and the page. Views pad 28px 36px 48px. The running head sits 36px in from each side, at least 84px tall, with a 3px double ink rule beneath. It holds the view title and legend on the left and the actions on the right.

On the Run board, statblocks are lanes side by side, separated by 1px strong vertical rules with an 18px gutter. Lane width comes from the board's container width: 100% below 680px, 50% at 680px, 33.33% at 1040px, 25% at 1440px, 20% at 1840px, with snap-scroll to the next. Each lane pins its header panel while its body scrolls. On short or narrow screens (1024px wide or 950px tall and below) the whole lane scrolls instead.

Between the running head and the board runs one strip, about 48px: the Encounter Malice toggle (with "Auto pick" once open), any active Malice effects, and the group filter pushed right. It wraps only on phones. Opening the toggle drops the Malice panel below the strip under its crimson rule, capped at min(44vh, 520px) with its own scroll so the statblocks keep most of the page. When the running head is too narrow, its controls drop to a second line as one block and never break apart.

**The Glance Budget Rule.** On the Run board, vertical space above the first creature slip is the scarcest thing on the page. New chrome joins an existing line before it takes a new one, and a row that has nothing to say is not rendered.

A statblock reads top to bottom: the header panel (name with "EV 156" at the right, then "Level 11 Solo" in bold followed by the keywords, so every lane's header has the same two lines and the stat rows line up across the board), the five-column stat row, the five-column characteristic row, then abilities and traits. Each ability is three aligned lines under a 22px icon column: icon + name + bold kind; keywords + action; distance + target, with the right-hand item pushed right. Effects, tiers and spend controls indent 26px to the name. Tier rows are a 40px badge column and the result.

Prep is a library column beside a sticky Encounter box (one column below 900px), under a full-width party line that ends in a V-notched rule.

Spacing runs 4 / 8 / 12 / 18 / 28 / 36px, with 2px between stacked rows. At 900px the spine becomes a menu toggle and the gutters shrink to 20px, then to 14px at 620px, where each lane takes the full viewport width.

**The Whole Statblock Rule.** The board never shows a partial statblock at rest. Lane widths are even fractions of the board.

**The Number Over Label Rule.** Stats print the value above a bold normal-case label ("109 / Stamina"). Characteristics print the name with its glyph first letter above the signed value ("Might / +5").

## Elevation & Depth

The page is flat. Depth comes from ink weight, the flat grey header panel and tonal stock (page, sheet, panel grey, field), not from shadows or gradients. Statblocks and the Encounter box sit flat on the page. Shadows are reserved for things physically lifted off it: drag ghosts, pop-up menus, the toast and the preview drawer (over a 45% ink backdrop).

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgba(40, 30, 20, 0.12), 0 8px 24px -6px rgba(40, 30, 20, 0.22)`): drag ghost, edge menu, toast. Night: `0 1px 2px rgba(0,0,0,0.4), 0 10px 28px -8px rgba(0,0,0,0.6)`.
- **Drawer** (`box-shadow: 0 12px 48px rgba(20, 15, 10, 0.35)`): the preview drawer. Night alpha 0.6.

### Named Rules
**The Rules Not Boxes Rule.** Separate printed content with rules: 1px strong rules under header panels, stat rows, abilities and traits, a V-notch at the centre of each divider, and a 3px double rule under running heads and drawer heads. Enclosing boxes are only for Director-writable surfaces (instance cards, inputs), the Malice counter and the Encounter box.

## Shapes

Print corners are near-square (2px) everywhere: buttons, inputs, chips, tags, instance cards, the Malice counter and its steps, the acted tally. Header panels are softer: the statblock panel rounds its top corners at 6px and the Encounter box rounds all four at 6px, with its heading panel matching at the top. The brand plate uses 3px. Tincture swatches and the stamina ruler use 1px. The stamina input is square, underlined with a dashed pen line.

The V-notch is the recurring mark: a 10px square with only its right and bottom borders in strong rule, filled with page stock, rotated 45deg and centred on the divider's bottom edge. It closes the statblock header panel, every ability and trait block, and the Prep party line.

The active spine tab joins the page through two 6px inverted radial corners, like a page edge reaching into the spine. The irregular shapes are the Director's hand marks (see The Hand-Mark Rule). The largest is the pen loop around a rolled tier: a 1.35px ballpoint line measured to the row in real pixels: an egg rather than a stadium (left end at most 20px round, the right a fifth tighter), long sides that bow, then a second, looser lap that drifts wide of the first so the two cross, ending in a flick past the start at the top left, and the whole loop turned -0.4deg off level. Every roll gets its own seed, so no two loops are identical. It redraws on every roll, including a re-roll that lands on the same tier. Tier rows keep 12px of room on the right so text never runs under the loop.

UI icons (menu, eye, plus, minus, close, drag) are a single stroke family: 24px grid, 2px round-capped stroke in `currentColor`, rendered at 16px (14px in icon buttons). The book's own symbols are glyphs, not SVG icons.

## Components

### Buttons
Solid ink for the one committing action, outline for everything else, all in bold serif, normal case.
- **Shape:** print corners (2px).
- **Primary:** tab-black with page-coloured Bitter 700, 11px 18px ("Next round", "Run encounter", "Add"). Hover lightens to `ink-hover`. At night it inverts to bone with charcoal text. Disabled drops to transparent with a hairline border.
- **Secondary:** transparent, strong-rule border, ink text. Hover fills with panel grey. `.active` fills solid ink.
- **Text button:** 13.5px 600 with a strong-rule underline offset 3px.
- **Icon button:** 28px square, transparent, ink-tertiary. Hover gains a strong-rule border and panel grey. The danger variant goes to heavy ink on hover, never red.
- **Transitions:** 0.12–0.14s ease on background, colour and border.

### Chips and Tags
- **Filter chips:** outlined Bitter 600 13.5px ("All", "Horde", "Minion"). Active is solid ink on page.
- **Tags:** small outlined Poppins capitals in a strong-rule outline (MINION, ELITE, SOLO).
- **Condition and active-effect notes:** Bitter 600 14px in pen, no box, ringed by a single hand-drawn pen loop. Hovering (or focusing) one previews the strike that tapping it makes; a small × stays at 60% for touch. Hovering or focusing a condition on a slip also opens the shared rule-preview card with that condition's rules text, the same card that reads cross-referenced terms in statblock text; the click still crosses it off. The add-condition control sits on the slip's name line, directly above the conditions it adds: a printed 28px dashed strong-rule button with a plus that turns pen on hover, spelled out as "+ Condition" only where the slip is 420px or wider, so the name keeps its room everywhere else.
- **Health notes:** Winded as an ink-outlined tag leading the conditions row, sized like a condition note, Bitter 600 14px. Down has no note; the slip is crossed through in ink.

### Cards / Containers
- **Statblock header panel:** flat panel grey, 6px top corners, a 1px strong-rule bottom edge with the V-notch. Name in headline Bitter; the level line in 14px 700; keywords and EV in 13.5px.
- **Stat and characteristic rows:** five even columns with no cell dividers, each row closed by a 1px strong rule.
- **Ability and trait blocks:** no fill, no border, 12px 0 13px padding, a 1px strong rule with the V-notch beneath.
- **Instance card:** sheet fill, hairline border, 2px corners, 7px 8px padding. Once acted, the fill goes transparent, the border turns dashed, the turn box is ticked in pen (the tick flicks out past the box) and the name steps back from pen to muted ink (`ink-tertiary`): done for the round, never struck through, which would read as dead. Stamina stays in pen. A slip reads name line, conditions, Stamina: turn boxes, name, add-condition, the group select (only its tincture swatch and name, no chevron) and remove; then Winded and the ringed conditions, a row that appears only when it has something to show; then the Stamina ruler, value and a squad's count. Winded is a printed ink tag (1px solid ink outline) leading the conditions row, cut to a condition note's size, so it cannot be mistaken for a ringed condition. It is ink, not pen, because the app derives it from Stamina. Down has no note: the whole slip is crossed through with two loose strokes in ink at 72%. A group filter button whose turns are all taken gets a pen tick on its corner.
- **Encounter box:** strong-rule border, sheet fill, 6px corners, no shadow, opened by the same flat grey panel as a statblock.

### Inputs / Fields
- **Style:** field fill, 1px strong-rule border, 2px corners, 9px 11px. Hover darkens the border to ink-secondary. Director-entered values are pen blue.
- **Focus:** pen border plus a 2px pen-wash ring. Global `:focus-visible` is a 2px pen outline offset 2px.
- **Stamina field:** borderless with a dashed pen-line underline, 21px Bitter 700 pen numerals over a muted "/ max". While the track is dragged it shows the previewed value and the underline turns solid.
- **Stamina track:** a printed ruler (12px, 1px strong-rule border, field ground) filled in flat pen blue, inset 2px; winded turns the fill to printed hatching. A printed ink tick marks half (the winded line), rising 5px above the ruler; squads print a tick at every minion instead, over the fill with a 1px stock halo so minions stay countable. The fill's end is the handle: at rest a 2px pen edge flush with the ruler, and under the pointer, in focus or mid-drag a 4px bar standing 5px proud of the ruler, cut from the fill by 1.5px of stock. It is a value and a control, so it is crisp, never hand-drawn. The whole track drags (a press must travel 4px before it counts, so a stray tap changes nothing), previews in place with the change written above the handle in 13px 700 pen ("−17"), and commits on release; Escape cancels. As a slider it steps 1 on the arrows and 10 with Shift or the Page keys, and never trims temporary Stamina above max.
- **Selects:** custom two-gradient chevron. Group selects add the tincture swatch.
- **Roster entries (Prep):** each row is one entry: a creature line ("EV 18 · 3 each") or one minion squad ("Squad of 4"), with the pen −/count/+ stepper. Minions follow the book by default: they arrive as squads of a set (four, mostly), a tap on a squad's − or + steps a whole set, and dragging its count moves a set. The single minion is the second gesture, never a second button: holding − or + for 450ms (or Shift+click) steps one, and Shift held as the count is lifted moves one. Each squad step is written after the squad size in 13.5px 700 pen ("Squad of 8 +4", "+1"), fading after 0.9s. Squads may pass the book's eight; "Squad of 12" then prints in ink with a dotted underline and explains itself in the hint card. Creatures step and move one at a time. Dragging the row moves the whole entry. Lifted creatures dropped on a group join that monster's entry there or start one; lifted minions dropped on another squad of their kind (lit with pen wash and a 1px pen outline, the ghost reading "Join squad") join it, and a whole squad dragged by its row onto another squad of its kind merges into it ("Merge squads"); dropped anywhere else in a group it moves as before; dropped on a group become a squad of their own, and dropped on the library leave the roster. The entry that received them washes pen for a moment. A row of the same monster straight after itself opens on a dashed rule. Mid-fight a squad's count cannot be lifted (its wounds cannot be divided); a creature's can, and its slip goes with it. Moving a creature to another group on the board splits its prep entry the same way. EV counts every creature on its own, a minion at its share of its set's EV, so the encounter EV is always the sum of the groups.
- **Squad captain (Run):** without a captain a squad costs no extra row: a 28px dashed control with two stacked chevrons ends the Stamina line, cut like "+ Condition" (the word "Captain" only on slips 420px or wider), with the native select laid invisibly over it so a tap opens the platform picker; its title carries the With Captain benefit. Once attached, a row appears under the Stamina past a dashed hairline: the captain in a pen select (which also lets go) and the "With Captain" benefit in 13.5px ink prose. The captain's own slip leads its conditions row with a pen-outlined "Leads Squad 1 · Goblin Spinecleaver" note.
- **Squad stack:** under a minion's rolled signature tiers, "Same target" in ink, then the 2- and 3-minion totals written on in pen (the Pen-Stroke Rule's text reveal), and "+N with captain" in ink-secondary while a squad of that type has a captain with a damage bonus.
- **Balance checks:** the book's encounter-wide advice the roster breaks (creatures per hero), as 13.5px prose notes under the difficulty help, each led by a short ink rule. Ink, never red. Advice about one group lives with that group instead.
- **Group tally (Prep):** each non-empty group heading prints "7 enemies · EV 21" in 13.5px 600 ink-tertiary, worded rather than "7 × EV 21", which would read as a multiplication. Creature rows likewise read "EV 18 · 3 each" (or "EV 3" for one). An EV outside the book's one-to-two-hero range changes alone: bold ink with a dotted 1.5px underline offset 3px and a help cursor, followed by a 12px ink chevron pointing up (over two heroes) or down (under one hero) so the direction reads without hovering, explained in the shared rule-preview card (heading "Encounter value above recommendation", or below; body "Recommended value is between 6–12.", with "One group below it is fine." when below), never a native tooltip. The card opens on hover and focus, and on touch a tap opens it and a second tap (or a tap elsewhere) puts it away; tapping the EV does not select the group. Until every statblock in a group has loaded, its EV prints "EV …" and is never flagged. Nothing else is added to the group. Below the groups, only when off and with no solo in the fight, a centred 13.5px italic ink-secondary note: "2 groups for 5 heroes · aim for 3 to 7". Groups are size containers: under 340px the "Adding here" words give way so the group name keeps its room.

### Navigation
- **Spine:** flat black. The wordmark is Poppins 800 capitals opened by the horned M; no plate or frame, the mark sits directly on the spine.
- **Tabs:** Bitter 700 17px with an icon and a count badge, in `on-spine-dim`. Hover is the raised spine tone. The active tab is cut from page stock with inverted corners.
- **Encounter list:** Bitter name with a subtitle. The active row gets a 1px bar.
- **Mobile:** below 900px, a 40px menu toggle in the running head.

### Malice Counter (signature)
The only crimson in the running head, written in crimson ink rather than filled: a 1px crimson border around a MALICE tab label, outlined crimson −/+ steps (32px, 34px on phones) that fill solid crimson on hover, a 32px Bitter numeral in malice ink, and "+N next" after a crimson divider. It is 50px tall, matching the acted tally and the "Next round" button beside it. The acted tally turns pen blue and is ringed by hand, not filled, once every turn is taken.

### Ability Block with Tier Rows (signature)
The book's layout, line for line: a glyph icon, the bold name and the bold kind at the right ("Signature Ability", "2 Malice", "Main action"); keywords with the action type at the right; the distance glyph and distance, then the target glyph and target at the right. Below it the "Power Roll + 5" line with an outlined pen "Roll" button and the roll worked out in pen: both d10s sketched as kites (pen-line outline, 13px numeral), the bonus, a pen-line "=", and the 20px total ruled off twice. The tally takes whatever the line has left and never wraps: under 150px the dice and bonus give way, leaving the total and any edge or bane note. Then three tier rows led by glyph badges. Potency renders inline as the book's black glyph block ("M<4"). The rolled row turns its badge pen blue and is circled with the pen loop, two quick laps that cross, drawn on as one stroke.

### Motion
**The Pen-Stroke Rule.** Marks the Director makes are drawn on as a pen stroke traced along its own path (a stroke-dashoffset draw, ease-out `cubic-bezier(0.16, 1, 0.3, 1)`): about 0.3s for strikes and ticks, 0.45s for rings, 0.72s for the two-lap tier loop, with multi-stroke marks (the Down cross, the answer rules) drawing one stroke after the other. Typeset pen text is revealed left to right with a clip-path (`inset(0 100% 0 0)` to `inset(0 0 0 0)`). The roll tally writes itself in order: kites, sum, rules. Nothing else uses these animations. Everything else is a short transition: 0.12–0.2s for colour, 0.24–0.3s for the spine collapse, drawer slide, meters and budget ruler, and a 0.16s menu-in. `prefers-reduced-motion` collapses all of it.

## Do's and Don'ts

### Do:
- **Do** open every statblock and the Encounter box with the flat panel-grey header (`--tint`), a 1px strong-rule bottom edge, and a Bitter 700 name in normal case.
- **Do** set stats as number over bold label, characteristics as "Might +5" with a glyph first letter, and abilities as icon + name + kind / keywords + action / distance + target.
- **Do** close statblock sections, abilities and traits with a 1px strong rule and its centred V-notch.
- **Do** use Draw Steel Glyphs for tier badges, ability icons, distance and target marks, characteristic blocks, the Malice skull and potency blocks, with accessible text beside or on them.
- **Do** set the running head, buttons, chips, navigation and controls in bold Bitter, normal case.
- **Do** set every Director-entered or rolled value in ballpoint blue (`--pen`).
- **Do** write Malice in crimson ink and outline (`--malice` border, `--malice-ink` text), filling crimson only on hover.
- **Do** mark danger and removal with heavy ink: an ink cross over a downed slip, an underline on EXTREME, an ink outline on remove hover.
- **Do** keep 2px print corners on controls, 6px on header panels, and tabular numerals on anything that changes.
- **Do** give every new colour role a night value and reference it by token.

### Don't:
- **Don't** put a gradient or a black band on a statblock or panel header; header panels are flat panel grey.
- **Don't** set Poppins or uppercase anywhere but the wordmark, tags and the small label group; the one serif exception is the capitalised difficulty word (EXTREME) under the Heavy Ink Rule.
- **Don't** set any text below 10.5px.
- **Don't** render the data's emoji icons; map them to the glyph font, and fall back to no icon.
- **Don't** fill the Malice counter solid crimson at rest.
- **Don't** use crimson or any red for errors, deletion, danger or "extreme"; red means Malice.
- **Don't** use highlighter yellow for anything but native text selection (and the horned M's eyes, under the Horned Initial Rule).
- **Don't** use group tinctures for status, emphasis or difficulty.
- **Don't** set printed book content (stats, ability text, labels) in pen blue.
- **Don't** add a second animation grammar or reuse the pen stroke for non-mark UI.
- **Don't** put shadows on statblocks or panels; shadows are only for lifted things.
- **Don't** hardcode colour literals in components; the night page depends on role tokens.
