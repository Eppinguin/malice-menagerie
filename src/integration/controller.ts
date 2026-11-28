import { signal } from "@preact/signals";
import { loadMonster, monsterAt } from "../data.ts";
import { resetPendingSharedRoll, setDiceTransport } from "../lib/rollTransport.ts";
import { activeEncounter, reconcileCombat, startCombat, toast } from "../store.ts";
import type { Encounter } from "../types.ts";
import { BridgeClient, ProtocolError } from "./client.ts";
import {
  alignMappingsAfterRestart,
  allMappingsForEncounter,
  boundedProtocolText,
  clearEncounterMappings,
  mappingsFor,
  nextImportMode,
  planImport,
  replaceSceneMappings,
  type ImportPlan,
} from "./identity.ts";
import { createOutboundSync, type ActiveConnection } from "./outboundSync.ts";
import { allowsPairing, requiresPairingApproval } from "./pairing.ts";
import { statblockKey } from "./statblocks.ts";
import { openPairingRelay, type PairingRelay } from "./pairingRelay.ts";
import {
  CONNECT_QUERY_PARAM,
  CONNECT_QUERY_VALUE,
  LIMITS,
  PAIRING_ORIGIN_PARAM,
  PAIRING_TOKEN_PARAM,
  PROTOCOL_VERSION,
  isHelloMessage,
  isReadyRequestMessage,
  makeReadyMessage,
  parseAllowedOrigin,
  type BridgeEventType,
  type CombatantUpdate,
  type ConnectResponse,
  type ExtensionSettingsSummary,
  type HelloMessage,
  type ImportMode,
  type ImportRequest,
  type ImportResult,
  type InitiativeState,
  type RenameSceneResponse,
  type SceneState,
  type SceneSummary,
  type SetVisibilityResponse,
  type TokenMapping,
} from "../../shared/obr/protocol.ts";
import { trackDicePresentation } from "./rollTiming.ts";
import { openSessionLease, sessionLeaseId } from "../../shared/obr/sessionLease.ts";
import { createSiteLink, extensionOrigin, owlbearRoomUrl } from "../../shared/obr/siteLink.ts";
import {
  activeSceneId,
  clearUnresolvedStatblocks,
  commitStore,
  defeatedMappings,
  findMapping,
  flushPendingLogSave,
  log,
  notifyOwlbearSelection,
  openOwlbearPanel,
  orphanedMappings,
  owlbearBusy,
  owlbearConnection,
  owlbearLog,
  owlbearPanelOpen,
  owlbearPendingApproval,
  owlbearSelectedInstanceId,
  owlbearSelectionPulse,
  owlbearStore,
  owlbearUnresolved,
  persistTrustedOrigin,
  refreshPersistedStore,
  removeManualStatblock,
  restartReattachableMappings,
  setConnection,
  setInverseSelection,
  setManualStatblock,
  setPersistIntegration,
  setStatus,
  syncLinkedInstancesCount,
  toggleOwlbearPanel,
  trustOrigin,
  type OwlbearConnectionState,
  type PendingPairingApproval,
} from "./state.ts";

const APP_VERSION = "0.1.0";
const IMPORT_TIMEOUT_MS = 120_000;
const STATE_TIMEOUT_MS = 15_000;

function readPairingParams(): { awaiting: boolean; token: string | null; origin: string | null } {
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const read = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  return {
    awaiting: read(CONNECT_QUERY_PARAM) === CONNECT_QUERY_VALUE,
    token: read(PAIRING_TOKEN_PARAM),
    origin: read(PAIRING_ORIGIN_PARAM),
  };
}

const initialPairing = readPairingParams();
let pairingToken: string | null = initialPairing.token;
let pairingOrigin: string | null = initialPairing.origin;
export const owlbearAwaitingPair = signal<boolean>(initialPairing.awaiting);
setPersistIntegration(!initialPairing.awaiting);

let connection: ActiveConnection | null = null;
let relay: PairingRelay | null = null;
let siteLink: ReturnType<typeof createSiteLink> | null = null;
let sessionLease: ReturnType<typeof openSessionLease> | null = null;
let initialized = false;
let synchronizationRevision = 0;
let pairingInFlight = false;
let adoptingLease = false;
let pendingApprovalEntry: {
  hello: HelloMessage;
  origin: string;
  port: MessagePort;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const APPROVAL_TIMEOUT_MS = 28_000;
let connectRetryTimer: ReturnType<typeof setTimeout> | undefined;
let syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
const visibilitySeq = new Map<string, number>();

const sync = createOutboundSync({
  getConnection: () => connection,
  onEncounterSwitched: () => {
    if (connection) void synchronizeAfterConnect();
  },
});

function pageOrigin(): string {
  try {
    return new URL(location.href).origin;
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin: string): boolean {
  return parseAllowedOrigin(origin) === origin;
}

function clearRetryTimers(): void {
  if (connectRetryTimer !== undefined) {
    clearTimeout(connectRetryTimer);
    connectRetryTimer = undefined;
  }
  if (syncRetryTimer !== undefined) {
    clearTimeout(syncRetryTimer);
    syncRetryTimer = undefined;
  }
}

function clearPendingApproval(closePort = true): void {
  if (pendingApprovalEntry) {
    clearTimeout(pendingApprovalEntry.timer);
    if (closePort) {
      try {
        pendingApprovalEntry.port.close();
      } catch {
        // Already detached.
      }
    }
  }
  pendingApprovalEntry = null;
  owlbearPendingApproval.value = null;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

function stripConnectUrlParams(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has(CONNECT_QUERY_PARAM)) {
      url.searchParams.delete(CONNECT_QUERY_PARAM);
      url.searchParams.delete(PAIRING_TOKEN_PARAM);
      url.searchParams.delete(PAIRING_ORIGIN_PARAM);
      changed = true;
    }
    if (url.hash.length > 1) {
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      if (hash.has(CONNECT_QUERY_PARAM)) {
        hash.delete(CONNECT_QUERY_PARAM);
        hash.delete(PAIRING_TOKEN_PARAM);
        hash.delete(PAIRING_ORIGIN_PARAM);
        url.hash = hash.toString();
        changed = true;
      }
    }
    if (changed) history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The query string is cosmetic; a failure changes nothing.
  }
}

function cleanConnectParam(): void {
  stripConnectUrlParams();
  owlbearAwaitingPair.value = false;
}

function handleWindowMessage(event: MessageEvent<unknown>): void {
  if (siteLink?.handleMessage(event)) return;
  const origin = event.origin;
  const expectedOrigin = pairingOrigin ? parseAllowedOrigin(pairingOrigin) : null;
  if (isReadyRequestMessage(event.data)) {
    if (!isAllowedOrigin(origin) || !event.source) return;
    const trusted = owlbearStore.value.trustedOrigins.includes(origin);
    const fromOpener = event.source === window.opener;
    if (!trusted && (!fromOpener || (expectedOrigin !== null && origin !== expectedOrigin))) {
      log(`Refused a pairing request from unexpected origin ${origin}.`);
      return;
    }
    const requested = event.data.pairingToken;
    if (!allowsPairing(trusted, pairingToken, requested)) {
      log(`Refused a pairing request with the wrong token from ${origin}.`);
      return;
    }
    if (trusted) pairingToken = requested;
    const source = event.source as Window;
    // The relay probe decides whether this tab should answer at all, so do not
    // let the popover send HELLO before that answer is known.
    void pairingGate().then(() => {
      try {
        source.postMessage(makeReadyMessage(), origin);
      } catch {
        // Opener navigated or closed.
      }
    });
    return;
  }
  if (!isHelloMessage(event.data)) return;
  if (!isAllowedOrigin(origin)) {
    log(`Refused a pairing hello from an unsupported origin (${origin || "null"}).`);
    return;
  }
  const port = event.ports[0];
  if (!port) {
    log("Refused a pairing hello without a message port.");
    return;
  }

  const fromOpener = event.source !== null && event.source === window.opener;
  const trusted = owlbearStore.value.trustedOrigins.includes(origin);
  if (!trusted && (!fromOpener || (expectedOrigin !== null && origin !== expectedOrigin))) {
    port.close();
    log(`Blocked a pairing hello from unexpected origin ${origin}.`);
    setConnection({
      status: "error",
      lastError: "Pairing was blocked. Open this window from the Owlbear extension.",
    });
    return;
  }
  if (!allowsPairing(trusted, pairingToken, event.data.pairingToken)) {
    port.close();
    log(
      fromOpener
        ? `Blocked a pairing hello from ${origin}; the one-time token did not match.`
        : `Blocked a pairing hello from ${origin}; open Malice Menagerie from the Owlbear extension.`,
    );
    setConnection({
      status: "error",
      lastError: fromOpener
        ? "Pairing was blocked: the one-time token did not match."
        : "Pairing was blocked. Open this window from the Owlbear extension.",
    });
    return;
  }

  // Require explicit user approval before adopting or trusting any new
  // cross-origin extension so an arbitrary HTTPS site cannot silently hijack
  // an open Malice session via a crafted ?obr=connect popup.
  if (requiresPairingApproval(trusted, origin, pageOrigin())) {
    clearPendingApproval(true);
    const timer = setTimeout(() => {
      const expired = pendingApprovalEntry;
      clearPendingApproval(true);
      if (expired) log(`Pairing approval for ${expired.origin} timed out.`);
      if (!connection) {
        setConnection({
          status: "disconnected",
          detail: "Pairing request timed out. Press Connect in Owlbear again.",
          lastError: null,
        });
      }
    }, APPROVAL_TIMEOUT_MS);
    pendingApprovalEntry = { hello: event.data, origin, port, timer };
    owlbearPendingApproval.value = { origin };
    owlbearPanelOpen.value = true;
    setConnection({
      status: "connecting",
      detail: `Confirm pairing from ${origin} in Settings.`,
      lastError: null,
    });
    log(`Awaiting user confirmation before pairing with external origin ${origin}.`);
    return;
  }

  siteLink?.stop();
  void acceptPairingHello(event.data, origin, port);
}

export function approvePendingPairing(): void {
  const entry = pendingApprovalEntry;
  if (!entry) return;
  clearPendingApproval(false);
  // Persist the newly approved origin so an already-open tab receiving a
  // relayed handoff sees it immediately, without turning on full persistence
  // on this throwaway pairing tab.
  persistTrustedOrigin(entry.origin);
  siteLink?.stop();
  void acceptPairingHello(entry.hello, entry.origin, entry.port);
}

export function rejectPendingPairing(): void {
  const entry = pendingApprovalEntry;
  clearPendingApproval(true);
  if (entry) log(`Declined pairing request from ${entry.origin}.`);
  if (!connection) {
    setConnection({
      status: "disconnected",
      detail: "Pairing declined.",
      lastError: null,
    });
  }
}

/** How long a pairing tab waits for an already-open tab before taking over. */
const PEER_WAIT_MS = 1_200;

/**
 * The extension can only reach the window it opened. If another Malice tab is
 * open, the port belongs there; give a tab that is mid-reload a moment to
 * announce itself before this window keeps the connection.
 */
async function acceptPairingHello(
  hello: HelloMessage,
  origin: string,
  port: MessagePort,
): Promise<void> {
  if (pairingInFlight) {
    port.close();
    log("Ignored a duplicate pairing hello while another pairing was in flight.");
    return;
  }
  pairingInFlight = true;
  try {
    if (!owlbearAwaitingPair.value || !relay) {
      adoptConnection(hello, origin, port);
      return;
    }
    const peer = relay.preferredTabId ?? (await relay.waitForPeer(PEER_WAIT_MS));
    if (peer) {
      await handOffPairing(hello, origin, port);
      return;
    }
    log(
      "No other Malice Menagerie tab answered, so this window is holding the connection. Reload any other Malice tab once after updating.",
    );
    adoptConnection(hello, origin, port);
  } finally {
    pairingInFlight = false;
  }
}

/**
 * This tab was opened only to pair. If another Malice Menagerie tab is open,
 * send it the authorized port and close, so the connection lands in the window
 * the user is actually working in.
 */
async function handOffPairing(
  hello: HelloMessage,
  origin: string,
  port: MessagePort,
): Promise<void> {
  const result = await relay?.handoff(hello, origin, port);
  if (result?.delivered) {
    log("Handed the Owlbear connection to the Malice Menagerie tab you already had open.");
    owlbearAwaitingPair.value = false;
    setConnection({
      status: "disconnected",
      detail: "Connected in another Malice Menagerie tab.",
      lastError: null,
    });
    cleanConnectParam();
    relay?.close();
    relay = null;
    window.close();
    return;
  }
  if (!result?.port) {
    const message =
      "Could not hand the connection to the other Malice Menagerie tab. It may have been closed, reloading, or at a different address.";
    log(`${message} Press Connect in Owlbear again.`);
    setConnection({ status: "error", detail: message, lastError: message });
    return;
  }
  adoptConnection(hello, origin, result.port);
}

function adoptConnection(hello: HelloMessage, origin: string, port: MessagePort): void {
  if (sessionLease) {
    adoptingLease = true;
    sessionLease.install(hello, origin, port);
  } else {
    adoptConnectionPort(hello, origin, port);
  }
}

function handleTransportClosed(status: "disconnected" | "lost", detail?: string): void {
  clearRetryTimers();
  clearPendingApproval(true);
  adoptingLease = false;
  resetPendingSharedRoll();
  sync.setOutboundReady(false);
  connection = null;
  notifyOwlbearSelection(null);
  clearUnresolvedStatblocks();
  setConnection({
    status,
    ...(detail === undefined ? {} : { detail }),
    linkedInstances: 0,
    scene: null,
    settings: null,
    progress: null,
    ...(status === "disconnected" ? { lastError: null } : {}),
  });
  if (detail) log(`Extension ${status === "lost" ? "connection lost" : "disconnected"}: ${detail}`);
}

function adoptConnectionPort(hello: HelloMessage, origin: string, port: MessagePort): void {
  adoptingLease = false;
  clearRetryTimers();
  // If this was a pairing-only tab that fell back to owning the connection,
  // refresh from localStorage before enabling writes so we don't clobber
  // another tab's newer mappings or trusted origins.
  if (owlbearAwaitingPair.value) refreshPersistedStore();
  setPersistIntegration(true);
  resetPendingSharedRoll();
  connection?.client.close("Replaced by a new pairing.");
  pairingToken = hello.pairingToken;
  const client = new BridgeClient(port, hello.sessionId, {
    onEvent: (type, payload) => {
      if (connection?.client === client) handleEvent(type, payload);
    },
    onStatus: (status, detail) => {
      if (connection?.client !== client) return;
      if (status === "lost" || status === "disconnected") {
        handleTransportClosed(status, detail);
        return;
      }
      setStatus(status, detail);
    },
    onLog: log,
  });
  connection = {
    client,
    origin,
    sessionId: hello.sessionId,
    pairingToken: hello.pairingToken,
  };
  trustOrigin(origin);
  cleanConnectParam();
  setConnection({
    status: "connecting",
    detail: "Pairing with Owlbear Rodeo…",
    origin,
    extensionVersion: hello.extensionVersion,
    lastError: null,
  });
  sync.setOutboundReady(false);
  client.start();
  log(`Paired with the Owlbear extension at ${origin}.`);
  void connectToOwlbear();
}

/** A relayed hand-off is only accepted from same-origin or already-trusted origins. */
function adoptRelayed(
  hello: HelloMessage,
  origin: string,
  port: MessagePort,
  _handoffId: string,
): boolean {
  if (!isAllowedOrigin(origin)) {
    log(`Refused a relayed pairing from an unsupported origin (${origin || "null"}).`);
    return false;
  }
  // Re-read trusted origins from localStorage so an origin just approved in a
  // pairing tab is accepted here instead of bouncing back.
  refreshPersistedStore();
  const trusted = owlbearStore.value.trustedOrigins.includes(origin);
  if (requiresPairingApproval(trusted, origin, pageOrigin())) {
    log(`Refused an unapproved relayed pairing from external origin ${origin}.`);
    return false;
  }
  siteLink?.stop();
  adoptConnection(hello, origin, port);
  log("Adopted a connection handed off from another Malice Menagerie tab.");
  return true;
}

function pairingGate(): Promise<unknown> {
  if (!owlbearAwaitingPair.value || !relay) return Promise.resolve(null);
  return relay.ready;
}

async function connectToOwlbear(attempt = 0): Promise<void> {
  const active = connection;
  if (!active) return;
  try {
    const response = await active.client.request<ConnectResponse>(
      "CONNECT",
      {
        appVersion: APP_VERSION,
        encounterId: activeEncounter().id,
        pairingToken: active.pairingToken,
      },
      STATE_TIMEOUT_MS,
    );
    if (connection !== active) return;
    setConnection({
      status: "connected",
      detail: "Connected to Owlbear Rodeo.",
      scene: response.scene,
      extensionVersion: response.extensionVersion,
      linkedInstances: response.linkedInstances,
      ...(response.settings !== undefined ? { settings: response.settings } : {}),
      lastError: null,
    });
    log(`Connected · ${response.scene.label} · extension ${response.extensionVersion}.`);
    await synchronizeAfterConnect();
  } catch (error) {
    if (connection !== active) return;
    const message = error instanceof Error ? error.message : "The extension did not answer.";
    setConnection({ status: "error", detail: message, lastError: message });
    log(`Connection failed: ${message}`);
    if (attempt < 3 && !(error instanceof ProtocolError && error.code === "PAIRING")) {
      setStatus("connecting", "The extension is starting. Retrying the connection…");
      if (connectRetryTimer !== undefined) clearTimeout(connectRetryTimer);
      connectRetryTimer = setTimeout(() => {
        connectRetryTimer = undefined;
        if (connection === active) void connectToOwlbear(attempt + 1);
      }, 2_000);
    }
  }
}

/** On reconnect, tokens that already exist win for stamina: they may have
    taken damage while Malice was disconnected. Locally dirty edits are kept. */
async function synchronizeAfterConnect(
  attempt = 0,
  syncOptions: { preserveLocalConditions?: boolean } = {},
): Promise<void> {
  const active = connection;
  if (!active) return;
  const encounterId = activeEncounter().id;
  const revision = ++synchronizationRevision;
  const isCurrent = () =>
    connection === active &&
    revision === synchronizationRevision &&
    activeEncounter().id === encounterId;
  sync.setOutboundReady(false);
  sync.resetInitiativeBaseline();
  setStatus("synchronizing", "Reconciling existing tokens…");
  try {
    const expectedSceneId = activeSceneId();
    const sceneState = await active.client.request<SceneState>(
      "GET_SCENE_STATE",
      { encounterId },
      STATE_TIMEOUT_MS,
    );
    if (!isCurrent() || isStaleScene(sceneState, expectedSceneId)) return;
    if (!sceneState.scene.sceneReady) {
      sync.setOutboundReady(false);
      setConnection({
        status: "connected",
        scene: sceneState.scene,
        detail: "Connected. Waiting for an Owlbear scene…",
        lastError: null,
      });
      return;
    }
    setConnection({ scene: sceneState.scene });
    mergeSceneState(sceneState, encounterId);
    sync.applyObservedForCurrentEncounter(sceneState.mappings, true, syncOptions);
    // Check combatants against their acknowledged stamps before importing group
    // changes, which would otherwise look like pending local edits.
    if (sceneState.initiative) sync.receiveInitiative(sceneState.initiative, true);
    setConnection({
      status: "connected",
      detail: "Synchronized.",
      scene: sceneState.scene,
      lastError: null,
    });
    syncLinkedInstancesCount();
    sync.setOutboundReady(true);
    sync.scheduleDiff();
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : "Could not read the scene.";
    setStatus("connected", "Connected; scene state unavailable.");
    setConnection({ lastError: message });
    log(`Scene state failed: ${message}`);
    sync.setOutboundReady(false);
    if (attempt < 5) {
      if (syncRetryTimer !== undefined) clearTimeout(syncRetryTimer);
      syncRetryTimer = setTimeout(() => {
        syncRetryTimer = undefined;
        if (isCurrent()) void synchronizeAfterConnect(attempt + 1, syncOptions);
      }, 2_000);
    }
  }
}

/** A slow scene read can resolve after the extension already moved to another
    scene. Reject only when activeSceneId() changed while GET_SCENE_STATE was
    in flight; if activeSceneId() is unchanged, GET_SCENE_STATE is authoritative
    even when CONNECT's cached lastScene was older. */
function isStaleScene(sceneState: SceneState, expectedSceneId: string | null): boolean {
  if (activeSceneId() === expectedSceneId) return false;
  log(
    `Ignored a scene snapshot for ${sceneState.scene.sceneId}; the active scene is ${activeSceneId()}.`,
  );
  return true;
}

function mergeSceneState(sceneState: SceneState, requestedEncounterId: string): void {
  const store = owlbearStore.value;
  // The requested encounter's snapshot is authoritative even when no tokens remain.
  const byEncounter = new Map<string, TokenMapping[]>([[requestedEncounterId, []]]);
  for (const entry of sceneState.mappings) {
    const list = byEncounter.get(entry.encounterId) ?? [];
    list.push(entry);
    byEncounter.set(entry.encounterId, list);
  }
  let next = store;
  for (const [encounterId, mappings] of byEncounter)
    next = replaceSceneMappings(
      next,
      sceneState.scene.roomId,
      sceneState.scene.sceneId,
      mappings,
      encounterId,
    );
  commitStore(next);
}

// ---------------------------------------------------------------------------
// Import / reconcile
// ---------------------------------------------------------------------------

async function ensureCombatRoster(encounter: Encounter): Promise<boolean> {
  if (!encounter.items.length && !encounter.combat.instances.length) {
    toast("Add monsters before sending to Owlbear.");
    return false;
  }
  if (!encounter.combat.active || !encounter.combat.instances.length) {
    await startCombat({ switchView: false });
    return encounter.combat.instances.length > 0;
  }
  reconcileCombat();
  return encounter.combat.instances.length > 0;
}

async function buildPlan(
  encounter: Encounter,
  mappings: readonly TokenMapping[],
): Promise<ImportPlan> {
  let attempt = 0;
  while (attempt < 2) {
    attempt += 1;
    const plan = planImport({
      encounter,
      mappings,
      lookup: (path) => monsterAt(path),
      manualStatblocks: owlbearStore.value.manualStatblocks,
      learnedStatblocks: owlbearStore.value.learnedStatblocks,
    });
    if (!plan.missingMonsters.length) return plan;
    const missing = [...new Set(plan.missingMonsters)];
    await Promise.allSettled(missing.map(loadMonster));
  }
  return planImport({
    encounter,
    mappings,
    lookup: (path) => monsterAt(path),
    manualStatblocks: owlbearStore.value.manualStatblocks,
    learnedStatblocks: owlbearStore.value.learnedStatblocks,
  });
}

/** Ephemerally align mappings after a whole-combat restart without mutating
    owlbearStore pre-flight. Confirmed mappings are committed by applyImportResult. */
function effectiveMappingsForSend(
  encounter: Encounter,
  sceneId: string,
  requestedIds: ReadonlySet<string> | null,
): { mappings: TokenMapping[]; restarted: boolean } {
  const current = mappingsFor(owlbearStore.value, encounter.id, sceneId);
  if (requestedIds) {
    // Do not perform whole-combat restart alignment on a single-combatant send;
    // reattaching only one instance would create overlap and block the remaining
    // restarted instances from reattaching on the next full Send tokens.
    return { mappings: current, restarted: false };
  }
  const aligned = alignMappingsAfterRestart(encounter.id, current, encounter.combat.instances);
  return { mappings: aligned.mappings, restarted: aligned.changed };
}

export async function sendToOwlbear(
  options: { forceMode?: ImportMode; hidden?: boolean; instanceIds?: readonly string[] } = {},
): Promise<void> {
  const active = connection;
  if (!active || owlbearConnection.value.status !== "connected") {
    owlbearPanelOpen.value = true;
    toast("Connect Malice Menagerie to Owlbear first.");
    return;
  }
  if (owlbearBusy.value) return;
  const encounter = activeEncounter();
  const sceneId = activeSceneId();
  if (!sceneId) {
    toast("Open a scene in Owlbear before sending tokens.");
    return;
  }
  const startingRevision = synchronizationRevision;
  function isCurrent(): boolean {
    if (connection !== active) return false;
    if (activeEncounter() !== encounter)
      throw new Error("Encounter changed. Press Send tokens to send the selected encounter.");
    if (synchronizationRevision !== startingRevision || activeSceneId() !== sceneId)
      throw new Error("The Owlbear scene changed. Press Send tokens to send to the current scene.");
    return true;
  }

  owlbearBusy.value = true;
  setConnection({ status: "synchronizing", detail: "Preparing encounter…", lastError: null });
  try {
    const hasRoster = await ensureCombatRoster(encounter);
    if (!isCurrent()) return;
    if (!hasRoster) {
      setStatus("connected", "Nothing to send.");
      return;
    }
    const requestedIds = options.instanceIds ? new Set(options.instanceIds) : null;
    const { mappings: effectiveMappings, restarted } = effectiveMappingsForSend(
      encounter,
      sceneId,
      requestedIds,
    );
    if (restarted) {
      log("Restarted combat: reattaching existing tokens to the new roster by entry and slot.");
    }
    const fullPlan = await buildPlan(encounter, effectiveMappings);
    if (!isCurrent()) return;
    const plan: ImportPlan = requestedIds
      ? {
          ...fullPlan,
          combatants: fullPlan.combatants.filter((entry) => requestedIds.has(entry.instanceId)),
        }
      : fullPlan;
    if (!plan.combatants.length) {
      throw new Error(
        plan.missingMonsters.length
          ? "None of the combatants could be loaded from the bundled compendium."
          : "There is nothing to send to Owlbear.",
      );
    }
    if (!requestedIds) {
      owlbearUnresolved.value = plan.unresolved;
      if (plan.unresolved.length)
        toast(
          `${plan.unresolved.length} statblock${plan.unresolved.length === 1 ? "" : "s"} need attention.`,
        );
    } else {
      const requestedKeys = new Set(
        plan.combatants
          .map((entry) => {
            const m = entry.sourcePath ? monsterAt(entry.sourcePath) : undefined;
            return m ? statblockKey(m.name, m.printed?.level ?? m.level) : null;
          })
          .filter((key): key is string => key !== null),
      );
      const relevant = fullPlan.unresolved.filter((entry) => requestedKeys.has(entry.key));
      if (relevant.length) {
        const existingKeys = new Set(owlbearUnresolved.value.map((entry) => entry.key));
        const additions = relevant.filter((entry) => !existingKeys.has(entry.key));
        if (additions.length) {
          owlbearUnresolved.value = [...owlbearUnresolved.value, ...additions];
          toast(
            `${additions.length} statblock${additions.length === 1 ? "" : "s"} need attention.`,
          );
        }
      }
    }

    const mode =
      options.forceMode ?? (requestedIds ? "add" : nextImportMode(effectiveMappings, plan));
    const request: ImportRequest = {
      encounterId: encounter.id,
      encounterName: boundedProtocolText(encounter.name, LIMITS.nameLength, "Encounter"),
      mode,
      combatants: plan.combatants,
      expectedSceneId: sceneId,
      ...(options.hidden ? { hidden: true } : {}),
    };
    const command =
      mode === "import"
        ? "IMPORT_ENCOUNTER"
        : mode === "add"
          ? "ADD_COMBATANTS"
          : "RECONCILE_ENCOUNTER";
    const result = await active.client.request<ImportResult>(command, request, IMPORT_TIMEOUT_MS);
    if (connection !== active) return;
    if (
      activeEncounter() !== encounter ||
      synchronizationRevision !== startingRevision ||
      activeSceneId() !== sceneId ||
      result.scene.sceneId !== sceneId
    ) {
      log("The send finished in the previous encounter or scene. Its tokens remain in Owlbear.");
      return;
    }
    sync.applyImportResult(result, plan);
    const verb = mode === "import" ? "Sent" : mode === "add" ? "Added" : "Reconciled";
    const failed = result.missing.length;
    const message = failed
      ? `${failed} combatant${failed === 1 ? " needs" : "s need"} tokens. ${result.warnings[0] ?? "Press Send tokens to try again."}`
      : `${verb} · ${result.created} token${result.created === 1 ? "" : "s"} created, ${result.updated} combatant${result.updated === 1 ? "" : "s"} updated.`;
    setConnection({
      lastError:
        failed || result.warnings.length
          ? message + (failed ? " Send again to recover missing tokens." : ` ${result.warnings[0]}`)
          : null,
    });
    toast(message);
    log(message);
    for (const warning of result.warnings) log(warning);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    if (connection === active && synchronizationRevision === startingRevision)
      setConnection({ lastError: message });
    log(`Import failed: ${message}`);
    toast(message);
  } finally {
    owlbearBusy.value = false;
    if (connection === active) {
      setConnection({ progress: null });
      if (synchronizationRevision === startingRevision)
        setStatus("connected", "Connected to Owlbear Rodeo.");
    }
  }
}

export async function sendCombatantToOwlbear(
  instanceId: string,
  options: { hidden?: boolean } = {},
): Promise<void> {
  await sendToOwlbear({ ...options, forceMode: "add", instanceIds: [instanceId] });
}

export async function reconcileWithOwlbear(): Promise<void> {
  await sendToOwlbear({ forceMode: "reconcile" });
}

// ---------------------------------------------------------------------------
// Selection, focus, cleanup
// ---------------------------------------------------------------------------

export async function selectCombatant(instanceId: string): Promise<void> {
  const active = connection;
  const sceneId = activeSceneId();
  if (!active || !sceneId) {
    toast("Owlbear is not connected.");
    return;
  }
  const mapping = findMapping(instanceId);
  if (!mapping || mapping.missing) {
    toast("That combatant has no token in this scene.");
    return;
  }
  owlbearSelectedInstanceId.value = instanceId;
  commitStore({ ...owlbearStore.value, lastSelectedInstanceId: instanceId });
  try {
    await active.client.request("SELECT_COMBATANT", {
      encounterId: activeEncounter().id,
      instanceId,
    });
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not select the token.");
  }
}

export async function focusCombatant(instanceId: string): Promise<void> {
  const active = connection;
  const sceneId = activeSceneId();
  if (!active || !sceneId) {
    toast("Owlbear is not connected.");
    return;
  }
  const mapping = findMapping(instanceId);
  if (!mapping || mapping.missing) {
    toast("That combatant has no token in this scene.");
    return;
  }
  owlbearSelectedInstanceId.value = instanceId;
  try {
    await active.client.request("FOCUS_COMBATANT", {
      encounterId: activeEncounter().id,
      instanceId,
    });
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not focus the map.");
  }
}

export async function setCombatantVisibility(instanceId: string, visible: boolean): Promise<void> {
  const active = connection;
  const sceneId = activeSceneId();
  const encounter = activeEncounter();
  if (!active || !sceneId) {
    toast("Owlbear is not connected.");
    return;
  }
  const mapping = findMapping(instanceId);
  if (!mapping || mapping.missing) {
    toast("That combatant has no token in this scene.");
    return;
  }
  const seq = (visibilitySeq.get(instanceId) ?? 0) + 1;
  visibilitySeq.set(instanceId, seq);
  try {
    const result = await active.client.request<SetVisibilityResponse>(
      "SET_VISIBILITY",
      {
        expectedSceneId: sceneId,
        encounterId: encounter.id,
        instanceId,
        visible,
      },
      STATE_TIMEOUT_MS,
    );
    if (
      visibilitySeq.get(instanceId) !== seq ||
      connection !== active ||
      activeSceneId() !== sceneId ||
      activeEncounter().id !== encounter.id
    )
      return;
    const roomId = owlbearConnection.value.scene?.roomId ?? "";
    const current = mappingsFor(owlbearStore.value, encounter.id, sceneId);
    commitStore(
      replaceSceneMappings(
        owlbearStore.value,
        roomId,
        sceneId,
        current.map((entry) =>
          entry.instanceId === instanceId
            ? { ...entry, visible: result.visible, updatedAt: Date.now() }
            : entry,
        ),
        encounter.id,
      ),
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not change token visibility.");
  }
}

export async function renameOwlbearScene(label: string): Promise<boolean> {
  const active = connection;
  const sceneId = activeSceneId();
  if (!active || !sceneId) {
    toast("Open a scene in Owlbear first.");
    return false;
  }
  const clean = label.trim().slice(0, 80);
  try {
    const response = await active.client.request<RenameSceneResponse>(
      "RENAME_SCENE",
      { expectedSceneId: sceneId, label: clean },
      STATE_TIMEOUT_MS,
    );
    if (connection !== active || activeSceneId() !== sceneId) return false;
    setConnection({ scene: response.scene });
    toast(clean ? `Scene renamed to ${response.scene.label}.` : "Scene name reset.");
    log(`Scene renamed · ${response.scene.label}`);
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not rename the scene.");
    return false;
  }
}

export async function cleanupOrphanTokens(instanceIds: string[]): Promise<void> {
  const active = connection;
  const sceneId = activeSceneId();
  const encounter = activeEncounter();
  if (!active || !sceneId || !instanceIds.length || owlbearBusy.value) return;
  owlbearBusy.value = true;
  try {
    const result = await active.client.request<{ deleted: number }>(
      "CLEANUP_COMBATANTS",
      { encounterId: encounter.id, instanceIds, expectedSceneId: sceneId },
      STATE_TIMEOUT_MS,
    );
    if (
      connection !== active ||
      activeSceneId() !== sceneId ||
      activeEncounter().id !== encounter.id
    )
      return;
    const remaining = mappingsFor(owlbearStore.value, encounter.id, sceneId).filter(
      (entry) => !instanceIds.includes(entry.instanceId),
    );
    const roomId = owlbearConnection.value.scene?.roomId ?? "";
    const updated = replaceSceneMappings(
      owlbearStore.value,
      roomId,
      sceneId,
      remaining,
      encounter.id,
    );
    const scenes = updated.encounters[encounter.id]?.scenes ?? {};
    const next =
      !remaining.length && Object.keys(scenes).every((id) => id === sceneId)
        ? clearEncounterMappings(updated, encounter.id)
        : updated;
    commitStore(next);
    syncLinkedInstancesCount();
    toast(`Removed ${result.deleted} token${result.deleted === 1 ? "" : "s"} from Owlbear.`);
    log(`Cleaned up ${result.deleted} orphaned tokens.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Cleanup failed.");
  } finally {
    owlbearBusy.value = false;
  }
}

/** Count how many live tokens an encounter has on the active Owlbear scene. */
export function linkedTokensForEncounter(encounterId: string): number {
  const sceneId = activeSceneId();
  if (!sceneId) return 0;
  return mappingsFor(owlbearStore.value, encounterId, sceneId)
    .filter((entry) => !entry.missing)
    .reduce((sum, entry) => sum + entry.tokenIds.length, 0);
}

/** Remove all tokens belonging to `encounterId` from the active Owlbear scene.
 * Returns the number of tokens deleted, 0 if none were linked, or -1 if
 * cleanup could not run (busy or bridge failure). */
export async function cleanupEncounterTokens(encounterId: string): Promise<number> {
  const active = connection;
  const sceneId = activeSceneId();
  if (!active || !sceneId) return 0;
  const instanceIds = mappingsFor(owlbearStore.value, encounterId, sceneId)
    .filter((entry) => !entry.missing && entry.tokenIds.length > 0)
    .map((entry) => entry.instanceId);
  if (!instanceIds.length) return 0;
  if (owlbearBusy.value) {
    toast("Wait for the current Owlbear sync to finish before removing tokens.");
    return -1;
  }
  owlbearBusy.value = true;
  try {
    const result = await active.client.request<{ deleted: number }>(
      "CLEANUP_COMBATANTS",
      { encounterId, instanceIds, expectedSceneId: sceneId },
      STATE_TIMEOUT_MS,
    );
    if (connection === active && activeSceneId() === sceneId) {
      const roomId = owlbearConnection.value.scene?.roomId ?? "";
      commitStore(replaceSceneMappings(owlbearStore.value, roomId, sceneId, [], encounterId));
      if (activeEncounter().id === encounterId) syncLinkedInstancesCount();
    }
    if (result.deleted)
      toast(`Removed ${result.deleted} token${result.deleted === 1 ? "" : "s"} from Owlbear.`);
    return result.deleted;
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not remove tokens from Owlbear.");
    return -1;
  } finally {
    owlbearBusy.value = false;
  }
}

export async function cancelSharedRoll(): Promise<void> {
  resetPendingSharedRoll();
  const active = connection;
  if (!active) return;
  try {
    await active.client.request("DICE_CONTROL", { action: "cancel" }, 5_000);
  } catch {
    // Older companion extensions may not support DICE_CONTROL; local unlock already ran.
  }
  toast("Pending dice roll cancelled.");
}

export async function retryConnectedDice(): Promise<void> {
  const active = connection;
  if (!active) return;
  try {
    await active.client.request("DICE_CONTROL", { action: "retry" }, 5_000);
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : "Retry Connected Dice from the Owlbear extension popover.",
    );
  }
}

export async function setConnectedDiceGmOnly(gmOnly: boolean): Promise<void> {
  const active = connection;
  if (!active) return;
  try {
    await active.client.request("DICE_CONTROL", { action: "set-gm-only", gmOnly }, 5_000);
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : "Toggle private rolls from the Owlbear extension popover.",
    );
  }
}

// ---------------------------------------------------------------------------
// Incoming events
// ---------------------------------------------------------------------------

function handleEvent(type: BridgeEventType, payload: unknown): void {
  switch (type) {
    case "CONNECTED": {
      const data = payload as {
        scene: SceneSummary;
        extensionVersion: string;
        linkedInstances: number;
        settings?: ExtensionSettingsSummary;
      };
      const currentStatus = owlbearConnection.peek().status;
      // Do not clobber an active synchronization or connected state with
      // CONNECT's initial 0-linked summary event.
      if (currentStatus === "synchronizing" || currentStatus === "connected") {
        setConnection({
          extensionVersion: data.extensionVersion,
          ...(data.settings !== undefined ? { settings: data.settings } : {}),
        });
        return;
      }
      setConnection({
        status: "connected",
        scene: data.scene,
        extensionVersion: data.extensionVersion,
        linkedInstances: data.linkedInstances,
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
      });
      return;
    }
    case "DISCONNECTED": {
      const reason = (payload as { reason: string }).reason;
      handleTransportClosed("disconnected", reason);
      return;
    }
    case "SCENE_CHANGED": {
      const data = payload as {
        scene: SceneSummary;
        reason?: "scene" | "rings" | "conditions";
        settings?: ExtensionSettingsSummary;
      };
      const scene = data.scene;
      sync.setOutboundReady(false);
      setConnection({
        status: "synchronizing",
        scene,
        detail: "Scene changed in Owlbear.",
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
      });
      log(
        data.reason === "conditions"
          ? `Owlbear condition sync setting changed · ${scene.label}`
          : data.reason === "rings"
            ? `Owlbear Rings Initiative setting changed · ${scene.label}`
            : `Owlbear scene changed · ${scene.label}`,
      );
      void synchronizeAfterConnect(0, {
        preserveLocalConditions: data.reason === "conditions",
      });
      return;
    }
    case "SETTINGS_UPDATED": {
      const data = payload as { settings: ExtensionSettingsSummary };
      if (!data.settings.diceEnabled) resetPendingSharedRoll();
      setConnection({ settings: data.settings });
      return;
    }
    case "INITIATIVE_UPDATED": {
      const data = payload as { sceneId: string; initiative: InitiativeState };
      if (data.sceneId === activeSceneId()) sync.receiveInitiative(data.initiative);
      return;
    }
    case "COMBATANT_UPDATED": {
      sync.applyExternalUpdate(
        payload as {
          encounterId: string;
          update: CombatantUpdate;
          sceneId: string;
          tokenIds: string[];
          observedAt: number;
        },
      );
      return;
    }
    case "TOKEN_DELETED": {
      sync.markTokenDeleted(
        payload as {
          encounterId: string;
          instanceId: string;
          sceneId?: string;
          tokenIds: string[];
          allMissing: boolean;
        },
      );
      return;
    }
    case "SELECTION_CHANGED": {
      const data = payload as { encounterId?: string | null; instanceId: string | null };
      if (!owlbearStore.value.inverseSelection) return;
      if (!data.instanceId) {
        notifyOwlbearSelection(null);
        return;
      }
      if (data.encounterId && data.encounterId !== activeEncounter().id) {
        notifyOwlbearSelection(null);
        return;
      }
      const live = activeEncounter().combat.instances.some((entry) => entry.id === data.instanceId);
      if (!live) {
        notifyOwlbearSelection(null);
        return;
      }
      notifyOwlbearSelection(data.instanceId);
      return;
    }
    case "SYNC_CONFLICT": {
      const data = payload as {
        instanceId?: string;
        local?: number;
        external?: number;
        policy?: string;
      };
      log(
        `Owlbear reported a stamina conflict${data.instanceId ? ` for ${data.instanceId} (local ${data.local}, Owlbear ${data.external}, ${data.policy})` : ""}.`,
      );
      return;
    }
    case "IMPORT_PROGRESS": {
      const data = payload as { done: number; total: number };
      setConnection({ progress: { done: data.done, total: data.total } });
      return;
    }
    case "IMPORT_FAILED": {
      const data = payload as { error: { message: string } };
      log(`Extension import failed: ${data.error.message}`);
      setConnection({ lastError: data.error.message });
      return;
    }
    case "ERROR": {
      const data = payload as { error: { message: string } };
      log(`Extension error: ${data.error.message}`);
      setConnection({ lastError: data.error.message });
      return;
    }
    case "IMPORT_COMPLETED":
    case "PONG":
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

export function connectFromSite(room: string, extension: string): void {
  if (!siteLink) {
    setConnection({
      status: "error",
      lastError:
        "Owlbear pairing requires a secure browser context. Open Malice over HTTPS and try again.",
    });
    return;
  }
  const roomUrl = owlbearRoomUrl(room);
  const origin = extensionOrigin(extension);
  if (!roomUrl || !origin) {
    setConnection({
      status: "error",
      lastError: !roomUrl
        ? "Paste an Owlbear Rodeo room link (https://www.owlbear.rodeo/room/…)."
        : "Enter the HTTPS address where your Malice extension is hosted.",
    });
    return;
  }
  clearRetryTimers();
  clearPendingApproval(true);
  adoptingLease = false;
  connection?.client.close("Starting a new connection.");
  connection = null;
  sync.setOutboundReady(false);
  sessionLease?.clear();
  siteLink.connect(roomUrl, origin);
  log(`Connecting from this tab to the extension at ${origin}.`);
}

export async function disconnectOwlbear(): Promise<void> {
  siteLink?.stop();
  const active = connection;
  if (active) {
    try {
      await active.client.request("DISCONNECT", {}, 2_000);
    } catch {
      // Closing the port is the real disconnect.
    }
    active.client.close("Disconnected from Malice Menagerie.");
  }
  sessionLease?.clear();
  handleTransportClosed("disconnected", "Not connected to Owlbear Rodeo.");
  log("Disconnected by the GM.");
}

export function forgetTrustedOrigin(origin: string): void {
  commitStore({
    ...owlbearStore.value,
    trustedOrigins: owlbearStore.value.trustedOrigins.filter((entry) => entry !== origin),
  });
  if (connection?.origin === origin) void disconnectOwlbear();
  log(`Forgot trusted origin ${origin}.`);
}

export function installSyncDriver(): void {
  sync.installSyncDriver();
}

export function initOwlbearIntegration(): void {
  if (initialized || typeof globalThis.crypto?.randomUUID !== "function") return;
  initialized = true;
  setDiceTransport((bonus, edge) => {
    const active = connection;
    const stateSnapshot = owlbearConnection.value;
    if (!active || !["connected", "synchronizing"].includes(stateSnapshot.status)) return null;
    // When the companion explicitly reports Connected Dice is off, roll locally
    // right away without flashing a "Rolling…" toast or round-tripping the bridge.
    if (stateSnapshot.settings && !stateSnapshot.settings.diceEnabled) return null;
    const netEdges = { "double-bane": -2, bane: -1, normal: 0, edge: 1, "double-edge": 2 }[edge];
    const requestedAt = Date.now();
    return active.client
      .request<import("../../shared/obr/protocol.ts").DiceRollResponse>(
        "ROLL_POWER",
        { bonus, netEdges },
        20_000,
      )
      .then((result) => ({
        dice: result.dice,
        ...(result.dice
          ? { onApplied: trackDicePresentation(requestedAt, result.timing, log) }
          : {}),
      }));
  });
  if (initialPairing.awaiting) {
    // Strip pairing params from the URL bar/history immediately; keep in memory.
    stripConnectUrlParams();
  }
  siteLink = createSiteLink({
    onHello: adoptConnection,
    isConnected: () =>
      adoptingLease ||
      (connection !== null &&
        !connection.client.isClosed &&
        ["connecting", "connected", "synchronizing"].includes(owlbearConnection.value.status)),
    onReset: () => {
      clearRetryTimers();
      resetPendingSharedRoll();
      connection?.client.close("Reconnecting to the Owlbear room.");
      connection = null;
      sync.setOutboundReady(false);
      notifyOwlbearSelection(null);
      clearUnresolvedStatblocks();
      setStatus("connecting", "Reconnecting to Owlbear Rodeo…");
      log("The Owlbear background restarted. Reconnecting automatically.");
    },
    onWaiting: () =>
      setConnection({
        status: "connecting",
        detail: "Waiting for the extension in your Owlbear room…",
        lastError: null,
      }),
    onError: (message) => {
      setConnection({ status: "error", detail: message, lastError: message });
      log(message);
    },
  });
  // New windows can inherit their opener's session-storage namespace, even
  // through a cross-origin room. An explicit extension pairing URL must take
  // precedence over any copied site-connection capability.
  if (initialPairing.awaiting) siteLink.stop();
  sessionLease = openSessionLease({
    name: sessionLeaseId(initialPairing.awaiting),
    role: "client",
    onAdopt: (hello, origin, port) => {
      log("Attaching the Owlbear channel from the connection worker.");
      adoptConnectionPort(hello, origin, port);
    },
    onForgot: (reason) => {
      if (reason === "displaced") {
        // Another tab took over this lease locally; do not send SITE_STOP or
        // tear down the new owner's remote connection.
        siteLink?.dispose();
      } else {
        siteLink?.stop();
      }
      connection?.client.close("Disconnected from Owlbear Rodeo.");
      handleTransportClosed(
        "disconnected",
        reason === "displaced"
          ? "Owlbear connection moved to another tab."
          : "Disconnected from Owlbear Rodeo.",
      );
    },
    onError: () => {
      adoptingLease = false;
      const message =
        "The connection worker failed to load. Reconnect from the extension and check the browser console.";
      log(message);
      // Only surface a visible error if an active session was disrupted;
      // direct pairing still works without the session worker.
      if (connection) {
        setConnection({ status: "error", detail: message, lastError: message });
      }
    },
  });
  // The popover opens this window with a fixed name. If that name stuck, a
  // later Connect would reuse it and navigate — that is, reload — the tab the
  // user is working in. Dropping the name makes every Connect open a throwaway
  // pairing tab that hands the connection over and closes.
  try {
    window.name = "";
  } catch {
    // Some browsers restrict the name; the opener channel still works.
  }
  window.addEventListener("message", handleWindowMessage);
  window.addEventListener("beforeunload", () => {
    flushPendingLogSave();
    siteLink?.dispose();
    connection?.client.close("Malice Menagerie closed.");
    relay?.close();
    relay = null;
  });
  try {
    relay = openPairingRelay({ pairing: initialPairing.awaiting, onAdopt: adoptRelayed });
  } catch (error) {
    relay = null;
    log(
      `Tab hand-off is unavailable (${
        error instanceof Error ? error.message : String(error)
      }); this tab will keep the connection.`,
    );
  }
  if (!relay && initialPairing.awaiting) {
    log("Tab hand-off is unavailable in this browser; this tab will keep the connection.");
  }
  installSyncDriver();
  // Wait for the relay probe so a pairing tab knows whether to answer the
  // popover itself or hand the connection to an already-open tab.
  void pairingGate().then(announceReady);
  log("Owlbear integration ready. Waiting for the companion extension.");
}

/** Tell the extension popover that this newly opened window is listening. */
function announceReady(): void {
  if (!owlbearAwaitingPair.value || !window.opener) return;
  const raw = pairingOrigin ?? referrerOrigin();
  const target = raw ? parseAllowedOrigin(raw) : null;
  if (!target) return;
  try {
    window.opener.postMessage(makeReadyMessage(), target);
  } catch {
    // Opener navigated or closed.
  }
}

function referrerOrigin(): string | null {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

export {
  PROTOCOL_VERSION,
  ProtocolError,
  allMappingsForEncounter,
  clearEncounterMappings,
  clearUnresolvedStatblocks,
  defeatedMappings,
  findMapping,
  openOwlbearPanel,
  orphanedMappings,
  owlbearBusy,
  owlbearConnection,
  owlbearLog,
  owlbearPanelOpen,
  owlbearPendingApproval,
  owlbearSelectedInstanceId,
  owlbearSelectionPulse,
  owlbearStore,
  owlbearUnresolved,
  removeManualStatblock,
  restartReattachableMappings,
  setInverseSelection,
  setManualStatblock,
  toggleOwlbearPanel,
  type OwlbearConnectionState,
  type PendingPairingApproval,
};
