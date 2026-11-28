import { ConnectedDice } from "./dice.ts";
import { readRingsInitiative, syncRingsInitiative } from "./rings.ts";
import { conditionSyncMode, usesRingsSync } from "./settings.ts";
import OBR from "@owlbear-rodeo/sdk";
import {
  HELLO_MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type ConnectRequest,
  type ConnectResponse,
  type ExtensionSettingsSummary,
  type SceneState,
  type SceneSummary,
} from "../../shared/obr/protocol.ts";
import { BridgeHost, type CommandHandlers } from "./bridgeHost.ts";
import {
  BRIDGE_WORKER_NAME,
  EXTENSION_VERSION,
  bridgeChannelName,
  bridgeWorkerUrl,
} from "./config.ts";
import { cleanupInstances, importCombatants, tokensForInstance } from "./importer.ts";
import { describeError } from "./errors.ts";
import { SceneObserver } from "./observers.ts";
import {
  boundedName,
  buildMappings,
  clampStamina,
  focusTokens,
  getItems,
  selectTokens,
  sceneSummary,
  setSceneLabel,
  setTokensVisibility,
} from "./scene.ts";
import { withRateLimitRetry } from "./requests.ts";
import { readMinionGroups, readSeamusMinionGroupId } from "./seamus.ts";
import { applyUpdates } from "./updates.ts";
import { createBackgroundSiteLink, extensionOrigin } from "../../shared/obr/siteLink.ts";
import { DEFAULT_MALICE_URL, MALICE_URL_STORAGE_KEY } from "./config.ts";
import { openSessionLease } from "../../shared/obr/sessionLease.ts";
import { registerExtensionWorker } from "./serviceWorker.ts";

registerExtensionWorker();

let bus: BroadcastChannel | null = null;
let bridgeWorker: SharedWorker | null = null;
let dice: ConnectedDice | null = null;
let host: BridgeHost | null = null;
let observer: SceneObserver | null = null;
let connected = false;
let detail = "Not connected to Malice Menagerie.";
let lastScene: SceneSummary | null = null;
let siteLink: ReturnType<typeof createBackgroundSiteLink> | null = null;
let sessionLease: ReturnType<typeof openSessionLease> | null = null;
let sessionLeaseFailed = false;
let started = false;
let activeRoomId = "";
let pagehideListener: (() => void) | null = null;

function currentSettings(): ExtensionSettingsSummary {
  const diceState = dice?.snapshot();
  return {
    ringsSync: usesRingsSync(),
    conditionSync: conditionSyncMode(),
    diceEnabled: diceState?.enabled ?? false,
    diceStatus: diceState?.status ?? "disconnected",
    diceGmOnly: diceState?.gmOnly ?? false,
  };
}

function emitSettings(): void {
  if (host?.isConnected) host.emit("SETTINGS_UPDATED", { settings: currentSettings() });
}

function waitingScene(): SceneSummary {
  return {
    roomId: OBR.room.id,
    sceneId: `pending/${OBR.room.id}`,
    sceneReady: false,
    gridDpi: 150,
    viewport: { x: 0, y: 0, scale: 1 },
    label: "Waiting for an Owlbear scene",
  };
}

function publish(status?: "connecting" | "connected" | "disconnected" | "error"): void {
  const value = status ?? (connected ? "connected" : host ? "connecting" : "disconnected");
  bus?.postMessage({
    type: "STATUS",
    status: value,
    detail,
    extensionVersion: EXTENSION_VERSION,
    scene: lastScene,
  });
}

function setStatus(next: boolean, message: string): void {
  connected = next;
  detail = message;
  // A lost connection with no host left is disconnected, not "connecting";
  // only a host still waiting for CONNECT deserves the connecting state.
  publish(next ? "connected" : host ? "connecting" : "disconnected");
}

async function readSceneState(encounterId: string | null): Promise<SceneState> {
  if (!(await OBR.scene.isReady()))
    return {
      scene: waitingScene(),
      mappings: [],
      minionGroups: [],
      orphanTokens: [],
    };
  const [summary, items, metadata] = await withRateLimitRetry(() =>
    Promise.all([sceneSummary(), getItems(), OBR.scene.getMetadata()]),
  );
  lastScene = summary;
  const groups = readMinionGroups(metadata);
  const mappings = encounterId
    ? buildMappings({ items, groups, encounterId, sceneId: summary.sceneId })
    : [];
  const tokenByGroup = new Map<string, number>();
  for (const item of items) {
    const groupId = readSeamusMinionGroupId(item);
    if (groupId) tokenByGroup.set(groupId, (tokenByGroup.get(groupId) ?? 0) + 1);
  }
  const initiative =
    encounterId && usesRingsSync() ? readRingsInitiative(items, metadata, encounterId) : undefined;
  return {
    scene: summary,
    mappings,
    ...(initiative ? { initiative } : {}),
    minionGroups: groups.map((group) => ({
      id: group.id.slice(0, 160),
      name: boundedName(group.name, "Minions"),
      currentStamina: clampStamina(group.currentStamina),
      individualStamina: clampStamina(group.individualStamina),
      tokenCount: Math.min(10_000, tokenByGroup.get(group.id) ?? 0),
    })),
    orphanTokens: [],
  };
}

const handlers: CommandHandlers = {
  rollPower: (payload) => (dice ? dice.roll(payload) : Promise.resolve({ dice: null })),
  async diceControl(payload) {
    if (!dice) return;
    if (payload.action === "cancel") dice.cancelPending("Cancelled from Malice Menagerie.");
    else if (payload.action === "retry") dice.connect();
    else if (payload.action === "set-gm-only" && typeof payload.gmOnly === "boolean")
      dice.setGmOnly(payload.gmOnly);
  },
  async connect(payload: ConnectRequest): Promise<ConnectResponse> {
    observer?.setEncounter(payload.encounterId);
    // Pairing authenticates a channel, not the scene API. After a room reload
    // the SDK may be ready before the scene; scene reads belong to GET_SCENE_STATE.
    return {
      extensionVersion: EXTENSION_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      scene: lastScene ?? waitingScene(),
      linkedInstances: 0,
      settings: currentSettings(),
    };
  },
  async disconnect(): Promise<void> {
    siteLink?.stop();
    sessionLease?.clear();
    observer?.setEncounter(null);
  },
  sceneState: (payload) => readSceneState(payload.encounterId),
  async import(payload) {
    const resume = observer?.suspendWrites();
    observer?.setEncounter(payload.encounterId);
    try {
      const result = await importCombatants(payload, (phase, done, total) => {
        host?.emit("IMPORT_PROGRESS", {
          encounterId: payload.encounterId,
          done,
          total,
          phase,
        });
      });
      lastScene = result.scene;
      return result;
    } catch (error) {
      console.error("Malice Menagerie: the import failed", error);
      host?.emit("IMPORT_FAILED", {
        encounterId: payload.encounterId,
        error: {
          code: "IMPORT_FAILED",
          message: describeError(error, "The import failed."),
        },
      });
      throw error;
    } finally {
      await observer?.rebaseline();
      resume?.();
    }
  },
  async initiative(payload) {
    if (!usesRingsSync()) return;
    const resume = observer?.suspendWrites();
    try {
      await syncRingsInitiative(payload);
    } finally {
      await observer?.rebaselineInitiative();
      resume?.();
    }
  },
  async updates(payload) {
    const resume = observer?.suspendWrites();
    try {
      const result = await applyUpdates(
        payload.encounterId,
        payload.combatants,
        payload.expectedSceneId,
      );
      await observer?.refreshCache();
      for (const applied of result.applied) {
        observer?.markWritten({
          instanceId: applied.instanceId,
          kind: applied.kind,
          currentStamina: applied.currentStamina,
          maxStamina: applied.maxStamina,
          name: applied.name,
          tokenIds: applied.tokenIds,
          ...(applied.conditions !== undefined ? { conditions: applied.conditions } : {}),
        });
      }
      if (result.warnings.length) {
        const summary =
          result.warnings.length === 1
            ? (result.warnings[0] as string)
            : `${result.warnings[0]} (+${result.warnings.length - 1} more)`;
        host?.emit("ERROR", {
          error: { code: "PARTIAL_UPDATE", message: summary.slice(0, 500) },
        });
      }
      return { appliedInstanceIds: result.applied.map((entry) => entry.instanceId) };
    } catch (error) {
      // A partial write (e.g. token metadata succeeded before condition or group
      // sync failed) must not echo our own writes back as external edits.
      await observer?.rebaseline();
      throw error;
    } finally {
      resume?.();
    }
  },
  async update(payload) {
    await handlers.updates({
      expectedSceneId: payload.expectedSceneId,
      encounterId: payload.encounterId,
      combatants: [payload.combatant],
    });
  },
  async select(payload) {
    const tokens = await tokensForInstance(payload.encounterId, payload.instanceId);
    await selectTokens(tokens.ids);
  },
  async focus(payload) {
    const tokens = await tokensForInstance(payload.encounterId, payload.instanceId);
    await focusTokens(tokens.ids);
  },
  async setVisibility(payload) {
    const resume = observer?.suspendWrites();
    try {
      return await setTokensVisibility(
        payload.encounterId,
        payload.instanceId,
        payload.visible,
        payload.expectedSceneId,
      );
    } finally {
      await observer?.rebaseline();
      resume?.();
    }
  },
  async cleanup(payload) {
    const resume = observer?.suspendWrites();
    try {
      const result = await cleanupInstances(
        payload.encounterId,
        payload.instanceIds,
        payload.expectedSceneId,
      );
      return { deleted: result.deleted };
    } finally {
      await observer?.rebaseline();
      resume?.();
    }
  },
  async renameScene(payload) {
    const scene = await setSceneLabel(payload.expectedSceneId, payload.label);
    lastScene = scene;
    publish(connected ? "connected" : undefined);
    return { scene };
  },
  onEncounter(encounterId) {
    observer?.setEncounter(encounterId);
  },
  onConnectionChange(next, message) {
    if (!next) {
      host = null;
      observer?.setEncounter(null);
      dice?.cancelPending("Malice Menagerie disconnected.");
    }
    setStatus(next, message);
  },
  onHandshakeError(message) {
    detail = `Connection failed: ${message}`;
    publish("error");
  },
};

function adopt(port: MessagePort, sessionId: string, pairingToken: string): void {
  if (sessionLease)
    sessionLease.install(
      {
        protocol: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        type: HELLO_MESSAGE_TYPE,
        sessionId,
        pairingToken,
        extensionVersion: EXTENSION_VERSION,
      },
      "",
      port,
    );
  else adoptPort(port, sessionId, pairingToken);
}

function adoptPort(port: MessagePort, sessionId: string, pairingToken: string): void {
  dice?.cancelPending("Replaced by a new pairing.");
  host?.close("Replaced by a new pairing.");
  host = new BridgeHost({
    port,
    sessionId,
    pairingToken,
    handlers,
  });
  connected = false;
  detail = "Waiting for Malice Menagerie to connect…";
  publish("connecting");
}

function startWorker(roomId: string): void {
  if (typeof SharedWorker === "undefined") {
    // Browsers without SharedWorker (e.g. Safari/iPadOS) can still pair via
    // Malice's Settings → Integrations → Owlbear Rodeo site link.
    return;
  }
  let worker: SharedWorker;
  try {
    worker = new SharedWorker(bridgeWorkerUrl(), { name: BRIDGE_WORKER_NAME });
  } catch (error) {
    detail = `This browser cannot start the extension worker: ${
      error instanceof Error ? error.message : String(error)
    }`;
    publish("error");
    return;
  }
  bridgeWorker = worker;
  worker.onerror = () => {
    if (bridgeWorker !== worker) return;
    bridgeWorker = null;
    if (!connected) {
      detail =
        "The connection worker failed to load. Reload the extension, or connect from Malice’s Settings panel.";
      publish("error");
    }
  };
  worker.port.start();
  worker.port.postMessage({ type: "register", role: "background", roomId, probe: true });
  worker.port.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const record = data as Record<string, unknown>;
    if (record["type"] === "ping" && typeof record["probeId"] === "string") {
      try {
        worker.port.postMessage({ type: "pong", probeId: record["probeId"] });
      } catch {
        // Detached.
      }
      return;
    }
    if (record["type"] !== "adopt") return;
    const port = event.ports[0];
    const sessionId = record["sessionId"];
    const pairingToken = record["pairingToken"];
    if (!port || typeof sessionId !== "string" || typeof pairingToken !== "string") return;
    adopt(port, sessionId, pairingToken);
  };
  pagehideListener = () => {
    try {
      worker.port.postMessage({ type: "unregister", role: "background", roomId });
    } catch {
      // Unloading.
    }
  };
  window.addEventListener("pagehide", pagehideListener);
}

function start(roomId: string): void {
  activeRoomId = roomId;
  sessionLease = openSessionLease({
    name: roomId,
    role: "server",
    onAdopt: (hello, _origin, port) => adoptPort(port, hello.sessionId, hello.pairingToken),
    onForgot: (reason) => {
      if (reason === "displaced") {
        siteLink?.dispose();
      } else {
        siteLink?.stop();
      }
      observer?.setEncounter(null);
      host?.close("Disconnected from Malice Menagerie.");
      host = null;
      setStatus(false, "Disconnected.");
    },
    onError: () => {
      sessionLeaseFailed = true;
      // Only surface a visible error if an active session was disrupted;
      // direct pairing and siteLink remain usable without the session worker.
      if (connected || host) {
        detail = "The connection worker failed to load. Reload the extension and reconnect.";
        publish("error");
      }
    },
  });
  siteLink = createBackgroundSiteLink({
    roomId,
    isConnected: () => connected,
    manageRecovery: () => sessionLease === null || sessionLeaseFailed,
    allowedOrigin: () => {
      try {
        const stored = localStorage.getItem(MALICE_URL_STORAGE_KEY)?.trim();
        const raw = stored || DEFAULT_MALICE_URL;
        return extensionOrigin(raw.includes("://") ? raw : `https://${raw}`);
      } catch {
        return extensionOrigin(DEFAULT_MALICE_URL);
      }
    },
    extensionVersion: EXTENSION_VERSION,
    adopt,
    disconnect: () => {
      sessionLease?.clear();
      observer?.setEncounter(null);
      host?.close("Disconnected from Malice Menagerie.");
      host = null;
      setStatus(false, "Disconnected.");
    },
  });
  observer = new SceneObserver({
    emit: (type, payload) => host?.emit(type as Parameters<BridgeHost["emit"]>[0], payload),
    ringsEnabled: usesRingsSync,
    onSceneChanged: (scene) => {
      lastScene = scene;
      detail = connected
        ? "Connected to Malice Menagerie."
        : host
          ? "Waiting for Malice Menagerie to connect…"
          : "Not connected to Malice Menagerie.";
      if (host?.isConnected) host.emit("SCENE_CHANGED", { scene });
      publish(connected ? "connected" : undefined);
    },
    onSceneLost: (reason) => {
      // A loading or failed scene must not tear down an authenticated channel.
      lastScene = waitingScene();
      if (host?.isConnected) host.emit("SCENE_CHANGED", { scene: lastScene });
      if (reason !== "The Owlbear scene is loading.")
        host?.emit("ERROR", { error: { code: "SCENE", message: reason } });
      detail = reason;
      publish(connected ? "connected" : undefined);
    },
  });
  observer.start();

  let roomBus: BroadcastChannel | null = null;
  try {
    roomBus = new BroadcastChannel(bridgeChannelName(roomId));
  } catch (error) {
    console.warn("Malice Menagerie: BroadcastChannel unavailable in this iframe", error);
  }
  bus = roomBus;
  dice?.stop();
  dice = new ConnectedDice(roomId, (state) => {
    roomBus?.postMessage({ type: "DICE_STATUS", state });
    emitSettings();
  });
  if (roomBus) {
    roomBus.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      const record = data as Record<string, unknown>;
      switch (record["type"]) {
        case "DICE_STATUS_REQUEST":
          roomBus.postMessage({ type: "DICE_STATUS", state: dice?.snapshot() });
          return;
        case "DICE_CONNECT":
          dice?.connect();
          return;
        case "DICE_DISCONNECT":
          dice?.disconnect();
          return;
        case "DICE_STYLE":
          if (typeof record["styleId"] === "string") dice?.selectStyle(record["styleId"]);
          return;
        case "DICE_GM_ONLY":
          if (typeof record["gmOnly"] === "boolean") dice?.setGmOnly(record["gmOnly"]);
          return;
        case "PING_BACKGROUND":
          roomBus.postMessage({ type: "BACKGROUND_READY", extensionVersion: EXTENSION_VERSION });
          publish();
          return;
        case "SETTINGS_CHANGED": {
          const setting = record["setting"];
          const reason =
            setting === "rings" || setting === "conditions" ? setting : ("conditions" as const);
          emitSettings();
          if (observer?.isWriting) {
            if (host?.isConnected && lastScene?.sceneReady)
              host.emit("SCENE_CHANGED", { scene: lastScene, reason, settings: currentSettings() });
            return;
          }
          void observer?.rebaseline().then(() => {
            if (host?.isConnected && lastScene?.sceneReady)
              host.emit("SCENE_CHANGED", { scene: lastScene, reason, settings: currentSettings() });
          });
          return;
        }
        case "STATUS_REQUEST":
          publish();
          return;
        case "DISCONNECT":
          siteLink?.stop();
          sessionLease?.clear();
          observer?.setEncounter(null);
          host?.close("Disconnected from the extension popover.");
          host = null;
          connected = false;
          detail = "Disconnected.";
          publish("disconnected");
          return;
        default:
          return;
      }
    };
  }

  startWorker(roomId);
  roomBus?.postMessage({ type: "BACKGROUND_READY", extensionVersion: EXTENSION_VERSION });
  publish();
}

function stop(): void {
  if (!started) return;
  started = false;
  if (pagehideListener) {
    window.removeEventListener("pagehide", pagehideListener);
    pagehideListener = null;
  }
  siteLink?.dispose();
  siteLink = null;
  sessionLease?.clear();
  sessionLease?.close();
  sessionLease = null;
  sessionLeaseFailed = false;
  observer?.stop();
  observer = null;
  dice?.stop();
  dice = null;
  host?.close("You are no longer a GM in this room.");
  host = null;
  if (bridgeWorker) {
    try {
      bridgeWorker.port.postMessage({
        type: "unregister",
        role: "background",
        roomId: activeRoomId,
      });
    } catch {
      // Detached.
    }
    bridgeWorker.onerror = null;
    bridgeWorker.port.onmessage = null;
    try {
      bridgeWorker.port.close();
    } catch {
      // Detached.
    }
    bridgeWorker = null;
  }
  activeRoomId = "";
  lastScene = null;
  connected = false;
  detail = "Not connected to Malice Menagerie.";
  bus?.close();
  bus = null;
}

function startIfGm(roomId: string): void {
  if (started) return;
  started = true;
  start(roomId);
}

OBR.onReady(async () => {
  try {
    const roomId = OBR.room.id;
    const role = typeof OBR.player.getRole === "function" ? await OBR.player.getRole() : "GM";
    if (role === "GM") startIfGm(roomId);
    // Players stay passive (no scene metadata writes or bridge listeners) unless promoted to GM,
    // and demoted GMs tear down the bridge immediately.
    OBR.player.onChange((player) => {
      if (player.role === "GM") startIfGm(roomId);
      else stop();
    });
  } catch (error) {
    console.error("Malice Menagerie: background initialization failed", error);
  }
});
