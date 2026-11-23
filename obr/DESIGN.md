---
name: Malice Menagerie · Owlbear extension
description: Compact settings that follow Owlbear Rodeo's live theme.
colors:
  page: "#fff"
  paper: "#f5f5f5"
  ink: "#212121"
  secondary: "#616161"
  accent: "#673ab7"
  on-accent: "#fff"
  rule: "#dedede"
  error: "#b3261e"
  ok: "#2e7d32"
  dark-page: "#222639"
  dark-paper: "#2d3147"
  dark-ink: "#fff"
  dark-secondary: "#bec0cd"
  dark-accent: "#bb99ff"
  dark-on-accent: "#241442"
  dark-rule: "#4e5265"
  dark-error: "#ffb4ab"
  dark-ok: "#81c784"
typography:
  title:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.4
  section:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "16px"
    fontWeight: 500
  body:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  description:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  footer:
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "4px"
  switch: "12px"
  circle: "50%"
spacing:
  field-gap: "7px"
  sm: "8px"
  header-gap: "10px"
  md: "12px"
  field-padding: "10px"
  heading-gap: "14px"
  lg: "16px"
  section: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  switch:
    rounded: "{rounded.switch}"
    width: "36px"
    height: "20px"
  initials-preview:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.circle}"
    size: "40px"
---

# Design System: Malice Menagerie · Owlbear extension

## Overview

**Creative North Star: "At home in Owlbear"**

This document governs the embedded settings popover in `index.html`. It is a deliberate host-native exception to the main application's printed-book system in [../DESIGN.md](../DESIGN.md). The extension uses Owlbear's live palette, a compact sans-serif hierarchy, modest control corners and flat dividers. The main application's Bitter typography, book panels and pen marks remain governed by its own design system.

Settings follow everyday usefulness: connection actions, token appearance, Sync (Rings Initiative and Condition labels), dice, then collapsed advanced hosting and usage help. Initials are the default; TooManyTokens artwork requires an explicit switch. The official deployed Malice app is the default destination. This surface helps a Director configure a companion and return to the table.

**Key Characteristics:**

- Host-controlled light and dark colors.
- Compact sans-serif type and flat section dividers.
- Everyday preferences visible; hosting details disclosed on demand.
- Initials preview and explicit artwork consent.

## Colors

The frontmatter records the shipped CSS fallback palettes, not a fixed brand palette. `main.popover.ts` reads `OBR.theme.getTheme()` and subscribes to `OBR.theme.onChange()`. Live values supersede the corresponding fallback tokens.

### Primary

Accent and on-accent follow `theme.primary.main` and `theme.primary.contrastText`. Accent identifies connection actions, the enabled switch, focus outlines and the geometric brand mark.

### Neutral

Page and paper follow `theme.background.default` and `theme.background.paper`; ink and secondary follow `theme.text.primary` and `theme.text.secondary`. Rule is derived at runtime with `color-mix(in srgb, theme.text.primary 23%, theme.background.default)`. CSS fallback rules are recorded separately in frontmatter. Before the host responds, the system dark preference selects the fallback dark palette. An explicit host mode controls the body’s native-control `color-scheme` while the root remains `normal`; error and success retain local light/dark semantic values.

Error colors identify actionable failures; success colors identify connection status. Status always includes text alongside its colored dot.

**The Host Palette Rule.** Read and react to Owlbear's theme; use the extension's CSS role variables throughout this surface.

## Typography

The body uses the Roboto / Helvetica Neue / Arial sans-serif stack. Roboto is preferred, not bundled by this surface. Product title and section headings use medium weight; descriptions are smaller and secondary. Buttons and disclosure summaries use medium weight at the body size. The initials preview uses semibold body-sized text. There is no separate display face or uppercase label tier.

The exact reused roles are in frontmatter. Section and body line heights are browser defaults unless a component declares one; do not infer the description line height for all controls.

## Layout

A single vertical column has a maximum width of 480px and centered margins. The ordinary inset and section separation use the section spacing token. At viewport widths of 320px or less, the inset changes to the large spacing token. The intended Owlbear action popover is 360px wide; compact behavior also supports 320px. Buttons wrap with the small gap. Fields fill the available width and can shrink; descriptions and failures wrap long addresses anywhere.

Connection, Tokens, Sync and Dice precede the Advanced and How to use disclosures. The switch row has a minimum height of 44px, copy flexes and the control stays fixed. Each field is a label/control grid. New controls should preserve this single-column rhythm.

## Elevation & Depth

The surface has no box shadows. Thin rules divide sections, outlined fields establish editable boundaries and tonal paper distinguishes the initials preview. The surrounding host owns the popover's elevation and translucent background. Both `html` and `body` remain transparent; never paint the theme's opaque page color over the host surface. Outlined fields also remain transparent; expanded select options retain the theme page fill for readability. Keep root `color-scheme: normal` and scope light/dark native-control schemes to the body, so the iframe canvas stays transparent.

## Shapes

Buttons and fields share gently rounded control corners. The artwork switch is a short pill with a circular thumb. Circular geometry is reserved here for the status dot and initials preview. The compact geometric SVG brand mark is masked with the live accent; it is decorative beside the text heading.

## Components

### Buttons

Primary connection actions use accent fill and contrasting text. Secondary actions use transparent fill, an outlined rule and accent text. A Cancel button appears while pairing is in progress so the Director can abort before timeout. Both have a minimum height of 36px. Hover darkens enabled primary buttons using ink mixed at 12%, or washes enabled secondary buttons with accent at 8%. Disabled buttons, selects, inputs, and switches reduce opacity to half. Keyboard focus uses a two-pixel accent outline offset by three pixels.

### Inputs / Fields

URL inputs and selects use transparent fill, a rule outline, control corners, and a minimum height of 40px. Expanded select options use page fill. Labels and help use secondary text. URL text uses an accent caret; placeholder text remains fully opaque. Invalid actions surface an alert below the relevant connection controls.

### Token appearance switch

Use a native checkbox with switch semantics and a visible text label. Its 14px thumb moves 16px when selected. The off track mixes secondary at 62% with page and a subtle border to maintain ≥3:1 non-text contrast; the on track uses accent. The initials preview has an accent outline and paper fill. Enabling artwork hides that preview and explains initials fallback when artwork is unavailable. Feedback confirms persistence or explains storage failure.

**The Explicit Artwork Rule.** New tokens use initials until the Director opts into TooManyTokens; changing the preference preserves existing artwork. Initials use native Owlbear text over a version-pinned public HTTPS circle image. Scene image URLs must be reachable by hosted extensions and all players; never use localhost, data or blob URLs. Re-sending repairs older extension-hosted SVG placeholders in place.

### Connection status

An eight-pixel dot accompanies a medium-weight title and secondary description. Neutral, accent, success and error distinguish disconnected, connecting, connected and failure states; text carries the meaning accessibly.

### Disclosures

Native `details` / `summary` keep Advanced hosting and How to use compact and keyboard accessible. Summaries have vertical large spacing, a secondary native marker and the shared focus outline. Custom server input appears only when selected; the official deployment is `https://malice-menagerie.pages.dev`. Server controls disable while connected or pairing.

### Motion

Button color changes take 120ms ease-out; the switch thumb moves in 150ms ease-out. Reduced-motion preference removes both transitions. Do not import the main application's pen-stroke animation into the host settings surface.

## Do's and Don'ts

### Do:

- **Do** use Owlbear's live theme and CSS role variables for this embedded surface.
- **Do** preserve the visible connection, Tokens, Sync and Dice order with advanced hosting in a disclosure.
- **Do** retain text labels, keyboard focus and status explanations alongside visual cues.
- **Do** keep initials as the default and external artwork as an explicit preference.
- **Do** check both host modes and the 360px and 320px widths when extending this panel.

### Don't:

- **Don't** apply the main application's Bitter/book styling to the Owlbear settings panel.
- **Don't** hardcode the fallback purple when a live host accent is available.
- **Don't** add card shadows to this flat settings list.
- **Don't** replace existing token artwork when the appearance preference changes.
