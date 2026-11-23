# Browser harness

The harness runs the **real** popover and background pages in a normal browser
with `@owlbear-rodeo/sdk` swapped for a small in-memory stand-in
([`src/harness/fakeObr.ts`](./src/harness/fakeObr.ts)). It reaches the parts
unit tests cannot: `window.open`, the `READY`/`HELLO` handshake, the
`SharedWorker` port hand-off, the background taking over after the popover
closes, and the importer/updater against a scene.

It does **not** replace the live-room checklist in
[`MANUAL-ACCEPTANCE.md`](./MANUAL-ACCEPTANCE.md). It models only the SDK
surface this extension touches, so a pass here says nothing about whether
Owlbear allows popups, provides `SharedWorker`, or how Draw Steel Tools
renders the metadata.

## Run it

### Site-initiated connection coverage

The site-link browser check uses the real app build and this harness's background
build at separate origins. In Playwright, route a test Owlbear room URL to a page
embedding the harness background in a sandboxed iframe (`allow-scripts
allow-same-origin`). Route a separate HTTPS extension origin to the harness
assets, and configure that origin's `malice-menagerie/url` preference to the
app's address before background startup. This preserves three distinct origins
and avoids a same-origin false positive. HTTPS routing also avoids mixed-content
and local-network blocking when a simulated HTTPS room embeds localhost assets.

Exercise **Settings → Integrations → Owlbear Rodeo → Connect to room** in the real app with those addresses.
Check that only the app and room tabs exist, then refresh each in turn. Require
a new **Paired** log entry and **Synchronized**, not just a stale status label.
Disconnect and refresh again to verify it stays disconnected. This passed in
Chromium; it does not establish compatibility with a live Owlbear room.

The unit tests in `src/integration/__tests__/siteLink.test.ts` cover origin/token
validation, popup failure, bounded discovery, healthy-connection preservation,
refresh recovery, and explicit disconnect.

Repeat refresh checks after **extension-initiated** pairing, with an independently
opened app tab. `sessionWorker.test.ts` covers channel forwarding, replacement
documents, the background's resume handshake, and revocation on disconnect.
Also test localhost addresses without substituting a fictitious production
host. The app and extension have separate Vite caches so concurrent development
servers do not invalidate each other's dependency bundles.

### Testing the actual SDK during room startup

`src/harness/real-sdk-room.html` is a room-message broker fixture for browser
tests. Route a test Owlbear room URL to it and serve the **real extension** at
the `extension` query parameter. It uses the installed Owlbear SDK, not the
`fakeObr` alias. `sdkDelay` (default 1000 ms) and `sceneDelay` (8000 ms) let the
SDK become ready well before the scene. Before scene readiness, scene reads
reject with a structured `{ error: { message: "Scene is not ready" } }` object.
This reproduces startup failures hidden by an always-ready SDK stub.

Verify site pairing and room reload while the scene is unavailable: the channel
must connect, show **Connected. Waiting for an Owlbear scene…**, then synchronize
when the scene becomes ready. No early item/metadata reads should reject without
being handled, and a scene failure must not close the channel. Localhost frames
may need browser local-network permission; browser test routing can provide the
localhost responses without claiming that permission was tested.

### Existing extension-initiated harness

```bash
pnpm build:obr-harness
python3 -m http.server 5189 --bind 127.0.0.1 --directory obr/harness-dist
```

Serve the harness build over HTTP/HTTPS (`bridge-worker.js` is resolved relative to the extension page URL; production hosting serves the extension under `/obr/`).

1. Open `http://127.0.0.1:5189/harness.html`. It hosts `background.html` in an
   iframe, the way Owlbear does.
2. In a second tab, open `http://127.0.0.1:5189/index.html` (the popover).
3. Expand **Advanced**, choose **Custom address** under **Malice server**, and set **Malice Menagerie address** to
   `http://127.0.0.1:5189/harness-malice.html` and press **Connect**.
4. The fake Malice window opens; the popover must report **Connected to
   Malice Menagerie**.

### Existing-tab hand-off

The harness fake Malice is a single window, so the hand-off to an already-open
tab needs the real app:

1. Run the app (`pnpm dev`) and open it in a normal tab, e.g.
   `http://127.0.0.1:5173/`.
2. Under **Advanced → Malice server → Custom address**, point **Malice Menagerie address** at that URL and
   press **Connect**.
3. Expected: the pairing tab closes itself, the tab you already had open shows
   **Send tokens** / **Synced** in the top bar (and **Synchronized.** in
   Settings → Integrations → Owlbear Rodeo), and its log
   (`localStorage["steel-table-owlbear-v1"].log`) contains
   `Adopted a connection handed off from another Malice Menagerie tab.`
   If the browser blocks `window.close()`, the pairing tab instead shows
   **Connected in another Malice Menagerie tab** and should be closed by hand.

The fake Malice window exposes `window.__malice` (`log`, `ping`, `sceneState`,
`importEncounter`, `updateStamina`, `focusCombatant`, `disconnect`). The background's scene is
readable from the harness tab:

```js
document.getElementById("background").contentWindow.__fakeScene;
```

`__malice.log` records the handshake, status changes, and events, so a failed
pairing can be read without the Owlbear devtools.

### Large sends and rate limits

The fake scene exposes `requests` (scene reads and add/update batch sizes) and
`rateLimit` (how many upcoming add/update requests should reject with
`Too many requests`). In the harness background frame, set
`__fakeScene.rateLimit.addItems = 1`, then import a large encounter once.
It should finish without a manual retry or duplicate tokens; new tokens are
added in batches of at most 50, with no separate metadata update per token.
Repeat the send to check that unchanged tokens do not trigger writes.

## What a pass proves

- `window.open` works, `READY` reaches the popover, and `HELLO` carries a port
  the fake Malice can use.
- The port reaches the background through `bridge-worker.js` (no
  `DataCloneError`), and the background owns it: close the popover tab and
  `__malice.ping()` still resolves.
- `CONNECT` with the pairing token returns a scene summary and emits
  `CONNECTED`; a wrong token is refused.
- `IMPORT_ENCOUNTER` creates one token per creature and per minion, mints the
  scene identity, writes Seamus monster/minion metadata, and places tokens on
  distinct grid cells. By default each token uses the public HTTPS circle
  image with centered native text. With **Use TooManyTokens artwork** enabled,
  mapped artwork is decoded before creation; unavailable or unmapped artwork
  falls back to initials. The image URL is a hosted asset, never an inline
  `data:` URL. Production extension hosting must be reachable from Owlbear.
- A Connect with an already-open app tab hands the port to that tab and closes
  the pairing tab instead of leaving a second copy of the app open. Closing or
  reloading the open tab first still works: the relay forgets a tab that does
  not answer and retries the next one.
- `RECONCILE_ENCOUNTER` creates nothing and keeps every token id.
- `UPDATE_COMBATANTS` changes Seamus Stamina, leaves temporary Stamina alone,
  keeps a squad's per-minion maximum from Malice even when extra tokens exist,
  and keeps a token name the GM changed in Owlbear while still following a
  rename in Malice for untouched tokens.
- `FOCUS_COMBATANT` centres the linked token bounds at the current zoom.
  The fake scene exposes `viewport` (position, scale, width, height) so the
  check can start from a panned/zoomed camera and assert actual centring,
  including repeated calls and whole squads; viewport animation is no longer
  a no-op in the harness.
- A silent Malice window is dropped after the liveness timeout instead of
  leaving the popover on a phantom **Connected**.
- `DISCONNECT` returns the popover to **Not connected**.

## Limits

- The fake SDK does not emit change events, so observer-driven
  `COMBATANT_UPDATED`/`TOKEN_DELETED`/`SELECTION_CHANGED` paths are only
  covered by unit tests and the live checklist.
- It has no iframe sandbox, no permissions, and no real scene rendering.
- It is a development build only: `pnpm build:obr` does not include it.

## Settings panel checks

- With cleared storage, the official Malice server is selected and TooManyTokens is off.
- Toggle artwork, reload the popover, and verify it stays selected. Import a new
  mapped creature and verify its image is from TooManyTokens; existing tokens keep
  their previous image. Switch off and import another creature: it must have initials
  and make no TooManyTokens artwork request.
- Verify the custom address saves on change, rejects non-HTTPS remote addresses,
  and stays disabled while connected. Disconnect to change servers.
- Verify the 360px panel and 320px narrow layout have no horizontal overflow.
  In a live room, change Owlbear's theme and verify the panel follows it.
- The harness supplies a light theme through the same API. Injecting dark theme
  variables verifies layout and contrast only; it does not prove live SDK theme events.

### Placeholder image hosting

Initials use a public HTTPS PNG (Twemoji black circle, v14.0.2) plus native
Owlbear text. Images must be readable by other hosted extensions and all players;
localhost, inline data and blob URLs cannot be stored as scene image URLs.
Re-sending an encounter repairs earlier `token-initials.svg` images in place,
including local development URLs, without changing token IDs or replacing them
with portraits. The harness validates URL selection and repair; live-room
verification is still required for each extension's image rendering.

The neutral circle is from [Twemoji](https://github.com/twitter/twemoji),
Copyright Twitter, Inc and other contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It is unmodified;
monster initials are rendered separately by Owlbear.
