import { signal } from "@preact/signals";
import { activeEncounter, toast } from "../store.ts";
import type { ConnectionStatus } from "./client.ts";
import {
  alignMappingsAfterRestart,
  encounterSyncSummary,
  loadIntegration,
  mappingsFor,
  sanitizeIntegration,
  saveIntegration,
  type PersistedIntegration,
  type UnresolvedStatblock,
} from "./identity.ts";
import type {
  ExtensionSettingsSummary,
  SceneSummary,
  StatblockRef,
  TokenMapping,
} from "../../shared/obr/protocol.ts";

export interface OwlbearConnectionState {
  status: ConnectionStatus;
  detail: string;
  scene: SceneSummary | null;
  extensionVersion: string;
  origin: string;
  linkedInstances: number;
  settings: ExtensionSettingsSummary | null;
  progress: { done: number; total: number } | null;
  lastError: string | null;
}

const initialStore = loadIntegration();

/** Persisted integration cache. The durable source of identity is Owlbear
    token metadata; this cache keeps the app fast. */
export const owlbearStore = signal<PersistedIntegration>(initialStore);
export const owlbearConnection = signal<OwlbearConnectionState>({
  status: "disconnected",
  detail: "Not connected to Owlbear Rodeo.",
  scene: null,
  extensionVersion: "",
  origin: "",
  linkedInstances: 0,
  settings: null,
  progress: null,
  lastError: null,
});
export interface PendingPairingApproval {
  origin: string;
}

export const owlbearPanelOpen = signal(false);
export const owlbearBusy = signal(false);
export const owlbearUnresolved = signal<UnresolvedStatblock[]>([]);
export const owlbearSelectedInstanceId = signal<string | null>(initialStore.lastSelectedInstanceId);
export const owlbearSelectionPulse = signal<{ instanceId: string; seq: number } | null>(null);
export const owlbearLog = signal<string[]>(initialStore.log);
export const owlbearPendingApproval = signal<PendingPairingApproval | null>(null);

let selectionPulseSeq = 0;

export function notifyOwlbearSelection(instanceId: string | null): void {
  owlbearSelectedInstanceId.value = instanceId;
  owlbearSelectionPulse.value = instanceId ? { instanceId, seq: ++selectionPulseSeq } : null;
}

/**
 * A pairing-only tab is about to hand its port to the tab the user already
 * has open. It must not write the integration cache: it loaded that cache
 * before the target adopted, so saving its copy would roll the target's
 * mappings and trusted origins back. Persistence is switched on only if this
 * tab ends up owning the connection itself.
 */
let persistIntegration = true;
let logSaveTimer: ReturnType<typeof setTimeout> | undefined;

export function setPersistIntegration(enabled: boolean): void {
  persistIntegration = enabled;
}

/**
 * Before a pairing-only tab promotes itself to a persistent owner, re-read
 * localStorage so it does not overwrite mappings or trusted origins saved by
 * another tab since boot.
 */
export function refreshPersistedStore(): void {
  const fresh = loadIntegration();
  const current = owlbearStore.peek();
  owlbearStore.value = sanitizeIntegration({
    ...fresh,
    trustedOrigins: [...new Set([...fresh.trustedOrigins, ...current.trustedOrigins])],
    manualStatblocks: { ...fresh.manualStatblocks, ...current.manualStatblocks },
    learnedStatblocks: { ...fresh.learnedStatblocks, ...current.learnedStatblocks },
    log: owlbearLog.peek(),
  });
}

/**
 * Record an approved extension origin in localStorage without turning on full
 * store persistence for a throwaway pairing tab that may hand off to another tab.
 */
export function persistTrustedOrigin(origin: string): void {
  const fresh = loadIntegration();
  const nextTrusted = fresh.trustedOrigins.includes(origin)
    ? fresh.trustedOrigins
    : [...fresh.trustedOrigins, origin];
  const merged = sanitizeIntegration({ ...fresh, trustedOrigins: nextTrusted });
  saveIntegration(merged);
  const current = owlbearStore.peek();
  owlbearStore.value = sanitizeIntegration({
    ...current,
    trustedOrigins: [...new Set([...current.trustedOrigins, ...nextTrusted])],
  });
}

export function syncLinkedInstancesCount(): void {
  const sceneId = activeSceneId();
  if (!sceneId) return;
  const encounter = activeEncounter();
  const mappings = mappingsFor(owlbearStore.peek(), encounter.id, sceneId);
  const { linkedInstances } = encounterSyncSummary(encounter, mappings);
  if (owlbearConnection.peek().linkedInstances !== linkedInstances) {
    setConnection({ linkedInstances });
  }
}

function clearLogSaveTimer(): void {
  if (logSaveTimer !== undefined) {
    clearTimeout(logSaveTimer);
    logSaveTimer = undefined;
  }
}

export function flushPendingLogSave(): void {
  if (logSaveTimer === undefined) return;
  clearLogSaveTimer();
  if (persistIntegration) saveIntegration({ ...owlbearStore.peek(), log: owlbearLog.peek() });
}

export function commitStore(next: PersistedIntegration): void {
  const clean = sanitizeIntegration({ ...next, log: owlbearLog.peek() });
  owlbearStore.value = clean;
  if (persistIntegration) {
    clearLogSaveTimer();
    saveIntegration(clean);
  }
}

/**
 * Append a diagnostic line without sanitizing or bumping `owlbearStore`, so
 * routine logging never triggers reactive outbound diffs or synchronous full
 * store serialization during combat.
 */
export function log(line: string): void {
  const stamped = `${new Date().toLocaleTimeString()} · ${line}`;
  const next = [...owlbearLog.peek(), stamped].slice(-40);
  owlbearLog.value = next;
  if (!persistIntegration || logSaveTimer !== undefined) return;
  logSaveTimer = setTimeout(() => {
    logSaveTimer = undefined;
    if (persistIntegration) saveIntegration({ ...owlbearStore.peek(), log: owlbearLog.peek() });
  }, 500);
}

export function setConnection(patch: Partial<OwlbearConnectionState>): void {
  owlbearConnection.value = { ...owlbearConnection.value, ...patch };
}

export function setStatus(status: ConnectionStatus, detail?: string): void {
  setConnection({
    status,
    ...(detail === undefined ? {} : { detail }),
  });
}

export function activeSceneId(): string | null {
  const scene = owlbearConnection.value.scene;
  return scene?.sceneReady ? scene.sceneId : null;
}

export function trustOrigin(origin: string): void {
  const store = owlbearStore.value;
  if (store.trustedOrigins.includes(origin)) return;
  commitStore({ ...store, trustedOrigins: [...store.trustedOrigins, origin] });
}

export function findMapping(instanceId: string): TokenMapping | null {
  const sceneId = activeSceneId();
  if (!sceneId) return null;
  return (
    mappingsFor(owlbearStore.value, activeEncounter().id, sceneId).find(
      (entry) => entry.instanceId === instanceId,
    ) ?? null
  );
}

/** Mappings from a prior combat run that will automatically reattach by entry
 * and slot on the next Send tokens rather than being orphaned. */
export function restartReattachableMappings(): TokenMapping[] {
  const sceneId = activeSceneId();
  if (!sceneId) return [];
  const encounter = activeEncounter();
  const mappings = mappingsFor(owlbearStore.value, encounter.id, sceneId);
  const aligned = alignMappingsAfterRestart(encounter.id, mappings, encounter.combat.instances);
  if (!aligned.changed) return [];
  const live = new Set(encounter.combat.instances.map((entry) => entry.id));
  const reattachable: TokenMapping[] = [];
  for (let i = 0; i < mappings.length; i += 1) {
    const before = mappings[i]!;
    const after = aligned.mappings[i];
    if (after && after.instanceId !== before.instanceId && live.has(after.instanceId)) {
      reattachable.push(before);
    }
  }
  return reattachable;
}

export function orphanedMappings(): TokenMapping[] {
  const sceneId = activeSceneId();
  if (!sceneId) return [];
  const encounter = activeEncounter();
  const live = new Set(encounter.combat.instances.map((entry) => entry.id));
  const reattachable = new Set(restartReattachableMappings().map((entry) => entry.instanceId));
  return mappingsFor(owlbearStore.value, encounter.id, sceneId).filter(
    (entry) => !live.has(entry.instanceId) && !reattachable.has(entry.instanceId),
  );
}

export function defeatedMappings(): TokenMapping[] {
  const sceneId = activeSceneId();
  if (!sceneId) return [];
  const defeated = new Set(
    activeEncounter()
      .combat.instances.filter((entry) => entry.currentStamina <= 0)
      .map((entry) => entry.id),
  );
  if (!defeated.size) return [];
  return mappingsFor(owlbearStore.value, activeEncounter().id, sceneId).filter(
    (entry) => !entry.missing && entry.tokenIds.length > 0 && defeated.has(entry.instanceId),
  );
}

export function setManualStatblock(key: string, ref: StatblockRef): void {
  commitStore({
    ...owlbearStore.value,
    manualStatblocks: { ...owlbearStore.value.manualStatblocks, [key]: ref },
    learnedStatblocks: { ...owlbearStore.value.learnedStatblocks, [key]: ref },
  });
  owlbearUnresolved.value = owlbearUnresolved.value.filter((entry) => entry.key !== key);
  toast(`Statblock set to ${ref.name}.`);
  log(`Statblock mapping saved: ${key} → ${ref.name} (${ref.resourceId}).`);
}

export function removeManualStatblock(key: string): void {
  const store = owlbearStore.value;
  if (!(key in store.manualStatblocks) && !(key in store.learnedStatblocks)) return;
  const manualStatblocks = { ...store.manualStatblocks };
  const learnedStatblocks = { ...store.learnedStatblocks };
  delete manualStatblocks[key];
  delete learnedStatblocks[key];
  commitStore({ ...store, manualStatblocks, learnedStatblocks });
  toast("Saved statblock choice removed.");
  log(`Removed saved statblock choice for ${key}.`);
}

export function clearUnresolvedStatblocks(): void {
  owlbearUnresolved.value = [];
}

export function openOwlbearPanel(): void {
  owlbearPanelOpen.value = true;
}

export function toggleOwlbearPanel(): void {
  owlbearPanelOpen.value = !owlbearPanelOpen.value;
}

export function setInverseSelection(enabled: boolean): void {
  commitStore({ ...owlbearStore.value, inverseSelection: enabled });
  if (!enabled) notifyOwlbearSelection(null);
}
