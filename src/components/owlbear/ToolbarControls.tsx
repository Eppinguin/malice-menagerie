import {
  owlbearBusy,
  owlbearConnection,
  owlbearPanelOpen,
  owlbearPendingApproval,
  owlbearStore,
} from "../../integration/controller.ts";
import { encounterSyncSummary, mappingsFor } from "../../integration/identity.ts";
import { activeEncounter, sharedRollActive } from "../../store.ts";
import { DiceIcon, EyeOffIcon, SendIcon, SettingsIcon, SyncIcon } from "../Icons.tsx";
import { openSettingsPanel, toggleSettingsPanel } from "./panelFocus.ts";
import { sendTokenPress } from "./SendMenu.tsx";

/** Optional setup lives with the other app utilities. */
export function AppSettingsButton({
  collapsed = false,
  onOpen,
}: {
  collapsed?: boolean;
  onOpen?: () => void;
}) {
  const open = owlbearPanelOpen.value;
  return (
    <button
      type="button"
      class="spine-button app-settings"
      aria-label="Settings"
      title="Settings"
      aria-expanded={open}
      aria-controls={open ? "app-settings-panel" : undefined}
      onClick={(event) => {
        onOpen?.();
        toggleSettingsPanel(event.currentTarget);
      }}
    >
      <SettingsIcon />
      {!collapsed && <span>Settings</span>}
    </button>
  );
}

/** Compact Connected Dice status pill in the top bar whenever shared dice are enabled. */
export function OwlbearDiceButton() {
  const connection = owlbearConnection.value;
  const settings = connection.settings;
  if (
    !settings?.diceEnabled ||
    (connection.status !== "connected" && connection.status !== "synchronizing")
  )
    return null;
  const rolling = sharedRollActive.value;
  const unavailable = settings.diceStatus === "unavailable";
  const connecting = settings.diceStatus === "connecting";
  const gmOnly = settings.diceGmOnly;
  const label = rolling
    ? "Rolling…"
    : unavailable
      ? "Dice offline"
      : connecting
        ? "Dice…"
        : gmOnly
          ? "GM dice"
          : "Live dice";
  const title = rolling
    ? "Waiting for Connected Dice in Owlbear Rodeo — click to open settings or cancel"
    : unavailable
      ? "Connected Dice is unavailable — click to retry in settings"
      : connecting
        ? "Connecting to Connected Dice in Owlbear Rodeo…"
        : gmOnly
          ? "Connected Dice: rolls are private (GM only) in Owlbear — click to open Owlbear settings"
          : "Connected Dice: rolls are shared with players in Owlbear — click to open Owlbear settings";
  const tone = rolling ? " rolling" : unavailable ? " unavailable" : gmOnly ? " private" : "";
  return (
    <button
      type="button"
      class={`owlbear-dice-pill${tone}`}
      aria-busy={rolling || connecting}
      aria-label={title}
      title={title}
      onClick={(event) => openSettingsPanel(event.currentTarget)}
    >
      <DiceIcon />
      {gmOnly && !unavailable ? <EyeOffIcon class="owlbear-dice-badge" /> : null}
      <span class="owlbear-dice-label">{label}</span>
    </button>
  );
}

/** Active connections put the encounter's send action directly in the toolbar. */
export function OwlbearSendButton() {
  const connection = owlbearConnection.value;
  if (connection.status === "disconnected") return null;
  const connected = connection.status === "connected";
  const busy = owlbearBusy.value;
  const awaitingApproval = owlbearPendingApproval.value !== null;
  const syncing = !busy && connection.status === "synchronizing";
  const pending = busy || syncing;
  const connecting = connection.status === "connecting" && !awaitingApproval;
  const encounter = activeEncounter();
  const hasRoster = encounter.items.length > 0 || encounter.combat.instances.length > 0;
  const sceneId = connection.scene?.sceneReady ? connection.scene.sceneId : null;
  const mappings = sceneId ? mappingsFor(owlbearStore.value, encounter.id, sceneId) : [];
  const summary = encounterSyncSummary(encounter, mappings);
  const allSynced =
    connected && Boolean(sceneId) && summary.linkedInstances > 0 && summary.unsentTokens === 0;
  const pendingAdd =
    connected && Boolean(sceneId) && summary.linkedInstances > 0 && summary.unsentTokens > 0;
  const label = awaitingApproval
    ? "Confirm link"
    : busy
      ? "Sending…"
      : syncing
        ? "Syncing…"
        : connecting
          ? "Connecting…"
          : allSynced
            ? "Synced"
            : connected
              ? "Send tokens"
              : "Reconnect Owlbear";
  const disabled =
    !awaitingApproval &&
    (pending || connecting || (connected && (!connection.scene?.sceneReady || !hasRoster)));
  const canSend = connected && !disabled;
  const title =
    connected && !connection.scene?.sceneReady
      ? "Open a scene in Owlbear Rodeo before sending tokens."
      : connected && !hasRoster
        ? "Add monsters before sending tokens to Owlbear Rodeo."
        : allSynced
          ? "All encounter tokens are on the map — click to refresh, Shift+click, hold, or ArrowDown for options"
          : pendingAdd
            ? `Send ${summary.unsentTokens} new or missing token${summary.unsentTokens === 1 ? "" : "s"} to Owlbear Rodeo (Shift+click, hold, or ArrowDown for options)`
            : connected
              ? "Send this encounter's tokens to Owlbear Rodeo (Shift+click, hold, or ArrowDown for options)"
              : connection.detail;
  const press = sendTokenPress({
    enabled: canSend,
    hasLinked: summary.linkedInstances > 0,
    onFallbackClick: (invoker) => openSettingsPanel(invoker),
  });
  return (
    <button
      type="button"
      class={`owlbear-status ${connection.status}${allSynced ? " synced" : ""}`}
      disabled={disabled}
      aria-busy={pending || connecting}
      aria-haspopup={canSend ? "menu" : undefined}
      aria-label={
        allSynced
          ? "Owlbear Rodeo synced — click to refresh, Shift+click, hold, or ArrowDown for send options"
          : pendingAdd
            ? `Send ${summary.unsentTokens} pending tokens to Owlbear Rodeo (Shift+click, hold, or ArrowDown for options)`
            : connected && !pending
              ? "Send tokens to Owlbear Rodeo (Shift+click, hold, or ArrowDown for options)"
              : label
      }
      title={title}
      {...press}
    >
      {connected && !pending ? <SendIcon /> : <SyncIcon />}
      <span class="owlbear-status-label">{label}</span>
      {pendingAdd && !pending ? (
        <span class="owlbear-badge" aria-hidden="true">
          +{summary.unsentTokens}
        </span>
      ) : null}
    </button>
  );
}
