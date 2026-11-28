import type { DiceState } from "./dice.ts";
import OBR, { type Theme } from "@owlbear-rodeo/sdk";
import {
  conditionSyncMode,
  saveConditionSyncMode,
  saveRingsSync,
  saveTokenArtwork,
  usesRingsSync,
  usesTokenArtwork,
  type ConditionSyncMode,
} from "./settings.ts";
import {
  CONNECT_QUERY_PARAM,
  CONNECT_QUERY_VALUE,
  HELLO_MESSAGE_TYPE,
  MALICE_WINDOW_NAME,
  PAIRING_ORIGIN_PARAM,
  PAIRING_TOKEN_PARAM,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isReadyMessage,
  makeReadyRequestMessage,
  newMessageId,
  parseAllowedOrigin,
  type HelloMessage,
} from "../../shared/obr/protocol.ts";
import {
  BRIDGE_WORKER_NAME,
  DEFAULT_MALICE_URL,
  EXTENSION_VERSION,
  MALICE_URL_STORAGE_KEY,
  OFFICIAL_MALICE_URL,
  bridgeChannelName,
  bridgeWorkerUrl,
} from "./config.ts";
import { registerExtensionWorker } from "./serviceWorker.ts";

registerExtensionWorker();

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const dot = $("status-dot");
const statusText = $("status-text");
const statusDetail = $("status-detail");
const urlInput = $<HTMLInputElement>("malice-url");
const connectButton = $<HTMLButtonElement>("connect");
const openButton = $<HTMLButtonElement>("open");
const cancelButton = $<HTMLButtonElement>("cancel");
const disconnectButton = $<HTMLButtonElement>("disconnect");
const advancedDetails = document.querySelector<HTMLDetailsElement>("details.advanced");
const errorBox = $("error");
const diceStatus = $("dice-status");
const diceConnect = $<HTMLButtonElement>("dice-connect");
const diceDisconnect = $<HTMLButtonElement>("dice-disconnect");
const diceGmOnly = $<HTMLInputElement>("dice-gm-only");
const diceStyle = $<HTMLSelectElement>("dice-style");
const diceThemeHelp = $("dice-theme-help");
const playerOnly = $("player-only");
const gmControls = $("gm-controls");

const server = $<HTMLSelectElement>("server");
const customServer = $("custom-server");
const tokenArtwork = $<HTMLInputElement>("token-artwork");
const tokenHelp = $("token-help");
const tokenPreview = $("token-preview");
const ringsSync = $<HTMLInputElement>("rings-sync");
const ringsHelp = $("rings-help");
const conditionSync = $<HTMLSelectElement>("condition-sync");
const conditionHelp = $("condition-help");
const syncFeedback = $("sync-feedback");

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset["theme"] = theme.mode;
  const values = {
    "--page": theme.background.default,
    "--paper": theme.background.paper,
    "--ink": theme.text.primary,
    "--secondary": theme.text.secondary,
    "--accent": theme.primary.main,
    "--on-accent": theme.primary.contrastText,
    "--rule": `color-mix(in srgb, ${theme.text.primary} 23%, ${theme.background.default})`,
  };
  for (const [key, value] of Object.entries(values)) root.style.setProperty(key, value);
}

function renderArtwork(): void {
  const enabled = tokenArtwork.checked;
  tokenPreview.hidden = enabled;
  tokenHelp.textContent = enabled
    ? "New tokens use TooManyTokens artwork. Initials are used if artwork is unavailable."
    : "New tokens use monster initials. No TooManyTokens artwork is loaded.";
}
tokenArtwork.checked = usesTokenArtwork();
renderArtwork();
tokenArtwork.addEventListener("change", () => {
  const saved = saveTokenArtwork(tokenArtwork.checked);
  if (!saved) tokenArtwork.checked = usesTokenArtwork();
  renderArtwork();
  $("settings-feedback").textContent = saved
    ? "Token preference saved."
    : "Could not save this preference. Allow browser storage and try again.";
});

const CONDITION_HELP: Record<ConditionSyncMode, string> = {
  auto: "Uses Marked! when configured in this room, otherwise Token Labels.",
  marked: "Always syncs Draw Steel conditions as Marked! markers.",
  "token-labels": "Always syncs Draw Steel conditions as Token Labels.",
  off: "Conditions stay in Malice without creating or reading map labels.",
};

function renderSync(): void {
  ringsHelp.textContent = ringsSync.checked
    ? "Activation groups, turns, and rounds sync with Rings Initiative."
    : "Off by default so rooms without Rings Initiative stay ring-free.";
  const mode = conditionSync.value as ConditionSyncMode;
  conditionHelp.textContent = CONDITION_HELP[mode] ?? CONDITION_HELP.auto;
}
ringsSync.checked = usesRingsSync();
conditionSync.value = conditionSyncMode();
renderSync();
ringsSync.addEventListener("change", () => {
  const saved = saveRingsSync(ringsSync.checked);
  if (!saved) ringsSync.checked = usesRingsSync();
  renderSync();
  syncFeedback.textContent = saved
    ? "Rings Initiative preference saved."
    : "Could not save this preference. Allow browser storage and try again.";
  if (saved) bridge?.postMessage({ type: "SETTINGS_CHANGED", setting: "rings" });
});
conditionSync.addEventListener("change", () => {
  const mode = conditionSync.value as ConditionSyncMode;
  const saved = saveConditionSyncMode(mode);
  if (!saved) conditionSync.value = conditionSyncMode();
  renderSync();
  syncFeedback.textContent = saved
    ? "Condition sync preference saved."
    : "Could not save this preference. Allow browser storage and try again.";
  if (saved) bridge?.postMessage({ type: "SETTINGS_CHANGED", setting: "conditions" });
});

const defaultServerOption = server.querySelector<HTMLOptionElement>('option[value="official"]');
const isSelfHostedDefault = DEFAULT_MALICE_URL !== OFFICIAL_MALICE_URL;
if (defaultServerOption && isSelfHostedDefault) {
  defaultServerOption.textContent = "This site (default)";
}

function renderServer(): void {
  customServer.hidden = server.value !== "custom";
  // An active pairing is bound to the selected origin.
  server.disabled = connected || pairing !== null;
  urlInput.disabled = connected || pairing !== null;
  $("server-help").textContent =
    connected || pairing !== null
      ? "Disconnect before changing servers."
      : isSelfHostedDefault
        ? `Defaulting to ${DEFAULT_MALICE_URL}. Choose a custom address only to pair with another host.`
        : "The official app is ready to use. Choose a custom address only for self-hosting or development.";
}
server.addEventListener("change", () => {
  renderServer();
  urlInput.removeAttribute("aria-invalid");
  if (server.value === "official") {
    saveUrl();
    setError(null);
  } else {
    urlInput.focus();
  }
});
urlInput.addEventListener("change", () => {
  if (!maliceUrl()) {
    urlInput.setAttribute("aria-invalid", "true");
    $("server-feedback").textContent = "Enter an HTTPS address, or HTTP for localhost development.";
    return;
  }
  urlInput.removeAttribute("aria-invalid");
  saveUrl();
});

let lastDiceStyleSig = "";

function renderDice(state: DiceState): void {
  diceStatus.textContent = state.detail;
  diceConnect.disabled = state.status === "connecting" || state.status === "connected";
  diceConnect.textContent =
    state.status === "connecting"
      ? "Connecting…"
      : state.status === "unavailable"
        ? "Retry dice"
        : "Connect dice";
  diceDisconnect.hidden = !state.enabled;
  diceGmOnly.checked = Boolean(state.gmOnly);
  diceGmOnly.disabled = !state.enabled;
  diceStyle.disabled = state.status !== "connected";
  const hasSavedExtra = Boolean(
    state.styleId && !state.styles.some((style) => style.id === state.styleId),
  );
  const styleSig = `${state.styles.map((s) => s.id).join("\n")}|${hasSavedExtra ? state.styleId : ""}`;
  if (styleSig !== lastDiceStyleSig) {
    lastDiceStyleSig = styleSig;
    const options = [
      new Option("Roller default", ""),
      ...state.styles.map((style) => new Option(style.id.replace(/[-_]/g, " "), style.id)),
    ];
    if (hasSavedExtra)
      options.push(new Option(`${state.styleId.replace(/[-_]/g, " ")} (saved)`, state.styleId));
    diceStyle.replaceChildren(...options);
  }
  diceStyle.value = state.styleId;
  diceThemeHelp.textContent =
    state.status === "connected"
      ? state.gmOnly
        ? "Applies to private GM rolls made from Malice. Saved for this room on this browser."
        : "Applies to public rolls made from Malice. Saved for this room on this browser."
      : "Connect dice to choose from the roller’s available themes.";
}

diceConnect.addEventListener("click", () => bridge?.postMessage({ type: "DICE_CONNECT" }));
diceDisconnect.addEventListener("click", () => bridge?.postMessage({ type: "DICE_DISCONNECT" }));
diceGmOnly.addEventListener("change", () =>
  bridge?.postMessage({ type: "DICE_GM_ONLY", gmOnly: diceGmOnly.checked }),
);
diceStyle.addEventListener("change", () =>
  bridge?.postMessage({ type: "DICE_STYLE", styleId: diceStyle.value }),
);

interface Pairing {
  popup: Window;
  origin: string;
  token: string;
  sessionId: string;
  attempts: number;
  readyTimer?: ReturnType<typeof setInterval>;
  timeout?: ReturnType<typeof setTimeout>;
  hello: boolean;
}

let pairing: Pairing | null = null;
let backgroundReady = false;
let connected = false;
let roomId = "";
let bridge: BroadcastChannel | null = null;
let workerPort: MessagePort | null = null;
let workerError: string | null = null;
let handoffTimer: ReturnType<typeof setTimeout> | undefined;

function setIdleStatus(detail = "Connect to send your encounter to this scene."): void {
  dot.dataset["status"] = "disconnected";
  statusText.textContent = "Not connected";
  statusDetail.textContent = detail;
}

function bridgeHandler(): void {
  bridge?.close();
  bridge = null;
  try {
    bridge = new BroadcastChannel(bridgeChannelName(roomId));
  } catch {
    setError(
      "This browser blocked extension storage inside Owlbear Rodeo. Allow third-party storage for this extension, or connect from Malice’s Settings panel.",
    );
    return;
  }
  bridge.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const record = data as Record<string, unknown>;
    if (
      record["type"] === "DICE_STATUS" &&
      typeof record["state"] === "object" &&
      record["state"] !== null
    ) {
      renderDice(record["state"] as DiceState);
      return;
    }
    if (record["type"] === "BACKGROUND_READY") {
      backgroundReady = true;
      bridge?.postMessage({ type: "DICE_STATUS_REQUEST" });
      return;
    }
    if (record["type"] !== "STATUS") return;
    const status = String(record["status"] ?? "disconnected");
    const detail = String(record["detail"] ?? "");
    // Ignore an early idle STATUS reply while the user is actively pairing.
    if (status === "disconnected" && pairing !== null && !pairing.hello) return;
    connected = status === "connected";
    if (connected) {
      errorBox.hidden = true;
      stopPairing();
    } else if (status === "error") {
      // Stop the pending pairing/handoff timers without overwriting the
      // background's real error message.
      stopPairing();
    }
    dot.dataset["status"] = status;
    statusText.textContent =
      status === "connected"
        ? "Connected to Malice Menagerie"
        : status === "connecting"
          ? "Waiting for Malice Menagerie"
          : status === "error"
            ? "Connection problem"
            : "Not connected";
    const scene = record["scene"] as { label?: string } | null | undefined;
    statusDetail.textContent = [detail, scene?.label].filter(Boolean).join(" · ");
    // A stale "connecting" from an abandoned pairing must not lock the button;
    // pressing Connect replaces the pending host anyway.
    connectButton.disabled = connected || pairing !== null;
    renderServer();
    disconnectButton.hidden =
      status !== "connected" && !(status === "connecting" && pairing === null);
  };
}

function startWorker(): void {
  try {
    const worker = new SharedWorker(bridgeWorkerUrl(), { name: BRIDGE_WORKER_NAME });
    worker.onerror = () => {
      workerError =
        "The connection worker could not load. Reload the extension and try Connect again.";
      workerPort = null;
      setError(workerError);
      stopPairing();
    };
    worker.port.start();
    workerPort = worker.port;
  } catch (error) {
    workerPort = null;
    workerError = error instanceof Error ? error.message : String(error);
  }
}

function setError(message: string | null): void {
  errorBox.hidden = !message;
  errorBox.textContent = message ?? "";
  if (message) {
    dot.dataset["status"] = "error";
    statusText.textContent = "Could not connect";
    statusDetail.textContent = "Follow the steps below, then try Connect again.";
  } else if (!connected && pairing === null && dot.dataset["status"] === "error") {
    setIdleStatus();
  }
}

function maliceUrl(): URL | null {
  const raw = server.value === "official" ? DEFAULT_MALICE_URL : urlInput.value.trim();
  if (!raw) return null;
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  if (!parseAllowedOrigin(candidate)) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function saveUrl(): void {
  try {
    localStorage.setItem(MALICE_URL_STORAGE_KEY, maliceUrl()?.toString() ?? DEFAULT_MALICE_URL);
    $("server-feedback").textContent = connected
      ? "Saved. Disconnect and reconnect to change servers."
      : "Server preference saved.";
  } catch {
    $("server-feedback").textContent =
      "Could not save this address. Allow browser storage and try again.";
  }
}

function focusInvalidServerUrl(): void {
  if (advancedDetails) advancedDetails.open = true;
  server.value = "custom";
  renderServer();
  urlInput.setAttribute("aria-invalid", "true");
  urlInput.focus();
}

function stopPairing(): void {
  connectButton.disabled = connected;
  connectButton.textContent = "Connect";
  cancelButton.hidden = true;
  if (pairing) {
    if (pairing.readyTimer !== undefined) clearInterval(pairing.readyTimer);
    if (pairing.timeout !== undefined) clearTimeout(pairing.timeout);
    pairing = null;
  }
  if (handoffTimer !== undefined) {
    clearTimeout(handoffTimer);
    handoffTimer = undefined;
  }
  renderServer();
}

function startPairing(): void {
  setError(null);
  const url = maliceUrl();
  if (!url) {
    setError("Enter an http://localhost or https:// address for Malice Menagerie.");
    focusInvalidServerUrl();
    return;
  }
  urlInput.removeAttribute("aria-invalid");
  if (!workerPort) {
    setError(
      `This browser could not start the extension worker${
        workerError ? ` (${workerError})` : ""
      }, so Connect from this panel is unavailable. Connect from Malice’s Settings → Integrations → Owlbear Rodeo panel instead, or use a browser with SharedWorker support.`,
    );
    return;
  }
  saveUrl();
  const token = newMessageId();
  const sessionId = newMessageId();
  // Pass pairing parameters in the URL fragment so the one-time token never
  // hits server access logs or Referer headers.
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set(CONNECT_QUERY_PARAM, CONNECT_QUERY_VALUE);
  hash.set(PAIRING_TOKEN_PARAM, token);
  hash.set(PAIRING_ORIGIN_PARAM, window.location.origin);
  url.hash = hash.toString();

  const popup = window.open(url.toString(), MALICE_WINDOW_NAME);
  if (!popup) {
    setError(
      "Owlbear blocked the window. Allow pop-ups for Owlbear Rodeo, then press Connect again.",
    );
    return;
  }
  popup.focus();

  stopPairing();
  pairing = {
    popup,
    origin: url.origin,
    token,
    sessionId,
    attempts: 0,
    hello: false,
  };
  connectButton.disabled = true;
  cancelButton.hidden = false;
  disconnectButton.hidden = true;
  renderServer();
  connectButton.textContent = "Connecting…";
  dot.dataset["status"] = "connecting";
  statusText.textContent = "Opening Malice Menagerie…";
  statusDetail.textContent = "Waiting for the app to answer.";
  // Ask an already-open window to acknowledge; a freshly opened one also
  // sends READY on load. Both paths are idempotent.
  const ask = () => {
    if (!pairing) return;
    pairing.attempts += 1;
    try {
      pairing.popup.postMessage(makeReadyRequestMessage(pairing.token), pairing.origin);
    } catch {
      setError("The Malice window is not reachable.");
      stopPairing();
      return;
    }
    if (pairing.popup.closed) {
      setError("The Malice window closed before pairing finished.");
      stopPairing();
    }
  };
  ask();
  pairing.readyTimer = setInterval(ask, 500);
  pairing.timeout = setTimeout(() => {
    if (!pairing) return;
    setError(
      "Malice Menagerie did not answer. Check the address, open the app once, then press Connect again.",
    );
    stopPairing();
  }, 30_000);
}

function sendHello(active: Pairing): void {
  if (active.hello || !workerPort) return;
  active.hello = true;
  if (active.readyTimer !== undefined) clearInterval(active.readyTimer);
  if (active.timeout !== undefined) clearTimeout(active.timeout);

  const hello: HelloMessage = {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: HELLO_MESSAGE_TYPE,
    sessionId: active.sessionId,
    pairingToken: active.token,
    extensionVersion: EXTENSION_VERSION,
  };

  // The background is the long-lived endpoint, so the Malice end of the
  // channel goes straight to it through the shared worker. The popover keeps
  // no copy: it may be unmounted at any moment.
  const channel = new MessageChannel();
  try {
    active.popup.postMessage(hello, active.origin, [channel.port1]);
    workerPort.postMessage(
      {
        type: "bridge",
        roomId,
        sessionId: active.sessionId,
        pairingToken: active.token,
      },
      [channel.port2],
    );
  } catch {
    setError("The Malice window could not accept the connection.");
    channel.port1.close();
    channel.port2.close();
    stopPairing();
    return;
  }

  statusText.textContent = "Paired — finishing handshake…";
  statusDetail.textContent = "Confirm any prompt in Malice Menagerie to finish connecting.";
  handoffTimer = setTimeout(() => {
    handoffTimer = undefined;
    if (connected || !pairing) return;
    setError(
      backgroundReady
        ? "Connection timed out. Confirm any prompt in Malice Menagerie, then press Connect again."
        : "The extension background is not running. Reload the extension in Owlbear, then press Connect again.",
    );
    stopPairing();
  }, 30_000);
}

window.addEventListener("message", (event) => {
  if (!pairing || event.origin !== pairing.origin) return;
  if (event.source !== pairing.popup) return;
  if (!isReadyMessage(event.data)) return;
  sendHello(pairing);
});

connectButton.addEventListener("click", startPairing);

cancelButton.addEventListener("click", () => {
  stopPairing();
  setError(null);
  setIdleStatus("Pairing cancelled. Press Connect to try again.");
});

openButton.addEventListener("click", () => {
  const url = maliceUrl();
  if (!url) {
    $("server-feedback").textContent =
      "Enter an http://localhost or https:// address for Malice Menagerie.";
    focusInvalidServerUrl();
    return;
  }
  urlInput.removeAttribute("aria-invalid");
  if (!connected) saveUrl();
  const opened = window.open(url.toString(), MALICE_WINDOW_NAME);
  if (!opened) {
    errorBox.hidden = false;
    errorBox.textContent =
      "Owlbear blocked the window. Allow pop-ups for Owlbear Rodeo to open Malice Menagerie.";
  } else {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
});

disconnectButton.addEventListener("click", () => {
  connected = false;
  stopPairing();
  errorBox.hidden = true;
  errorBox.textContent = "";
  setIdleStatus("Disconnected.");
  connectButton.disabled = false;
  disconnectButton.hidden = true;
  bridge?.postMessage({ type: "DISCONNECT" });
});

let gmInitialized = false;

function initGmPopover(): void {
  if (gmInitialized) return;
  gmInitialized = true;
  playerOnly.hidden = true;
  gmControls.hidden = false;
  roomId = OBR.room.id;
  bridgeHandler();
  startWorker();
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MALICE_URL_STORAGE_KEY);
  } catch {
    /* Optional preference. */
  }
  urlInput.value = stored && stored.replace(/\/$/, "") !== DEFAULT_MALICE_URL ? stored : "";
  server.value = urlInput.value ? "custom" : "official";
  renderServer();
  bridge?.postMessage({ type: "PING_BACKGROUND" });
  bridge?.postMessage({ type: "STATUS_REQUEST" });
  bridge?.postMessage({ type: "DICE_STATUS_REQUEST" });
  connectButton.disabled = false;
}

function teardownGmPopover(): void {
  if (!gmInitialized) return;
  gmInitialized = false;
  stopPairing();
  bridge?.close();
  bridge = null;
  workerPort?.close();
  workerPort = null;
  backgroundReady = false;
  connected = false;
  playerOnly.hidden = false;
  gmControls.hidden = true;
}

OBR.onReady(async () => {
  void OBR.theme
    .getTheme()
    .then(applyTheme)
    .catch(() => {
      /* Keep the system theme fallback. */
    });
  OBR.theme.onChange(applyTheme);
  const role = typeof OBR.player.getRole === "function" ? await OBR.player.getRole() : "GM";
  if (role === "GM") {
    initGmPopover();
  } else {
    playerOnly.hidden = false;
    gmControls.hidden = true;
  }
  OBR.player.onChange((player) => {
    if (player.role === "GM") initGmPopover();
    else teardownGmPopover();
  });
});
