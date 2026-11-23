/**
 * Stand-in for the Malice Menagerie window in the browser harness.
 *
 * It speaks the same pairing handshake as the app (`READY`, `HELLO`, then a
 * `BridgeClient` over the transferred port) but has no UI. The driver script
 * calls the helpers on `window.__malice` to send commands and read replies.
 */
import { BridgeClient } from "../../../src/integration/client.ts";
import {
  isHelloMessage,
  isReadyRequestMessage,
  makeReadyMessage,
  type HelloMessage,
  type SceneState,
} from "../../../shared/obr/protocol.ts";

interface MaliceHarness {
  log: Array<Record<string, unknown>>;
  ready: boolean;
  ping: () => Promise<unknown> | undefined;
  sceneState: (encounterId: string | null) => Promise<unknown> | undefined;
  importEncounter: (request: unknown) => Promise<unknown> | undefined;
  updateStamina: (
    encounterId: string,
    instanceId: string,
    currentStamina: number,
    maxStamina: number,
    name?: string,
    individualStamina?: number | null,
  ) => Promise<unknown> | undefined;
  focusCombatant: (encounterId: string, instanceId: string) => Promise<unknown> | undefined;
  disconnect: () => Promise<unknown> | undefined;
}

declare global {
  interface Window {
    __malice: MaliceHarness;
  }
}

const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(
  window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
);
const pairingToken = hashParams.get("obrToken") ?? searchParams.get("obrToken") ?? "";
const extensionOrigin = hashParams.get("obrOrigin") ?? searchParams.get("obrOrigin") ?? "";
const log: Array<Record<string, unknown>> = [];
let client: BridgeClient | null = null;

function record(entry: Record<string, unknown>): void {
  log.push({ at: Date.now(), ...entry });
}

function sayReady(): void {
  if (!extensionOrigin || !window.opener) return;
  try {
    window.opener.postMessage(makeReadyMessage(), extensionOrigin);
  } catch {
    // The opener went away; nothing to pair with.
  }
}

function adopt(hello: HelloMessage, port: MessagePort): void {
  client?.close("Replaced by a new pairing.");
  client = new BridgeClient(port, hello.sessionId, {
    onEvent(type, payload) {
      record({ kind: "event", type, payload });
    },
    onStatus(status, detail) {
      record({ kind: "status", status, detail });
    },
    onLog(line) {
      record({ kind: "log", line });
    },
  });
  client.start();
  record({ kind: "adopted", sessionId: hello.sessionId });
  void client
    .request("CONNECT", { appVersion: "harness", encounterId: null, pairingToken })
    .then((response) => record({ kind: "connect", ok: true, response }))
    .catch((error: unknown) => record({ kind: "connect", ok: false, error: String(error) }));
}

window.addEventListener("message", (event) => {
  if (event.origin !== extensionOrigin) return;
  if (isReadyRequestMessage(event.data) && event.data.pairingToken === pairingToken) {
    sayReady();
    return;
  }
  if (!isHelloMessage(event.data)) return;
  if (event.data.pairingToken !== pairingToken) {
    record({ kind: "hello-rejected", reason: "pairing token" });
    return;
  }
  const port = event.ports[0];
  if (!port) {
    record({ kind: "hello-rejected", reason: "no port" });
    return;
  }
  adopt(event.data, port);
});

window.__malice = {
  log,
  ready: true,
  ping: () => client?.request("PING", {}),
  sceneState: (encounterId) => client?.request("GET_SCENE_STATE", { encounterId }),
  importEncounter: (request) => {
    // The wire contract ties each mode to its own command type.
    const mode = (request as { mode?: unknown }).mode;
    const type =
      mode === "reconcile"
        ? "RECONCILE_ENCOUNTER"
        : mode === "add"
          ? "ADD_COMBATANTS"
          : "IMPORT_ENCOUNTER";
    return client?.request(type, request);
  },
  updateStamina: async (
    encounterId,
    instanceId,
    currentStamina,
    maxStamina,
    name = "Harness Goblin",
    individualStamina,
  ) => {
    const state = await client?.request<SceneState>("GET_SCENE_STATE", { encounterId });
    if (!state) return;
    return client?.request("UPDATE_COMBATANT", {
      expectedSceneId: state.scene.sceneId,
      encounterId,
      combatant: {
        instanceId,
        currentStamina,
        maxStamina,
        name,
        activationGroupId: "harness-group",
        activationGroupName: "Harness",
        statblock: null,
        ...(individualStamina === undefined ? {} : { individualStamina }),
        revision: 0,
      },
    });
  },
  focusCombatant: (encounterId, instanceId) =>
    client?.request("FOCUS_COMBATANT", { encounterId, instanceId }),
  disconnect: () => client?.request("DISCONNECT", {}),
};

record({ kind: "loaded", extensionOrigin, hasToken: pairingToken.length > 0 });
sayReady();
