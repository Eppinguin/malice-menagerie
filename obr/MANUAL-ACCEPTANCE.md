# Manual acceptance checklist

This bridge crosses three boundaries that unit tests cannot exercise: Owlbear
Rodeo's extension iframe sandbox, the popup/`MessageChannel` handshake, and
Draw Steel Tools' undocumented metadata. Run this checklist in a real Owlbear
Rodeo room before calling a release verified. `pnpm test` proves the pure
protocol, identity, statblock, and conflict logic only.

`pnpm build:obr-harness` runs the real popover and background against an
in-memory Owlbear SDK in a normal browser. It covers pairing, the SharedWorker
port hand-off, import, and Stamina sync, and is worth running first because a
failure there is cheaper to read. See [`HARNESS.md`](./HARNESS.md). It cannot
tell you whether Owlbear itself allows popups, provides `SharedWorker`, or how
Draw Steel Tools renders the metadata, so it does not replace this checklist.

Suggested setup:

- Two browsers or one normal window plus one private window, signed into the
  same Owlbear room (one as GM, one as player).
- Draw Steel Tools installed for the statblock checks.
- A Malice encounter with at least one creature and one four-minion squad,
  split across two activation groups.

## Phase 0 — transport spike

Build and host the harness bundle (which includes `spike.html` and `spike-peer.html`, kept out of the production `dist/` build):

```bash
pnpm build:obr-harness
# serve obr/harness-dist at an HTTPS origin (or http://localhost)
```

For normal production hosting, build `pnpm build` (or `pnpm build:obr`) and serve `dist/` over HTTPS so the extension is reachable at `/obr/manifest.json` (for example `https://malice-menagerie.pages.dev/obr/manifest.json`). Owlbear builds frame URLs by concatenating the manifest origin and each path, so paths in `obr/public/manifest.json` must start with `/obr/` (or be full URLs); `scripts/check-obr-build.mjs` verifies this on build.

1. Edit the served harness `manifest.json` so every `/obr/` prefix matches where
   you serve `obr/harness-dist`, and set `action.popover` to `"/spike.html"`
   (or `"/obr/spike.html"` if served under `/obr/`).
2. Install or reload the custom extension in Owlbear Rodeo.
3. Open the extension popover and press **Run spike**.
4. Expected: a new window opens, and the popover lists PASS for:
   - `window.open returned a window handle`
   - `READY received from the opened window`
   - `HELLO sent with one transferred port`
   - `PONG returned over the transferred port`
   - final line `PASS: window.open, READY, and MessagePort all work in this host.`
5. Restore `action.popover` to `"/obr/index.html"` (or `"/index.html"` for the root harness) and reload the extension.

If loading the extension fails with
`TypeError: Failed to construct 'URL': Invalid URL` from `addFrame`, the
manifest ran naked relative paths: Owlbear concatenates `origin + path`, so
`"background.html"` becomes `https://host.examplebackground.html`. Every hosted
path must start with `/`.

If a step fails:

- **`window.open` returned null** — Owlbear or the browser blocked the popup.
  Allow pop-ups for Owlbear Rodeo and retry. If it still fails, the one-click
  flow is not viable in that host and needs a documented fallback.
- **No READY** — open the spike peer window's console. Check whether it loaded,
  whether `window.opener` exists, and whether its origin equals the popover
  origin.
- **No PONG** — the host does not carry transferred ports between these
  windows. Do not proceed with the main bridge until this is understood.

## Site-initiated pairing and automatic reconnection

Run these checks with the updated app **and** extension in a real Owlbear room.
The local browser test simulates the room and SDK; it does not test Owlbear's
headers, iframe sandbox, login redirects, or bot protection.

1. Enable the extension in a room. In Malice's **Settings → Integrations → Owlbear Rodeo**
   panel, paste that room's link. Set **Connection settings → Extension address** to the manifest URL
   installed in Owlbear, and set the extension's Malice address to the app host.
2. Press **Connect to room** in Malice. One room tab should open and stay open.
   Once it finishes loading, Malice must show **Synchronized**. No temporary
   Malice tab should appear and the extension popover need not be opened.
3. Refresh Malice. With both tabs open, it should synchronize again automatically
   (normally within a few seconds, longer if the browser throttles background tabs).
4. Refresh the room. After the extension background loads, Malice should
   synchronize again. Ensure a _new_ connection appears in the connection log;
   an old Synchronized label alone is insufficient evidence.
5. Press **Disconnect** in Malice. Wait several seconds and refresh Malice: it
   must remain disconnected. Repeat using Disconnect in the extension.
6. Cancel while waiting for the room, block the popup, close the room before it
   connects, disable the extension, and enter a wrong extension address. Each
   case must stop or report an actionable error instead of opening further tabs.
7. With a healthy connection, send tokens, edit Stamina in each direction, and
   repeat after refreshing each tab. Reconnection must preserve scene mappings
   and the existing Stamina reconciliation policy.
8. Try an Owlbear login redirect and browsers with strict privacy settings. If
   the room's opener is severed, site pairing must report an error and the
   extension's existing Connect flow must remain usable. This is a compatibility
   limitation, not proof that site pairing succeeded.
9. Repeat both refresh checks after connecting from the extension into an
   independently opened Malice tab. Its channel should reattach through the
   shared workers even though that app tab has no Owlbear opener reference.
10. Disable the worker or delay a reload beyond its lifetime. Report connection
    loss and allow pairing again; never report Synchronized from cached metadata.

## Phase 1 — pairing and reconnection

1. Open Malice once at the address configured in the popover.
2. In Owlbear, press **Connect**. Malice opens in the named window and the
   popover reports **Connected to Malice Menagerie** with the scene label.
3. With a Malice tab already open, press **Connect** again. The pairing tab must
   hand the connection to the open tab and close itself; the open tab shows
   **Send tokens** (or **Synced**) in the top bar and **Synchronized.** in Settings. If the browser refuses to close the pairing
   tab, that tab shows **Connected in another Malice Menagerie tab** and should
   be closed by hand.
4. Open a second Malice tab, close it, then press **Connect**. The hand-off must
   still reach the first tab; a tab that has gone away must not be preferred.
5. Reload the open Malice tab and press **Connect** immediately, while it is
   still loading. The pairing tab waits briefly and then hands over, or, if the
   tab never appears, keeps the connection and says so in its log.
6. Close the popover. Reopen it: the connection must still be reported.
7. After closing the popover, change Stamina in Malice. The linked token must
   still update: the background page, not the popover, owns the channel. Change
   Stamina in Owlbear and confirm Malice still receives it.
8. Refresh the Malice tab. It must reattach to the retained channel and finish
   synchronizing without pressing Connect or opening another tab. If the worker
   expired, show connection loss and allow manual pairing again.
9. Press **Disconnect**, then **Connect** again. Only one bridge may be live;
   the previous session must be replaced cleanly.
10. Open a second Malice window and pair it. The first must lose the connection,
    not run two writers against the same scene.
11. Open a second Owlbear room in another tab and pair it. The first room must
    keep its connection and its status; the second must not steal it.
12. Try a wrong address (for example `http://example.com`). Pairing must be
    refused with a readable error.

Security spot checks:

- Inspect the Malice console while pairing: no message may be accepted from an
  origin other than the extension's.
- In the popover console, post a HELLO with a wrong `pairingToken` or an old
  session id to Malice. It must be rejected; the UI must not change.
- Confirm the extension never sends to `"*"` (search the built assets for
  `postMessage(..., "*")`).

If pairing stops at **"Paired — finishing handshake…"**, the background never
adopted the port. Check the extension background console; the popover reports
either "the extension background did not answer" or "could not start the
extension worker" (SharedWorker blocked or `bridge-worker.js` not served).

## Phase 2 — encounter import

1. In Malice, press **Send tokens**.
2. Expected on the map:
   - one token per creature;
   - one token per minion in a squad, all showing the squad's name and split
     Stamina;
   - tokens placed on free grid cells, not stacked on existing tokens;
   - by default, new tokens render readable monster initials over a version-pinned
     circle image without loading TooManyTokens artwork; when **Use TooManyTokens artwork**
     is enabled in the extension popover, mapped monsters use their TooManyTokens WebP
     artwork (Pathfinder URLs include `/Tokens/`), unmapped entries fall back to initials,
     and no image points at `data:`, `blob:`, or an app-hosted `/token.png`;
   - a token created by an older build is repaired on the next send, while a token
     whose art the GM replaced is left alone;
   - tokens are scaled to their Draw Steel monster size (Size 2+ spans multiple cells, `1T` / `1S` are smaller than `1M`);
   - each linked card shows visibility (eye), cursor, and crosshair controls beside Stamina; unlinked living cards show a per-card send button, defeated linked cards show a trash button, and squads with fallen tokens still on the map show a `−N` locate badge.
   - Shift+clicking or holding/right-clicking **Send tokens** allows **Send hidden**, and toggling a card's eye button hides/reveals the token along with its attached rings/labels/markers;
   - renaming the scene in Malice's Settings panel updates the scene label in both Malice and the extension popover and persists across reconnects.
3. Press **Send tokens** again. No duplicate tokens may appear; existing
   tokens keep their ids.
4. Add one creature in Malice and send again. Exactly one new token appears;
   all earlier token ids are unchanged.
5. Edit a token's Stamina in Owlbear, then send again. The explicit send
   updates the linked token rather than creating another.
6. Delete one squad token in Owlbear. The card shows a `+1` send action (and the
   toolbar badge reflects the missing token), and the mapping must not silently
   recreate it. Press **Send tokens** (or the card's `+1` button) only if you want
   the missing token recreated.
7. Delete every token for one combatant. Press **Send tokens** (or the card's send
   button); the tokens return and the card restores its visibility/select/locate controls.
8. Remove a combatant from Malice. The token must remain on the map; the panel
   must list it under **Tokens with no combatant**. **Remove token** is the only
   action that deletes it.
9. Restart the combat in Malice (new instance ids). Send again. Tokens must be
   reattached by prep entry/slot, not duplicated.
10. Remove one instance and add a different creature with the same prep entry.
    It must not inherit the removed creature's token.

## Phase 3 — scene and refresh recovery

1. Refresh the Owlbear page. Reopen the extension; the background must
   rebaseline without emitting a burst of stamina changes into Malice.
2. Switch to a different Owlbear scene. Malice must report **Syncing…**, load
   that scene's mappings, and show no tokens from the previous scene.
3. Send the encounter in the new scene. Tokens must be created there; returning
   to the first scene must still show its original tokens.
4. Reload the Malice page. Cached mappings must survive; reconnect must not
   duplicate tokens or lose the last Stamina values.

## Phase 4 — statblocks (Draw Steel Tools)

1. With Draw Steel Tools installed, send a creature whose name/level/role
   matches the bundled index exactly. The token's stat bubble must show that
   statblock and current/max Stamina.
2. Send a re-levelled monster. It must resolve against the printed level.
3. Send a monster with an ambiguous or missing name. It must appear under
   **Statblocks needing a choice**; choose a candidate, send again, and confirm
   the bubble updates. Send once more and confirm the choice is remembered.
4. Send a minion squad. Each token must join one Seamus minion group with the
   same name, per-minion Stamina, and current pool.
5. Disable Draw Steel Tools and send again. Import must still succeed; no token
   or scene corruption, and a readable warning/absence of statblocks. Re-enable
   it and confirm overlays rebuild.
6. If Draw Steel Tools changes its metadata format, confirm the failure is
   contained to statblock display and does not break token placement or Stamina
   sync.

## Phase 5 — Stamina sync

Run with both windows visible so each direction is observable.

1. Change current Stamina in Malice. The Owlbear bubble updates after a short
   debounce; rapid changes settle on the final value.
2. Change current Stamina in Owlbear. Malice reflects it. Repeat for a minion
   squad: the pool total must match the sum of surviving tokens' per-minion
   Stamina.
3. Raise a creature's maximum in Owlbear. Malice accepts the higher maximum.
   Lower it in Owlbear: Malice must not lower its maximum.
4. Try to change a minion squad's maximum in Owlbear. Malice's roster maximum
   must win; the squad is clamped to its pool.
5. Set temporary Stamina in Owlbear, then change current Stamina in Malice.
   Temporary Stamina must remain untouched (Malice does not model it).
6. Make a Malice edit and immediately an Owlbear edit. The pending local value
   must win, and the final state must be the local value after the flush. The
   connection log must say the Owlbear change was ignored while local.
7. Disconnect, change Stamina on both sides, then reconnect. Expect Owlbear's
   value to win for existing combatants (per the reconnect policy), with the
   change visible in Malice rather than silently discarded.
8. Watch for echo loops: one edit must produce one update, not a ping-pong of
   stale values.
9. Rename a token in Owlbear (for example "Goblin A"), then change its Stamina
   in Malice. The name must stay "Goblin A"; only the Stamina metadata updates.
   Rename the combatant in Malice instead: an unrenamed token must follow it.

## Phase 6 — selection and focus

1. Click a linked card's cursor button. Owlbear selects the matching token using its
   native selection controls. A squad selects all its linked minion tokens.
2. Click another card's cursor button. Its tokens replace the previous selection;
   no custom highlight shape is created. Any highlight left by an older build
   is removed.
3. Press the crosshair button. The Owlbear viewport pans to the token and keeps its
   current zoom. Double-clicking the card still works. Test a token near the
   edge and off-screen; confirm the buttons remain usable on touch screens.
   Repeat after panning and at 25%, 100%, and 250% zoom. The token or squad
   bounds must land in the viewport centre, keep the same zoom, and not drift
   when Locate is pressed again.
4. Select a token in Owlbear with **Follow Owlbear selection in Malice**
   enabled. The matching card scrolls into view without becoming the active
   combatant. Disable it and confirm selection no longer moves the board.
5. Confirm selection/focus do nothing harmful when the mapping is missing or
   the token was deleted.

## Phase 7 — Rings Initiative

Install Seamus Finlayson's Rings Initiative alongside Draw Steel Tools, enable **Sync Rings Initiative** in the companion popover, and use current builds of both Malice and its companion. Also confirm that leaving **Sync Rings Initiative** off creates no rings or initiative metadata.

1. Send two activation groups, with a mixed-monster group, a solo, and a four-minion squad. Each Malice group must appear together in Rings under its group name category. The squad must contribute one turn budget, and the solo its configured number of turns.
2. Send again: no duplicate rings. Rename a group and move a creature between groups in Malice; Rings must follow automatically. Include two groups with identical names and verify they stay separate.
3. Spend and restore turns in each application; check individual creatures, the solo, and the minion squad. No feedback loop or extra squad turns should appear.
4. In Rings, change the squad carrier's category or outer ring color to match another group. Malice must move the squad together; Prep should follow when all copies of its roster entry moved.
5. Advance a round from either application. Check the counter, turns, Malice gain, reactions reset in Malice, and effect expiry. Step back and check the round gain refund. Reset turns in Rings without advancing the counter and verify Malice restores turn availability.
6. Refresh/reconnect. Owlbear's existing turns and grouping must be restored. Add a new monster or grow a squad, send again, and verify new tokens get rings without increasing the squad's turn budget.
7. Keep hero tokens, another encounter, and manual rings in the scene. Confirm they stay unchanged. Verify Draw Steel Tools Stamina sync still works while changing initiative.
8. Switch scenes during a sync and confirm a stale request cannot write to the new scene. Disable Rings and confirm token and Stamina operations still work.

## Connected Dice

With Connected Dice enabled and a player observing the same room:

1. Choose **Connect dice** in the companion popover. Confirm that available themes
   load; choose one and roll an ability from Malice. Verify players see those dice
   and Malice uses the same two values, bonus, and resolved tier. Toggle **Roll
   privately (GM only)** and confirm subsequent rolls are hidden from players.
2. Repeat with a characteristic check and a Malice feature, including single and
   double edges/banes and a natural 19/20. Ensure modifiers are applied once.
3. Close and reopen the popover, then reload Owlbear. Confirm the room's theme is
   retained and dice reconnect. Check another room has independent settings.
4. Choose **Disconnect dice**. Verify Malice rolls locally, the app stays paired,
   and Draw Steel Tools can still use Connected Dice independently.
5. Disable Connected Dice and retry connection. Confirm the missing-roller message
   and retry action. Remove it during a roll; confirm a timeout never generates a
   replacement local result. Check Owlbear before manually retrying.
6. While dice animate, change Stamina and verify sync still completes. Click a
   second roll and confirm it is refused while the first is pending.

## Token Labels

Install `https://condition-labels.onrender.com/manifest.json`, then rebuild and host
both Malice and its companion extension.

1. Send a creature with Dazed and a minion squad with Slowed. Verify compatible attached
   labels appear on the creature and are skipped for the minion squad (per-minion
   conditions stay on the Owlbear map). Repeat Send; no duplicates.
2. Add/remove a condition on a creature in Malice without changing Stamina. Verify the
   labels update. Put a condition label on one minion token in Owlbear; verify it stays
   on that token alone and is not copied onto sibling minions on the next Stamina sync.
3. Use Token Labels' Draw Steel and emoji libraries to add Dazed with `(SE)` or
   `(EoT)` on a creature. Confirm Malice shows Dazed and disables its triggered/free
   actions. Edit/delete the label; verify Malice updates without a Stamina change.
4. Add an unrelated annotation. Sync and resend; the annotation and existing
   condition emoji, duration, and style survive. Winded/Dying remain independent.
5. Reload/reconnect with labels present, then change scenes. Verify creature conditions
   restore from the active map and unrelated tokens/encounters stay untouched.
6. While a local creature condition edit is pending, change its label in Owlbear. Verify
   the local edit wins and the final labels agree after the update completes.

## Marked! by Battle-System

Install `https://marked.battle-system.com/manifest.json`, save its room settings,
and rebuild/host the updated companion extension. Add the nine Draw Steel names to
Marked!'s library for context-menu controls, with emoji/duration variants if desired.

1. Send a creature with Dazed and a minion squad with Slowed. Verify native Marked!
   markers appear on the creature and are skipped for the minion squad; repeated sends
   create no duplicates.
2. Set label colors/directions and group size/opacity/outline overrides in Marked!.
   Add a condition from Malice; verify the new marker follows that configuration.
3. Toggle a matching condition through Marked!'s context menu without changing
   Stamina. Verify Malice adds/removes the condition and Dazed's action restrictions.
4. Keep custom marks and a matching existing marker with a counter on the token.
   Resend: appearance/counter values survive. Clear the condition in Malice:
   its root, text, and counter controls disappear; custom marks stay intact.
5. Close Marked!'s settings panel. Change conditions in Malice; sync continues.
6. Start with Token Labels conditions and an unrelated annotation, then save a
   Marked! configuration and send again. Verify supported labels convert to Marked!
   markers without duplicate condition sources and the annotation survives.
7. Delete the Marked! marker on a creature in Owlbear, then reload/reconnect:
   the condition stays cleared. Switch **Condition labels** to **Token Labels**
   and sync: stale Marked! condition markers are replaced by Token Labels while
   custom marks remain intact.
8. Check another room with no saved Marked! settings or markers still uses Token
   Labels, and unrelated tokens and encounters are never modified.

## Diagnostics to capture on failure

- Malice **Settings → Integrations → Owlbear Rodeo → Advanced settings → Show connection log**.
- Popover status detail and any error box.
- Browser console for both the Malice window and the extension background.
- Owlbear scene / room metadata and broadcast channels for:
  - `com.malicemenagerie.owlbear/scene`
  - `com.malicemenagerie.owlbear/token`
  - `com.draw-steel-stat-bubbles/metadata`
  - `com.draw-steel-stat-bubbles/monsterGroups`
  - `rodeo.owlbear.colored-rings/initiative` (token)
  - `rodeo.owlbear.colored-rings/metadata` (ring)
  - `rodeo.owlbear.colored-rings/Initiative` (scene round)
  - `com.battle-system.mark/m` and `com.battle-system.mark/metadata_marks` (Marked! room settings)
  - `${tokenId}-label-*` attached `LABEL` items (Token Labels)
  - `general.diceRoller.hello`, `general.diceClient.hello`, `com.malicemenagerie.owlbear/powerRollResult` (Connected Dice)

Record the Owlbear Rodeo version, browser, Draw Steel Tools version, extension
commit, and which checks failed. Do not describe the integration as verified
until Phase 0 and the import/Stamina paths pass in a real room.
