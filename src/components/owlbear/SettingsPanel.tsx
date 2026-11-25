import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { pageTheme, togglePageTheme } from "../../theme.ts";
import {
  approvePendingPairing,
  cancelSharedRoll,
  cleanupOrphanTokens,
  defeatedMappings,
  disconnectOwlbear,
  forgetTrustedOrigin,
  orphanedMappings,
  owlbearBusy,
  owlbearConnection,
  owlbearLog,
  owlbearPanelOpen,
  owlbearPendingApproval,
  owlbearSelectedInstanceId,
  owlbearStore,
  owlbearUnresolved,
  reconcileWithOwlbear,
  rejectPendingPairing,
  removeManualStatblock,
  renameOwlbearScene,
  restartReattachableMappings,
  retryConnectedDice,
  sendToOwlbear,
  setConnectedDiceGmOnly,
  setInverseSelection,
} from "../../integration/controller.ts";
import { mappingsFor } from "../../integration/identity.ts";
import type { ExtensionSettingsSummary } from "../../../shared/obr/protocol.ts";
import { activeEncounter, openImportDialog, sharedRollActive, state, toast } from "../../store.ts";
import { CloseIcon, DownloadIcon, ImportIcon } from "../Icons.tsx";
import { OwlbearConnectForm } from "./ConnectForm.tsx";
import { closeSettingsPanel } from "./panelFocus.ts";
import { isSendMenuOpen, sendTokenPress } from "./SendMenu.tsx";
import { StatblockPicker } from "./StatblockPicker.tsx";

function formatExtensionSettings(settings: ExtensionSettingsSummary): string {
  const rings = settings.ringsSync ? "Rings on" : "Rings off";
  const conditions =
    settings.conditionSync === "off"
      ? "Conditions off"
      : settings.conditionSync === "marked"
        ? "Marked!"
        : settings.conditionSync === "token-labels"
          ? "Token Labels"
          : "Conditions auto";
  const dice = !settings.diceEnabled
    ? "Dice off"
    : settings.diceStatus === "connected"
      ? settings.diceGmOnly
        ? "Dice private"
        : "Dice public"
      : settings.diceStatus === "connecting"
        ? "Dice connecting"
        : "Dice unavailable";
  return `${rings} · ${conditions} · ${dice}`;
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="owlbear-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function AppSettingsPanel() {
  const open = owlbearPanelOpen.value;
  const connection = owlbearConnection.value;
  const pendingApproval = owlbearPendingApproval.value;
  const store = owlbearStore.value;
  const busy = owlbearBusy.value;
  const unresolved = owlbearUnresolved.value;
  const panel = useRef<HTMLDivElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const renameFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showLog, setShowLog] = useState(false);
  const [renamingScene, setRenamingScene] = useState(false);
  const [sceneDraft, setSceneDraft] = useState("");
  const [savingScene, setSavingScene] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(
    () => connection.status !== "disconnected" || pendingApproval !== null,
  );

  useEffect(() => {
    if (connection.status !== "disconnected" || pendingApproval !== null) {
      setIntegrationOpen(true);
    }
  }, [connection.status, pendingApproval]);

  useEffect(() => {
    setRenamingScene(false);
  }, [connection.scene?.sceneId, open]);

  useEffect(() => {
    if (renamingScene) sceneInputRef.current?.focus();
  }, [renamingScene]);

  useEffect(() => {
    return () => {
      if (renameFocusTimer.current !== undefined) clearTimeout(renameFocusTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusTimer = setTimeout(
      () => panel.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      0,
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isSendMenuOpen()) return;
        event.stopPropagation();
        closeSettingsPanel(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target)) return;
      if (
        (target as Element).closest?.(
          ".owlbear-status, .app-settings, .owlbear-dice-pill, .owlbear-send-menu, .edge-menu-backdrop",
        )
      )
        return;
      closeSettingsPanel(false);
    };
    window.addEventListener("keydown", onKey);
    // A pointerdown outside the panel closes it, without trapping focus.
    const timer = setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
      clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!open) return null;
  const connected = connection.status === "connected" || connection.status === "synchronizing";
  const encounter = activeEncounter();
  const hasRoster = encounter.items.length > 0 || encounter.combat.instances.length > 0;
  const sceneId = connection.scene?.sceneReady ? connection.scene.sceneId : null;
  const linkedCount = sceneId
    ? mappingsFor(store, encounter.id, sceneId).filter(
        (entry) => !entry.missing && entry.tokenIds.length > 0,
      ).length
    : 0;
  const defeated = connected ? defeatedMappings() : [];
  const orphans = connected ? orphanedMappings() : [];
  const reattachable = connected ? restartReattachableMappings() : [];
  const selected = owlbearSelectedInstanceId.value;
  const selectedName = selected
    ? encounter.combat.instances.find((entry) => entry.id === selected)?.name
    : undefined;
  const manualStatblockEntries = Object.entries(store.manualStatblocks);
  const diceEnabled = Boolean(connected && connection.settings?.diceEnabled);
  const diceRolling = sharedRollActive.value;
  const cancelSceneRename = () => {
    setRenamingScene(false);
    if (renameFocusTimer.current !== undefined) clearTimeout(renameFocusTimer.current);
    renameFocusTimer.current = setTimeout(() => {
      renameFocusTimer.current = undefined;
      renameButtonRef.current?.focus();
    }, 0);
  };

  return (
    <div
      id="app-settings-panel"
      class="owlbear-panel"
      ref={panel}
      role="dialog"
      aria-labelledby="app-settings-title"
    >
      <header class="owlbear-panel-head">
        <div>
          <h2 id="app-settings-title">Settings</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Close settings"
          onClick={() => closeSettingsPanel(true)}
        >
          <CloseIcon />
        </button>
      </header>

      <div class="app-settings-body">
        <label class="app-settings-theme">
          <span>Night page</span>
          <input type="checkbox" checked={pageTheme.value === "night"} onChange={togglePageTheme} />
        </label>

        <section class="app-settings-data">
          <h3>Data &amp; Homebrew</h3>
          <p class="owlbear-hint small">
            {state.value.homebrewMonsters.length} homebrew{" "}
            {state.value.homebrewMonsters.length === 1 ? "monster" : "monsters"} ·{" "}
            {state.value.homebrewMalice.length} custom Malice · {state.value.encounters.length}{" "}
            {state.value.encounters.length === 1 ? "encounter" : "encounters"} ·{" "}
            {state.value.negotiations.length}{" "}
            {state.value.negotiations.length === 1 ? "NPC" : "NPCs"}
          </p>
          <div class="app-settings-data-actions">
            <button
              type="button"
              class="secondary compact-button"
              onClick={() => {
                closeSettingsPanel(true);
                openImportDialog();
              }}
            >
              <ImportIcon />
              <span>Import file or link</span>
            </button>
            <button
              type="button"
              class="secondary compact-button"
              disabled={
                state.value.homebrewMonsters.length === 0 && state.value.homebrewMalice.length === 0
              }
              onClick={() => {
                void import("../../lib/share.ts").then(
                  ({ buildPackBundle, downloadBundleJson }) => {
                    downloadBundleJson(
                      buildPackBundle(state.value, "homebrew"),
                      "malice-homebrew-pack",
                    );
                    toast("Exported homebrew pack (.json)");
                  },
                );
              }}
            >
              <DownloadIcon />
              <span>Export homebrew</span>
            </button>
            <button
              type="button"
              class="secondary compact-button"
              onClick={() => {
                void import("../../lib/share.ts").then(
                  ({ buildPackBundle, downloadBundleJson }) => {
                    downloadBundleJson(
                      buildPackBundle(state.value, "all"),
                      "malice-menagerie-backup",
                    );
                    toast("Exported full backup (.json)");
                  },
                );
              }}
            >
              <DownloadIcon />
              <span>Full backup</span>
            </button>
          </div>
        </section>

        <section class="app-settings-integrations">
          <h3>Integrations</h3>
          <details
            class="app-settings-integration"
            open={integrationOpen}
            onToggle={(event) => setIntegrationOpen(event.currentTarget.open)}
          >
            <summary>Owlbear Rodeo</summary>
            <div class="owlbear-panel-body">
              <p class="owlbear-hint" role="status" aria-live="polite">
                {connection.detail}
              </p>

              {pendingApproval ? (
                <section
                  class="owlbear-approval"
                  role="alertdialog"
                  aria-label="Confirm extension origin"
                >
                  <p>
                    An external extension at{" "}
                    <code class="owlbear-origin">{pendingApproval.origin}</code> wants to pair with
                    Malice Menagerie. Only approve if you installed this extension yourself.
                  </p>
                  <div class="owlbear-actions">
                    <button type="button" class="primary" onClick={() => approvePendingPairing()}>
                      Approve &amp; trust
                    </button>
                    <button type="button" class="secondary" onClick={() => rejectPendingPairing()}>
                      Decline
                    </button>
                  </div>
                </section>
              ) : null}

              {connection.scene ? (
                <div class="owlbear-scene">
                  {renamingScene ? (
                    <form
                      class="owlbear-scene-edit"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelSceneRename();
                        }
                      }}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        setSavingScene(true);
                        const ok = await renameOwlbearScene(sceneDraft);
                        setSavingScene(false);
                        if (ok) cancelSceneRename();
                      }}
                    >
                      <input
                        ref={sceneInputRef}
                        type="text"
                        maxLength={80}
                        value={sceneDraft}
                        disabled={savingScene}
                        placeholder="Scene nickname (blank to reset)"
                        aria-label="Scene nickname"
                        onInput={(event) => setSceneDraft(event.currentTarget.value)}
                      />
                      <button class="secondary compact-button" type="submit" disabled={savingScene}>
                        Save
                      </button>
                      <button
                        class="text-button"
                        type="button"
                        disabled={savingScene}
                        onClick={cancelSceneRename}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <Row label="Scene">
                      <span class="owlbear-scene-label">
                        {connection.scene.label || "Untitled scene"}
                      </span>
                      {connected && connection.scene.sceneReady ? (
                        <button
                          ref={renameButtonRef}
                          class="text-button owlbear-scene-rename"
                          type="button"
                          onClick={() => {
                            const current = connection.scene?.label ?? "";
                            setSceneDraft(current.startsWith("Owlbear scene ") ? "" : current);
                            setRenamingScene(true);
                          }}
                        >
                          Rename
                        </button>
                      ) : null}
                    </Row>
                  )}
                  <Row label="Linked">{linkedCount}</Row>
                  {connection.settings ? (
                    <Row label="Sync">
                      <span
                        title={`${formatExtensionSettings(connection.settings)} — change these in the Owlbear extension popover`}
                      >
                        {formatExtensionSettings(connection.settings)}
                      </span>
                    </Row>
                  ) : null}
                  {connection.extensionVersion ? (
                    <Row label="Extension">{connection.extensionVersion}</Row>
                  ) : null}
                  {connection.origin ? (
                    <Row label="Paired with">
                      <span class="owlbear-origin">{connection.origin}</span>
                    </Row>
                  ) : null}
                </div>
              ) : null}

              {!connected ? (
                <>
                  <p class="owlbear-hint">
                    Playing on Owlbear Rodeo? Connect your room to send encounter tokens and keep
                    them in sync.
                  </p>
                  <OwlbearConnectForm />
                </>
              ) : !connection.scene?.sceneReady ? (
                <p class="owlbear-hint">Open a scene in Owlbear Rodeo before sending tokens.</p>
              ) : null}

              {connection.progress ? (
                <p class="owlbear-progress" role="status" aria-live="polite">
                  Sending {connection.progress.done} of {connection.progress.total}…
                </p>
              ) : null}

              {connection.lastError ? (
                <p class="owlbear-error" role="alert">
                  {connection.lastError}
                </p>
              ) : null}

              {connected ? (
                <>
                  <div class="owlbear-actions">
                    <button
                      type="button"
                      class="primary"
                      aria-haspopup="menu"
                      disabled={
                        connection.status !== "connected" ||
                        !connection.scene?.sceneReady ||
                        !hasRoster ||
                        busy
                      }
                      title={
                        hasRoster
                          ? "Send tokens (Shift+click, hold, or ArrowDown for options)"
                          : "Add monsters before sending tokens to Owlbear Rodeo."
                      }
                      {...sendTokenPress({
                        enabled:
                          connection.status === "connected" &&
                          Boolean(connection.scene?.sceneReady) &&
                          hasRoster &&
                          !busy,
                        hasLinked: linkedCount > 0,
                      })}
                    >
                      {busy ? "Sending tokens…" : "Send tokens"}
                    </button>

                    <button
                      type="button"
                      class="secondary"
                      disabled={busy}
                      onClick={() => void disconnectOwlbear()}
                    >
                      Disconnect
                    </button>
                  </div>

                  {reattachable.length ? (
                    <p class="owlbear-hint small">
                      Combat restarted — press Send tokens to reattach {reattachable.length}{" "}
                      existing {reattachable.length === 1 ? "combatant" : "combatants"} to the new
                      roster.
                    </p>
                  ) : null}

                  <p class="owlbear-hint small">
                    Sending is additive: it creates missing tokens and updates linked ones. Hold,
                    right-click, or Shift+click Send tokens to spawn new tokens hidden.
                  </p>
                </>
              ) : null}

              {diceEnabled ? (
                <section class="owlbear-section">
                  <h4>Connected Dice</h4>
                  <label class="owlbear-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(connection.settings?.diceGmOnly)}
                      onChange={(event) => void setConnectedDiceGmOnly(event.currentTarget.checked)}
                    />
                    <span>Roll privately (GM only)</span>
                  </label>
                  {diceRolling || connection.settings?.diceStatus === "unavailable" ? (
                    <div class="owlbear-actions">
                      {diceRolling ? (
                        <button
                          class="secondary"
                          type="button"
                          onClick={() => void cancelSharedRoll()}
                        >
                          Cancel pending roll
                        </button>
                      ) : null}
                      {connection.settings?.diceStatus === "unavailable" ? (
                        <button
                          class="secondary"
                          type="button"
                          onClick={() => void retryConnectedDice()}
                        >
                          Retry dice
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {connected ? (
                <details class="owlbear-section">
                  <summary>Sync options</summary>
                  <p class="owlbear-hint small">
                    Send new tokens hidden for ambushes, or refresh linked tokens without creating
                    any new ones.
                  </p>
                  <div class="owlbear-actions">
                    <button
                      type="button"
                      class="secondary"
                      disabled={
                        connection.status !== "connected" ||
                        !connection.scene?.sceneReady ||
                        !hasRoster ||
                        busy
                      }
                      onClick={() => void sendToOwlbear({ hidden: true })}
                    >
                      Send hidden
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      disabled={
                        connection.status !== "connected" ||
                        !connection.scene?.sceneReady ||
                        !hasRoster ||
                        linkedCount === 0 ||
                        busy
                      }
                      onClick={() => void reconcileWithOwlbear()}
                    >
                      Update linked tokens
                    </button>
                  </div>
                </details>
              ) : null}

              {connected && unresolved.length ? (
                <section class="owlbear-section">
                  <h4>
                    Statblocks needing a choice <span>{unresolved.length}</span>
                  </h4>
                  <p class="owlbear-hint small">
                    These creatures are sent without a Draw Steel Tools statblock until you pick
                    one. The choice is remembered.
                  </p>
                  <ul class="owlbear-unresolved-list">
                    {unresolved.map((entry) => (
                      <StatblockPicker key={entry.key} entry={entry} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {defeated.length ? (
                <section class="owlbear-section">
                  <div class="owlbear-section-head">
                    <h4>
                      Defeated tokens on map <span>{defeated.length}</span>
                    </h4>
                    {defeated.length > 1 ? (
                      <button
                        type="button"
                        class="text-button"
                        disabled={busy}
                        onClick={() =>
                          void cleanupOrphanTokens(defeated.map((entry) => entry.instanceId))
                        }
                      >
                        Remove all
                      </button>
                    ) : null}
                  </div>
                  <p class="owlbear-hint small">
                    These combatants are at 0 Stamina but still have tokens on the map.
                  </p>
                  <ul class="owlbear-orphans">
                    {defeated.map((entry) => (
                      <li key={entry.instanceId}>
                        <span>{entry.name}</span>
                        <button
                          type="button"
                          class="text-button"
                          aria-label={`Remove token for ${entry.name}`}
                          disabled={busy}
                          onClick={() => void cleanupOrphanTokens([entry.instanceId])}
                        >
                          Remove token
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {orphans.length ? (
                <section class="owlbear-section">
                  <div class="owlbear-section-head">
                    <h4>
                      Tokens with no combatant <span>{orphans.length}</span>
                    </h4>
                    {orphans.length > 1 ? (
                      <button
                        type="button"
                        class="text-button"
                        disabled={busy}
                        onClick={() =>
                          void cleanupOrphanTokens(orphans.map((entry) => entry.instanceId))
                        }
                      >
                        Remove all
                      </button>
                    ) : null}
                  </div>
                  <p class="owlbear-hint small">
                    These tokens belong to an earlier roster. They are left alone unless you remove
                    them.
                  </p>
                  <ul class="owlbear-orphans">
                    {orphans.map((entry) => (
                      <li key={entry.instanceId}>
                        <span>{entry.name}</span>
                        <button
                          type="button"
                          class="text-button"
                          aria-label={`Remove unlinked token for ${entry.name}`}
                          disabled={busy}
                          onClick={() => void cleanupOrphanTokens([entry.instanceId])}
                        >
                          Remove token
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {connected ? (
                <section class="owlbear-section">
                  <label class="owlbear-toggle">
                    <input
                      type="checkbox"
                      checked={store.inverseSelection}
                      onChange={(event) => setInverseSelection(event.currentTarget.checked)}
                    />
                    <span>Follow Owlbear selection in Malice</span>
                  </label>
                  <p class="owlbear-hint small">
                    While this is on, selecting a token in Owlbear scrolls its card into view. It
                    never changes which combatant is active.
                  </p>
                </section>
              ) : null}

              <details class="owlbear-section">
                <summary>Advanced settings</summary>
                {manualStatblockEntries.length ? (
                  <section class="owlbear-section">
                    <h5>Saved statblock choices</h5>
                    <ul class="owlbear-origins">
                      {manualStatblockEntries.map(([key, ref]) => (
                        <li key={key}>
                          <span class="owlbear-origin" title={key}>
                            {ref.name}
                          </span>
                          <button
                            type="button"
                            class="text-button"
                            aria-label={`Forget saved statblock ${ref.name}`}
                            onClick={() => removeManualStatblock(key)}
                          >
                            Forget
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {store.trustedOrigins.length ? (
                  <section class="owlbear-section">
                    <h5>Trusted origins</h5>
                    <ul class="owlbear-origins">
                      {store.trustedOrigins.map((origin) => (
                        <li key={origin}>
                          <span class="owlbear-origin">{origin}</span>
                          <button
                            type="button"
                            class="text-button"
                            aria-label={`Forget trusted origin ${origin}`}
                            onClick={() => forgetTrustedOrigin(origin)}
                          >
                            Forget
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section class="owlbear-section">
                  <button
                    type="button"
                    class="text-button"
                    aria-expanded={showLog}
                    onClick={() => setShowLog((value) => !value)}
                  >
                    {showLog ? "Hide" : "Show"} connection log
                  </button>
                  {showLog ? (
                    <pre class="owlbear-log" tabIndex={0}>
                      {owlbearLog.value.join("\n") || "No activity yet."}
                    </pre>
                  ) : null}
                </section>
              </details>

              {!connected ? (
                <p class="owlbear-hint small">
                  {encounter.combat.instances.length
                    ? "The roster is ready. Connect to send it to the map."
                    : "Add creatures in Prep, then connect to send them to the map."}
                </p>
              ) : selectedName ? (
                <p class="owlbear-hint small">Last selected: {selectedName}</p>
              ) : null}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
