import type { CombatInstance, Encounter, Monster } from "../types.ts";
import type {
  DesiredCombatant,
  ImportMode,
  StatblockRef,
  TokenMapping,
} from "../../shared/obr/protocol.ts";
import { LIMITS, parseAllowedOrigin } from "../../shared/obr/protocol.ts";
import { standing } from "../lib/minions.ts";
import { resolveStatblock, statblockKey, type ManualStatblockMap } from "./statblocks.ts";

/** Integration state persisted by Malice. Separate from the encounter save so
    existing saves and the standalone app are untouched. */
export interface PersistedSceneLinks {
  sceneId: string;
  roomId: string;
  mappings: TokenMapping[];
  updatedAt: number;
}

export interface PersistedEncounterIntegration {
  scenes: Record<string, PersistedSceneLinks>;
  updatedAt: number;
}

export interface PersistedIntegration {
  version: 1;
  trustedOrigins: string[];
  encounters: Record<string, PersistedEncounterIntegration>;
  manualStatblocks: Record<string, StatblockRef>;
  learnedStatblocks: Record<string, StatblockRef>;
  lastSelectedInstanceId: string | null;
  inverseSelection: boolean;
  log: string[];
}

export const INTEGRATION_STORAGE_KEY = "steel-table-owlbear-v1";
export const INTEGRATION_STORAGE_VERSION = 1 as const;

export function emptyIntegration(): PersistedIntegration {
  return {
    version: INTEGRATION_STORAGE_VERSION,
    trustedOrigins: [],
    encounters: {},
    manualStatblocks: {},
    learnedStatblocks: {},
    lastSelectedInstanceId: null,
    inverseSelection: false,
    log: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, max = 200): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, max)
    : [];
}

function statblockMap(value: unknown): Record<string, StatblockRef> {
  if (!isRecord(value)) return {};
  const out: Record<string, StatblockRef> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const resourceId = entry["resourceId"];
    const name = entry["name"];
    if (typeof resourceId === "string" && typeof name === "string") out[key] = { resourceId, name };
  }
  return out;
}

function mapping(value: unknown): TokenMapping | null {
  if (!isRecord(value)) return null;
  const instanceId = value["instanceId"];
  const encounterId = value["encounterId"];
  const sceneId = value["sceneId"];
  const name = value["name"];
  const kind = value["kind"];
  if (
    typeof instanceId !== "string" ||
    typeof encounterId !== "string" ||
    typeof sceneId !== "string" ||
    typeof name !== "string" ||
    (kind !== "creature" && kind !== "minion-squad")
  )
    return null;
  return {
    encounterId,
    instanceId,
    sceneId,
    tokenIds: strings(value["tokenIds"], LIMITS.tokenIdsPerInstance),
    minionGroupId: typeof value["minionGroupId"] === "string" ? value["minionGroupId"] : null,
    entryId: typeof value["entryId"] === "string" ? value["entryId"] : null,
    slot: Number.isInteger(value["slot"]) ? Math.max(0, Number(value["slot"])) : 0,
    kind,
    name: name.slice(0, 120),
    ...(Array.isArray(value["conditions"]) ? { conditions: strings(value["conditions"], 32) } : {}),
    currentStamina: Math.max(0, Number(value["currentStamina"]) || 0),
    maxStamina: Math.max(0, Number(value["maxStamina"]) || 0),
    individualStamina:
      value["individualStamina"] === null
        ? null
        : Math.max(0, Number(value["individualStamina"]) || 0),
    ...(typeof value["visible"] === "boolean" ? { visible: value["visible"] } : {}),
    missing: value["missing"] === true,
    updatedAt: Number(value["updatedAt"]) || 0,
  };
}

/** Defensive read of the integration cache. Corrupt or old data is dropped,
    never allowed to break the encounter app. */
export function sanitizeIntegration(value: unknown): PersistedIntegration {
  const base = emptyIntegration();
  if (!isRecord(value) || value["version"] !== INTEGRATION_STORAGE_VERSION) return base;
  base.trustedOrigins = [
    ...new Set(
      strings(value["trustedOrigins"], 20)
        .map((origin) => parseAllowedOrigin(origin))
        .filter((origin): origin is string => origin !== null),
    ),
  ];
  if (isRecord(value["encounters"])) {
    for (const [encounterId, rawEncounter] of Object.entries(value["encounters"])) {
      if (!isRecord(rawEncounter) || !isRecord(rawEncounter["scenes"])) continue;
      const scenes: Record<string, PersistedSceneLinks> = {};
      for (const [sceneId, rawScene] of Object.entries(rawEncounter["scenes"])) {
        if (!isRecord(rawScene)) continue;
        const mappings = Array.isArray(rawScene["mappings"])
          ? rawScene["mappings"].flatMap((entry) => {
              const parsed = mapping(entry);
              return parsed ? [parsed] : [];
            })
          : [];
        scenes[sceneId] = {
          sceneId,
          roomId: typeof rawScene["roomId"] === "string" ? rawScene["roomId"] : "",
          mappings,
          updatedAt: Number(rawScene["updatedAt"]) || 0,
        };
      }
      base.encounters[encounterId] = { scenes, updatedAt: Number(rawEncounter["updatedAt"]) || 0 };
    }
  }
  base.manualStatblocks = statblockMap(value["manualStatblocks"]);
  base.learnedStatblocks = statblockMap(value["learnedStatblocks"]);
  base.lastSelectedInstanceId =
    typeof value["lastSelectedInstanceId"] === "string" ? value["lastSelectedInstanceId"] : null;
  base.inverseSelection = value["inverseSelection"] === true;
  base.log = strings(value["log"], 50).map((line) => line.slice(0, 400));
  return base;
}

export function loadIntegration(): PersistedIntegration {
  try {
    return sanitizeIntegration(JSON.parse(localStorage.getItem(INTEGRATION_STORAGE_KEY) ?? "null"));
  } catch {
    return emptyIntegration();
  }
}

export function saveIntegration(value: PersistedIntegration): void {
  try {
    localStorage.setItem(
      INTEGRATION_STORAGE_KEY,
      JSON.stringify({ ...value, log: value.log.slice(-50) }),
    );
  } catch {
    // Best effort, like the encounter save.
  }
}

export function mappingsFor(
  store: PersistedIntegration,
  encounterId: string,
  sceneId: string,
): TokenMapping[] {
  return store.encounters[encounterId]?.scenes[sceneId]?.mappings ?? [];
}

export function allMappingsForEncounter(
  store: PersistedIntegration,
  encounterId: string,
): TokenMapping[] {
  const encounter = store.encounters[encounterId];
  return encounter ? Object.values(encounter.scenes).flatMap((scene) => scene.mappings) : [];
}

export function mergeSceneMappings(
  store: PersistedIntegration,
  roomId: string,
  sceneId: string,
  incoming: readonly TokenMapping[],
  encounterId: string,
): PersistedIntegration {
  const existingEncounter = store.encounters[encounterId];
  const existing = existingEncounter?.scenes[sceneId]?.mappings ?? [];
  const byInstance = new Map(existing.map((entry) => [entry.instanceId, entry]));
  for (const entry of incoming) {
    if (entry.encounterId !== encounterId || entry.sceneId !== sceneId) continue;
    byInstance.set(entry.instanceId, entry);
  }
  const now = Date.now();
  return {
    ...store,
    encounters: {
      ...store.encounters,
      [encounterId]: {
        scenes: {
          ...existingEncounter?.scenes,
          [sceneId]: {
            sceneId,
            roomId,
            mappings: [...byInstance.values()],
            updatedAt: now,
          },
        },
        updatedAt: now,
      },
    },
  };
}

/**
 * Replace one encounter's mappings for one scene with an authoritative snapshot
 * from Owlbear. Imports and reconnects return every token they know about, so a
 * merge would keep mappings for tokens that were deleted while disconnected.
 */
export function replaceSceneMappings(
  store: PersistedIntegration,
  roomId: string,
  sceneId: string,
  incoming: readonly TokenMapping[],
  encounterId: string,
): PersistedIntegration {
  const existingEncounter = store.encounters[encounterId];
  const now = Date.now();
  return {
    ...store,
    encounters: {
      ...store.encounters,
      [encounterId]: {
        scenes: {
          ...existingEncounter?.scenes,
          [sceneId]: {
            sceneId,
            roomId,
            mappings: incoming.filter(
              (entry) => entry.encounterId === encounterId && entry.sceneId === sceneId,
            ),
            updatedAt: now,
          },
        },
        updatedAt: now,
      },
    },
  };
}

export function upsertMapping(
  store: PersistedIntegration,
  roomId: string,
  entry: TokenMapping,
): PersistedIntegration {
  return mergeSceneMappings(store, roomId, entry.sceneId, [entry], entry.encounterId);
}

export function clearEncounterMappings(
  store: PersistedIntegration,
  encounterId: string,
): PersistedIntegration {
  const next = { ...store.encounters };
  delete next[encounterId];
  return { ...store, encounters: next };
}

/** Stable per-encounter minion group id. Scoped again by scene in Owlbear. */
export function minionGroupIdFor(instanceId: string, encounterId?: string): string {
  return encounterId
    ? `mm-${encounterId}-${instanceId}`.slice(0, 160)
    : `mm-${instanceId}`.slice(0, 160);
}

export function clampProtocolStamina(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LIMITS.stamina, Math.max(0, Math.round(value)));
}

export function boundedProtocolText(value: string, max: number, fallback: string): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

export function boundedProtocolConditions(conditions: readonly string[]): string[] {
  return conditions
    .map((entry) => entry.trim().slice(0, 120))
    .filter((entry) => entry.length > 0)
    .slice(0, 32);
}

/** The ordinal of each instance within its prep entry. Stable across a
    restart because it follows the same encounter-entry order the board does. */
export function slotIndexes(instances: readonly CombatInstance[]): Map<string, number> {
  const counters = new Map<string, number>();
  const slots = new Map<string, number>();
  for (const instance of instances) {
    const key = instance.entryId ?? `summoned:${instance.id}`;
    const slot = counters.get(key) ?? 0;
    slots.set(instance.id, slot);
    counters.set(key, slot + 1);
  }
  return slots;
}

/**
 * When a whole combat was restarted, every instance id is new. In that case
 * (or for remaining unattached entries after a partial restart send), reattach
 * old tokens to new instances by prep entry and slot so a restart does not
 * duplicate the map. Partial roster edits never reuse a token for a different
 * creature.
 */
export function alignMappingsAfterRestart(
  encounterId: string,
  mappings: readonly TokenMapping[],
  instances: readonly CombatInstance[],
): { mappings: TokenMapping[]; changed: boolean } {
  if (!mappings.length || !instances.length) return { mappings: [...mappings], changed: false };
  const currentIds = new Set(instances.map((instance) => instance.id));
  const overlap = mappings.some((entry) => currentIds.has(entry.instanceId));
  if (overlap) return { mappings: [...mappings], changed: false };

  const slots = slotIndexes(instances);
  const byKey = new Map<string, CombatInstance>();
  for (const instance of instances) {
    byKey.set(instanceKey(instance, slots.get(instance.id) ?? 0), instance);
  }
  let changed = false;
  const next = mappings.map((entry) => {
    if (!entry.entryId) return entry;
    const match = byKey.get(`${entry.kind}|${entry.entryId}|${entry.slot}`);
    if (!match || match.id === entry.instanceId) return entry;
    changed = true;
    return {
      ...entry,
      instanceId: match.id,
      minionGroupId:
        match.kind === "minion-squad"
          ? (entry.minionGroupId ?? minionGroupIdFor(match.id, encounterId))
          : null,
    };
  });
  return { mappings: next, changed };
}

function instanceKey(instance: CombatInstance, slot: number): string {
  return `${instance.kind}|${instance.entryId ?? ""}|${slot}`;
}

export interface UnresolvedStatblock {
  key: string;
  name: string;
  level: number;
  reason: string;
  candidates: { resourceId: string; name: string; level: number }[];
}

export interface ImportPlan {
  combatants: DesiredCombatant[];
  unresolved: UnresolvedStatblock[];
  missingMonsters: string[];
}

export interface PlanOptions {
  encounter: Encounter;
  mappings: readonly TokenMapping[];
  lookup: (sourcePath: string) => Monster | undefined;
  manualStatblocks?: ManualStatblockMap;
  learnedStatblocks?: ManualStatblockMap;
}

/** Expand the live combat roster into the exact set of map entities. */
export function planImport(options: PlanOptions): ImportPlan {
  const { encounter, mappings, lookup } = options;
  const instances = encounter.combat.instances;
  const slots = slotIndexes(instances);
  const byInstance = new Map(mappings.map((entry) => [entry.instanceId, entry]));
  const combatants: DesiredCombatant[] = [];
  const unresolved: UnresolvedStatblock[] = [];
  const seenUnresolved = new Set<string>();
  const missingMonsters: string[] = [];

  for (const instance of instances) {
    const monster = lookup(instance.sourcePath);
    if (!monster) {
      missingMonsters.push(instance.sourcePath);
      continue;
    }
    const slot = slots.get(instance.id) ?? 0;
    const mapping = byInstance.get(instance.id);
    const resolution = resolveStatblock(monster, {
      ...(options.manualStatblocks ? { manual: options.manualStatblocks } : {}),
      ...(options.learnedStatblocks ? { learned: options.learnedStatblocks } : {}),
    });
    if (!resolution.ref) {
      const key = statblockKey(monster.name, monster.printed?.level ?? monster.level);
      if (!seenUnresolved.has(key)) {
        seenUnresolved.add(key);
        unresolved.push({
          key,
          name: monster.name,
          level: monster.printed?.level ?? monster.level,
          reason: resolution.reason,
          candidates: resolution.candidates.map((candidate) => ({
            resourceId: candidate.id,
            name: candidate.name,
            level: candidate.level,
          })),
        });
      }
    }
    const size =
      monster.size !== undefined &&
      monster.size !== null &&
      String(monster.size).trim() !== "" &&
      String(monster.size).trim() !== "—"
        ? String(monster.size).trim().slice(0, 20)
        : undefined;
    combatants.push({
      instanceId: instance.id,
      sourcePath: instance.sourcePath.slice(0, 1024),
      ...(size ? { size } : {}),
      entryId: instance.entryId ?? null,
      slot,
      kind: instance.kind,
      name: boundedProtocolText(instance.name, LIMITS.nameLength, "Combatant"),
      count:
        instance.kind === "minion-squad"
          ? Math.min(LIMITS.minionsPerSquad, Math.max(1, Math.round(instance.count || 1)))
          : 1,
      activationGroupId: instance.groupId,
      activationGroupName: boundedProtocolText(
        encounter.groups.find((group) => group.id === instance.groupId)?.name ?? "Ungrouped",
        LIMITS.groupNameLength,
        "Ungrouped",
      ),
      ...(instance.kind !== "minion-squad"
        ? { conditions: boundedProtocolConditions(instance.conditions) }
        : {}),
      currentStamina: clampProtocolStamina(instance.currentStamina),
      maxStamina: clampProtocolStamina(instance.maxStamina),
      individualStamina:
        instance.kind === "minion-squad"
          ? Math.max(1, clampProtocolStamina(perMinionStamina(instance, monster)))
          : null,
      statblock: resolution.ref,
      minionGroupId:
        instance.kind === "minion-squad"
          ? (mapping?.minionGroupId ?? minionGroupIdFor(instance.id, encounter.id))
          : null,
      existingTokenIds:
        mapping && !mapping.missing ? mapping.tokenIds.slice(0, LIMITS.tokenIdsPerInstance) : [],
      summoned: instance.summonedBy !== undefined,
    });
  }

  return { combatants, unresolved, missingMonsters };
}

export function perMinionStamina(
  instance: Pick<CombatInstance, "count" | "maxStamina">,
  monster?: Pick<Monster, "stamina">,
): number {
  if (instance.count > 0 && instance.maxStamina > 0) {
    const perMinion = Math.round(instance.maxStamina / instance.count);
    if (perMinion > 0) return perMinion;
  }
  return Math.max(1, monster?.stamina ?? 1);
}

/**
 * How many tokens a combatant should have on the map right now.
 *
 * Minion squads track standing minions rather than starting roster size, so
 * deleting a fallen minion in Owlbear neither flags it as missing nor respawns
 * it on the next send.
 */
export function desiredTokenCount(
  instance: Pick<CombatInstance, "kind" | "count"> & {
    currentStamina?: number;
    maxStamina?: number;
  },
  individualStamina?: number | null,
): number {
  if (instance.kind !== "minion-squad") {
    return typeof instance.currentStamina === "number" && instance.currentStamina <= 0 ? 0 : 1;
  }
  const total = Math.max(1, instance.count);
  if (typeof instance.currentStamina !== "number") return total;
  if (instance.currentStamina <= 0) return 0;
  const perMinion =
    typeof individualStamina === "number" &&
    Number.isFinite(individualStamina) &&
    individualStamina > 0
      ? Math.max(1, Math.round(individualStamina))
      : typeof instance.maxStamina === "number" && instance.maxStamina > 0
        ? Math.max(1, Math.round(instance.maxStamina / total))
        : 0;
  if (perMinion <= 0) return total;
  return Math.min(total, standing(instance.currentStamina, perMinion));
}

export function encounterSyncSummary(
  encounter: Encounter,
  mappings: readonly TokenMapping[],
): { unsentTokens: number; linkedInstances: number; totalInstances: number } {
  const byInstance = new Map(mappings.map((entry) => [entry.instanceId, entry]));
  const instances = encounter.combat.instances;
  if (!instances.length) {
    const unsentTokens = encounter.items.reduce((sum, entry) => sum + Math.max(1, entry.count), 0);
    return { unsentTokens, linkedInstances: 0, totalInstances: encounter.items.length };
  }
  let unsentTokens = 0;
  let linkedInstances = 0;
  for (const instance of instances) {
    const desired = desiredTokenCount(instance);
    const mapping = byInstance.get(instance.id);
    const present = mapping && !mapping.missing ? new Set(mapping.tokenIds).size : 0;
    if (present > 0) linkedInstances += 1;
    if (present < desired) unsentTokens += desired - present;
  }
  return { unsentTokens, linkedInstances, totalInstances: instances.length };
}

/** The button the encounter should offer right now. */
export function nextImportMode(mappings: readonly TokenMapping[], plan: ImportPlan): ImportMode {
  if (!mappings.length) return "import";
  const byInstance = new Map(mappings.map((entry) => [entry.instanceId, entry]));
  return plan.combatants.some((combatant) => {
    const desiredCount = desiredTokenCount(combatant, combatant.individualStamina);
    if (desiredCount <= 0) return false;
    const mapping = byInstance.get(combatant.instanceId);
    return !mapping || mapping.missing || new Set(mapping.tokenIds).size < desiredCount;
  })
    ? "add"
    : "reconcile";
}
