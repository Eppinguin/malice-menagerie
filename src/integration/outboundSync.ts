import { effect } from "@preact/signals";
import { monsterAt } from "../data.ts";
import { activeEncounter, mutateApp, releaseCaptain, state, toast } from "../store.ts";
import type { CombatInstance, Encounter } from "../types.ts";
import { ProtocolError, type BridgeClient } from "./client.ts";
import { mergeLabelConditions, sameConditions } from "../../shared/obr/conditionLabels.ts";
import {
  boundedProtocolConditions,
  boundedProtocolText,
  clampProtocolStamina,
  clearEncounterMappings,
  mappingsFor,
  perMinionStamina,
  replaceSceneMappings,
  type ImportPlan,
} from "./identity.ts";
import { applyInitiative, desiredInitiative } from "./initiative.ts";
import {
  LIMITS,
  MAX_COMBATANT_UPDATES,
  type CombatantUpdate,
  type ImportResult,
  type InitiativeState,
  type StatblockRef,
  type TokenMapping,
  type UpdatesResponse,
} from "../../shared/obr/protocol.ts";
import { resolveStatblockRef } from "./statblocks.ts";
import {
  activeSceneId,
  clearUnresolvedStatblocks,
  commitStore,
  log,
  notifyOwlbearSelection,
  owlbearBusy,
  owlbearConnection,
  owlbearSelectedInstanceId,
  owlbearStore,
  setConnection,
  syncLinkedInstancesCount,
} from "./state.ts";
import { clampStamina, decideExternalUpdate, hasPendingLocalChange } from "./syncPolicy.ts";

export interface ActiveConnection {
  client: BridgeClient;
  origin: string;
  sessionId: string;
  pairingToken: string;
}

export interface OutboundStamp {
  conditions?: string[];
  stamina: number;
  maxStamina: number;
  individualStamina?: number | null;
  name: string;
  groupId: string;
  statblock: StatblockRef | null;
  revision: number;
  dirty: boolean;
  /** True when the last UPDATE_COMBATANTS omitted this instance; wait for a
   * scene refresh or a fresh edit to this instance before retrying. */
  deferredRetry?: boolean;
}

export function createOutboundSync(options: {
  getConnection: () => ActiveConnection | null;
  onEncounterSwitched: () => void;
}) {
  let outboundReady = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let diffTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let initiativeRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let revisionCounter = 0;
  let updatesSendingFor: ActiveConnection | null = null;
  let initiativeBaseline: string | null = null;
  let initiativeSendingFor: ActiveConnection | null = null;
  let initiativeNeedsSync = false;
  let initiativeSyncVersion = 0;
  let initiativeRetryAfter = 0;
  let initiativeScope = "";

  // A reconnect may replace the transport, but it must not replace local edits.
  // Separate baselines also prevent edits from leaking into another scene.
  const outboundScopes = new Map<string, Map<string, OutboundStamp>>();

  function outboundFor(encounterId: string): Map<string, OutboundStamp> {
    const scene = owlbearConnection.peek().scene;
    const key = JSON.stringify([scene?.roomId, activeSceneId(), encounterId]);
    let stamps = outboundScopes.get(key);
    if (!stamps) {
      stamps = new Map();
      outboundScopes.set(key, stamps);
    }
    return stamps;
  }

  function evictScopesForEncounter(encounterId: string): void {
    const suffix = `,${JSON.stringify(encounterId)}]`;
    for (const key of outboundScopes.keys()) {
      if (key.endsWith(suffix)) outboundScopes.delete(key);
    }
  }

  function clearAllTimers(): void {
    if (diffTimer !== undefined) {
      clearTimeout(diffTimer);
      diffTimer = undefined;
    }
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    if (initiativeRetryTimer !== undefined) {
      clearTimeout(initiativeRetryTimer);
      initiativeRetryTimer = undefined;
    }
  }

  function stampStatblock(instance: CombatInstance): StatblockRef | null {
    const monster = monsterAt(instance.sourcePath);
    return monster
      ? resolveStatblockRef(monster, {
          manual: owlbearStore.value.manualStatblocks,
          learned: owlbearStore.value.learnedStatblocks,
        })
      : null;
  }

  function stampIndividualStamina(instance: CombatInstance): number | null {
    if (instance.kind !== "minion-squad") return null;
    return perMinionStamina(instance, monsterAt(instance.sourcePath));
  }

  function applyStaminaAndConditionsToApp(
    encounterId: string,
    instanceId: string,
    current: number,
    max: number,
    conditions: string[],
  ): void {
    let lost: string[] = [];
    mutateApp((app) => {
      const target = app.encounters.find((entry) => entry.id === encounterId);
      const live = target?.combat.instances.find((entry) => entry.id === instanceId);
      if (!target || !live) return;
      live.conditions = conditions;
      live.currentStamina = current;
      if (live.kind === "creature") {
        live.maxStamina = max;
        if (current <= 0) {
          lost = releaseCaptain(target.combat.instances, live.id).map((squad) => squad.name);
        }
      }
      target.updatedAt = Date.now();
    });
    if (lost.length) toast(`${lost.join(", ")} lost ${lost.length > 1 ? "their" : "its"} captain`);
  }

  function markInitiativeNeedsSync(): void {
    initiativeSyncVersion += 1;
    initiativeNeedsSync = true;
  }

  function currentInitiative(): InitiativeState {
    const sceneId = activeSceneId();
    const encounter = activeEncounter();
    const linked = new Set(
      sceneId
        ? mappingsFor(owlbearStore.value, encounter.id, sceneId)
            .filter((mapping) => !mapping.missing)
            .map((mapping) => mapping.instanceId)
        : [],
    );
    return {
      ...desiredInitiative(encounter, linked),
      ...(sceneId ? { expectedSceneId: sceneId } : {}),
    };
  }

  async function flushInitiative(): Promise<void> {
    const active = options.getConnection();
    const connState = owlbearConnection.value;
    if (
      !active ||
      !outboundReady ||
      initiativeSendingFor === active ||
      Date.now() < initiativeRetryAfter ||
      owlbearBusy.value ||
      connState.status !== "connected" ||
      connState.settings?.ringsSync === false
    )
      return;
    const scope = `${active.sessionId}:${activeSceneId()}:${activeEncounter().id}`;
    if (scope !== initiativeScope) {
      initiativeScope = scope;
      initiativeBaseline = null;
    }
    const initiative = currentInitiative();
    if (!initiative.combatants.length) return;
    const signature = JSON.stringify(initiative);
    if (signature === initiativeBaseline && !initiativeNeedsSync) return;
    const syncVersion = initiativeSyncVersion;
    initiativeSendingFor = active;
    let invalidPayload = false;
    try {
      await active.client.request("SYNC_INITIATIVE", initiative, 45_000);
      if (options.getConnection() === active && scope === initiativeScope) {
        initiativeBaseline = signature;
        if (initiativeSyncVersion === syncVersion) initiativeNeedsSync = false;
      }
    } catch (error) {
      if (options.getConnection() === active) {
        const message = error instanceof Error ? error.message : "Could not sync initiative.";
        setConnection({ lastError: message });
        log(`Initiative sync failed: ${message}`);
        if (error instanceof ProtocolError && error.code === "INVALID_PAYLOAD") {
          invalidPayload = true;
          // Do not spin retrying the exact same invalid snapshot until state changes.
          if (scope === initiativeScope) {
            initiativeBaseline = signature;
            if (initiativeSyncVersion === syncVersion) initiativeNeedsSync = false;
          }
        } else {
          initiativeRetryAfter = Date.now() + 5_000;
          if (initiativeRetryTimer !== undefined) clearTimeout(initiativeRetryTimer);
          initiativeRetryTimer = setTimeout(() => {
            initiativeRetryTimer = undefined;
            scheduleDiff();
          }, 5_000);
        }
      }
    } finally {
      if (initiativeSendingFor === active) initiativeSendingFor = null;
      if (!invalidPayload && options.getConnection() === active) scheduleDiff();
    }
  }

  function receiveInitiative(initiative: InitiativeState, initial = false): void {
    const active = options.getConnection();
    const encounter = activeEncounter();
    if (initiative.encounterId !== encounter.id || (active && initiativeSendingFor === active))
      return;
    if (!initial && initiativeNeedsSync) return;
    const scope = `${active?.sessionId}:${activeSceneId()}:${encounter.id}`;
    if (
      initiativeScope === scope &&
      initiativeBaseline !== null &&
      JSON.stringify(currentInitiative()) !== initiativeBaseline
    )
      return;
    const sceneId = activeSceneId();
    const mappings = sceneId
      ? new Map(
          mappingsFor(owlbearStore.value, encounter.id, sceneId).map((entry) => [
            entry.instanceId,
            entry,
          ]),
        )
      : new Map<string, TokenMapping>();
    const needsFollowerSync = initiative.combatants.some((entry) => {
      const mapping = mappings.get(entry.instanceId);
      if (!mapping || mapping.tokenIds.length <= 1) return false;
      const previous = encounter.combat.instances.find((item) => item.id === entry.instanceId);
      return (
        !previous ||
        previous.groupId !== entry.groupId ||
        previous.turns !== entry.turns ||
        previous.turnsTaken !== entry.turnsTaken
      );
    });
    mutateApp((app) => {
      const target = app.encounters.find((entry) => entry.id === initiative.encounterId);
      if (target) applyInitiative(target, initiative);
    });
    initiativeScope = scope;
    const current = currentInitiative();
    const observedIds = new Set(initiative.combatants.map((entry) => entry.instanceId));
    const allObserved = current.combatants.every((entry) => observedIds.has(entry.instanceId));
    // Reconcile back to Rings only when a multi-token carrier moved/changed
    // (so followers get the new ring color/category) or when a linked combatant
    // was missing from the observation (e.g. deleted carrier).
    if (needsFollowerSync || !allObserved) markInitiativeNeedsSync();
    else initiativeNeedsSync = false;
    initiativeBaseline = allObserved ? JSON.stringify(current) : null;
  }

  function applyObservedMapping(
    encounter: Encounter,
    instance: CombatInstance,
    mapping: TokenMapping,
    preserveLocalConditions = false,
  ): void {
    const outbound = outboundFor(encounter.id);
    const current = clampStamina(mapping.currentStamina, instance.maxStamina, instance.kind);
    const max =
      instance.kind === "creature"
        ? Math.max(instance.maxStamina, mapping.maxStamina, current)
        : instance.maxStamina;
    const isSquad = instance.kind === "minion-squad";
    let conditions: string[];
    let conditionsDirty = false;
    if (isSquad || mapping.conditions === undefined) {
      conditions = [...instance.conditions];
    } else if (preserveLocalConditions) {
      // Switching condition sync on (or between Marked! and Token Labels) must
      // never wipe conditions already tracked in Malice just because the map
      // has no labels in the newly selected format yet. Union both sides and
      // push any conditions missing on the map outward.
      const existingLower = new Set(instance.conditions.map((value) => value.toLowerCase()));
      const additions = mapping.conditions.filter(
        (value) => !existingLower.has(value.toLowerCase()),
      );
      conditions = [...instance.conditions, ...additions];
      conditionsDirty = !sameConditions(
        mergeLabelConditions(instance.conditions, mapping.conditions),
        conditions,
      );
    } else {
      conditions = mergeLabelConditions(instance.conditions, mapping.conditions);
    }
    const statblock = stampStatblock(instance);
    const individualStamina = stampIndividualStamina(instance);
    // If clamping (e.g. after a captain died earlier in this reconnect pass)
    // produced a different stamina/per-minion value than Owlbear reported,
    // mark dirty so Malice pushes the reduced values back to Owlbear.
    const clampedDiffers =
      current !== Math.max(0, Math.round(mapping.currentStamina)) ||
      (isSquad &&
        individualStamina !== null &&
        mapping.individualStamina !== null &&
        individualStamina !== mapping.individualStamina);
    const dirty = conditionsDirty || clampedDiffers;
    if (dirty) revisionCounter += 1;
    outbound.set(instance.id, {
      ...(isSquad ? {} : { conditions }),
      stamina: current,
      maxStamina: max,
      individualStamina,
      name: instance.name,
      groupId: instance.groupId,
      statblock,
      revision: revisionCounter,
      dirty,
    });
    if (
      instance.currentStamina === current &&
      instance.maxStamina === max &&
      sameConditions(instance.conditions, conditions)
    )
      return;
    applyStaminaAndConditionsToApp(encounter.id, instance.id, current, max, conditions);
  }

  /**
   * Apply values observed in Owlbear to the live roster. With `onlyClean`, a
   * combatant with an unsent local edit keeps that edit; the outbound queue will
   * push it instead.
   */
  function applyObservedForCurrentEncounter(
    mappings: readonly TokenMapping[],
    onlyClean: boolean,
    syncOptions: { preserveLocalConditions?: boolean } = {},
  ): void {
    const encounter = activeEncounter();
    const states = state.peek().encounters;
    const target = states.find((entry) => entry.id === encounter.id);
    if (!target) return;
    const outbound = outboundFor(target.id);
    // Re-enable any updates previously deferred after a partial apply now that
    // the scene snapshot has refreshed.
    for (const stamp of outbound.values()) {
      if (stamp.deferredRetry) stamp.deferredRetry = false;
    }
    const live = new Map(target.combat.instances.map((instance) => [instance.id, instance]));
    for (const mapping of mappings) {
      if (mapping.encounterId !== target.id || mapping.sceneId !== activeSceneId()) continue;
      const instance = live.get(mapping.instanceId);
      if (!instance) continue;
      const stamp = outbound.get(instance.id);
      const pending =
        stamp?.dirty ||
        hasPendingLocalChange(instance, stamp, {
          individualStamina: stampIndividualStamina(instance),
          statblockResourceId: stampStatblock(instance)?.resourceId ?? null,
        });
      if (onlyClean && pending) continue;
      applyObservedMapping(target, instance, mapping, syncOptions.preserveLocalConditions === true);
    }
  }

  function applyImportResult(result: ImportResult, plan: ImportPlan): void {
    initiativeBaseline = null;
    markInitiativeNeedsSync();
    const encounter = activeEncounter();
    const roomId = result.scene.roomId;
    commitStore(
      replaceSceneMappings(
        owlbearStore.value,
        roomId,
        result.scene.sceneId,
        result.mappings,
        encounter.id,
      ),
    );
    const outbound = outboundFor(encounter.id);
    for (const stamp of outbound.values()) {
      if (stamp.deferredRetry) stamp.deferredRetry = false;
    }
    const desired = new Map(plan.combatants.map((entry) => [entry.instanceId, entry]));
    const created = new Set(result.createdInstanceIds);
    const live = new Map(encounter.combat.instances.map((entry) => [entry.id, entry]));
    for (const mapping of result.mappings) {
      const instance = live.get(mapping.instanceId);
      if (!instance) continue;
      if (created.has(mapping.instanceId)) {
        const combatant = desired.get(mapping.instanceId);
        outbound.set(mapping.instanceId, {
          ...(instance.kind !== "minion-squad"
            ? { conditions: [...(combatant?.conditions ?? instance.conditions)] }
            : {}),
          stamina: combatant?.currentStamina ?? instance.currentStamina,
          maxStamina: combatant?.maxStamina ?? instance.maxStamina,
          individualStamina: combatant?.individualStamina ?? stampIndividualStamina(instance),
          name: combatant?.name ?? instance.name,
          groupId: combatant?.activationGroupId ?? instance.groupId,
          statblock: combatant?.statblock ?? null,
          revision: revisionCounter,
          dirty: false,
        });
        continue;
      }
      const stamp = outbound.get(mapping.instanceId);
      if (
        stamp?.dirty ||
        hasPendingLocalChange(instance, stamp, {
          individualStamina: stampIndividualStamina(instance),
          statblockResourceId: stampStatblock(instance)?.resourceId ?? null,
        })
      )
        continue;
      applyObservedMapping(encounter, instance, mapping);
    }
    outboundReady = true;
    setConnection({
      scene: result.scene,
      progress: null,
      lastError: null,
    });
    syncLinkedInstancesCount();
    scheduleDiff();
  }

  function syncObservedVisibility(
    encounterId: string,
    sceneId: string,
    instanceId: string,
    visible: boolean,
  ): void {
    const store = owlbearStore.peek();
    const encounter = store.encounters[encounterId];
    const scene = encounter?.scenes[sceneId];
    const mapping = scene?.mappings.find((entry) => entry.instanceId === instanceId);
    if (!mapping || mapping.visible === visible) return;
    commitStore(
      replaceSceneMappings(
        store,
        scene!.roomId,
        sceneId,
        scene!.mappings.map((entry) =>
          entry.instanceId === instanceId ? { ...entry, visible, updatedAt: Date.now() } : entry,
        ),
        encounterId,
      ),
    );
  }

  function applyExternalUpdate(data: {
    encounterId: string;
    update: CombatantUpdate;
    sceneId: string;
    tokenIds: string[];
    observedAt: number;
  }): void {
    if (data.sceneId !== activeSceneId()) return;
    if (data.update.visible !== undefined) {
      syncObservedVisibility(
        data.encounterId,
        data.sceneId,
        data.update.instanceId,
        data.update.visible,
      );
    }
    const target = state.peek().encounters.find((entry) => entry.id === data.encounterId);
    if (!target) return;
    const instance = target.combat.instances.find((entry) => entry.id === data.update.instanceId);
    if (!instance) return;
    const outbound = outboundFor(target.id);
    const stamp = outbound.get(instance.id);
    const currentStatblock = stampStatblock(instance);
    if (
      stamp?.dirty ||
      hasPendingLocalChange(instance, stamp, {
        individualStamina: stampIndividualStamina(instance),
        statblockResourceId: currentStatblock?.resourceId ?? null,
      })
    ) {
      log(`${instance.name}: Owlbear change ignored while a local edit is pending.`);
      return;
    }
    const decision = decideExternalUpdate({
      kind: instance.kind,
      currentStamina: instance.currentStamina,
      maxStamina: instance.maxStamina,
      updateCurrentStamina: data.update.currentStamina,
      updateMaxStamina: data.update.maxStamina,
      dirty: false,
    });
    const isSquad = instance.kind === "minion-squad";
    const current = decision.currentStamina;
    const max = decision.maxStamina;
    const conditions =
      isSquad || data.update.conditions === undefined
        ? [...instance.conditions]
        : mergeLabelConditions(instance.conditions, data.update.conditions);
    if (!decision.apply && sameConditions(instance.conditions, conditions)) {
      if (stamp) stamp.dirty = false;
      return;
    }
    const fanOutSiblings = !isSquad && data.tokenIds.length > 1;
    if (fanOutSiblings) revisionCounter += 1;
    outbound.set(instance.id, {
      ...(isSquad ? {} : { conditions }),
      stamina: current,
      maxStamina: max,
      individualStamina: stampIndividualStamina(instance),
      name: instance.name,
      groupId: instance.groupId,
      statblock: stamp?.statblock ?? currentStatblock,
      revision: revisionCounter,
      dirty: fanOutSiblings,
    });
    if (fanOutSiblings) scheduleFlush();
    const previous = instance.currentStamina;
    applyStaminaAndConditionsToApp(
      data.encounterId,
      data.update.instanceId,
      current,
      max,
      conditions,
    );
    log(
      `${instance.name}: Owlbear ${previous} → ${current} Stamina; conditions: ${conditions.join(", ") || "none"}.`,
    );
  }

  function markTokenDeleted(data: {
    encounterId: string;
    instanceId: string;
    sceneId?: string;
    tokenIds: string[];
    allMissing: boolean;
  }): void {
    const sceneId = activeSceneId();
    if (!sceneId) return;
    if (data.sceneId && data.sceneId !== sceneId) return;
    const encounter = owlbearStore.value.encounters[data.encounterId];
    if (!encounter) return;
    const scene = encounter.scenes[sceneId];
    if (!scene) return;
    const existing = scene.mappings.find((entry) => entry.instanceId === data.instanceId);
    if (!existing) return;
    const removed = new Set(data.tokenIds);
    // Ignore stale allMissing events whose deleted tokenIds don't overlap the
    // active scene's mapping (e.g. a late event from a previous scene).
    if (
      data.tokenIds.length > 0 &&
      existing.tokenIds.length > 0 &&
      !existing.tokenIds.some((id) => removed.has(id))
    )
      return;
    const nextTokenIds = existing.tokenIds.filter((id) => !removed.has(id));
    const missing = data.allMissing || nextTokenIds.length === 0;
    const updatedMapping: TokenMapping = {
      ...existing,
      tokenIds: nextTokenIds,
      missing,
      updatedAt: Date.now(),
    };
    const nextMappings = scene.mappings.map((entry) =>
      entry.instanceId === data.instanceId ? updatedMapping : entry,
    );
    commitStore(
      replaceSceneMappings(
        owlbearStore.value,
        scene.roomId,
        sceneId,
        nextMappings,
        data.encounterId,
      ),
    );
    if (missing) {
      outboundFor(data.encounterId).delete(data.instanceId);
    }
    if (data.encounterId === activeEncounter().id) {
      syncLinkedInstancesCount();
    }
    const instance = state
      .peek()
      .encounters.find((entry) => entry.id === data.encounterId)
      ?.combat.instances.find((entry) => entry.id === data.instanceId);
    if (!missing && data.encounterId === activeEncounter().id) {
      // Deleting the first token of a minion squad removes its Rings carrier;
      // reconcile initiative so a surviving minion takes over the turn budget.
      markInitiativeNeedsSync();
      scheduleDiff();
    }
    if (
      missing &&
      data.encounterId === activeEncounter().id &&
      (!instance || instance.currentStamina > 0)
    )
      toast(`${instance?.name ?? "A combatant"} lost its Owlbear token. Send again to recover.`);
    log(
      `${instance?.name ?? data.instanceId}: ${data.tokenIds.length} token${
        data.tokenIds.length === 1 ? "" : "s"
      } deleted in Owlbear.`,
    );
  }

  function scheduleDiff(): void {
    if (diffTimer !== undefined) clearTimeout(diffTimer);
    diffTimer = setTimeout(() => {
      diffTimer = undefined;
      diffCurrentEncounter();
    }, 120);
  }

  function diffCurrentEncounter(): void {
    if (!outboundReady) return;
    void flushInitiative();
    const sceneId = activeSceneId();
    if (!sceneId) return;
    const encounter = activeEncounter();
    const mappings = new Map(
      mappingsFor(owlbearStore.value, encounter.id, sceneId)
        .filter((entry) => !entry.missing)
        .map((entry) => [entry.instanceId, entry]),
    );
    const outbound = outboundFor(encounter.id);
    const liveIds = new Set(encounter.combat.instances.map((entry) => entry.id));
    for (const id of outbound.keys()) {
      if (!liveIds.has(id)) outbound.delete(id);
    }
    let dirty = false;
    for (const instance of encounter.combat.instances) {
      const mapping = mappings.get(instance.id);
      if (!mapping) continue;
      const isSquad = instance.kind === "minion-squad";
      const statblock = stampStatblock(instance);
      const individualStamina = stampIndividualStamina(instance);
      const next: OutboundStamp = {
        ...(isSquad ? {} : { conditions: [...instance.conditions] }),
        stamina: instance.currentStamina,
        maxStamina: instance.maxStamina,
        individualStamina,
        name: instance.name,
        groupId: instance.groupId,
        statblock,
        revision: revisionCounter,
        dirty: false,
      };
      const previous = outbound.get(instance.id);
      if (previous?.dirty && !previous.deferredRetry) dirty = true;
      if (!previous) {
        outbound.set(instance.id, next);
        continue;
      }
      const conditionsChanged =
        !isSquad && !sameConditions(previous.conditions ?? [], next.conditions ?? []);
      if (
        conditionsChanged ||
        previous.stamina !== next.stamina ||
        previous.maxStamina !== next.maxStamina ||
        (previous.individualStamina ?? null) !== (next.individualStamina ?? null) ||
        previous.name !== next.name ||
        previous.statblock?.resourceId !== next.statblock?.resourceId
      ) {
        revisionCounter += 1;
        outbound.set(instance.id, {
          ...next,
          revision: revisionCounter,
          dirty: true,
          deferredRetry: false,
        });
        dirty = true;
      } else if (previous.groupId !== next.groupId) {
        // Group moves are synced via SYNC_INITIATIVE, not UPDATE_COMBATANTS.
        previous.groupId = next.groupId;
      }
    }
    if (dirty) scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushUpdates();
    }, 220);
  }

  async function flushUpdates(): Promise<void> {
    const active = options.getConnection();
    if (
      !active ||
      !outboundReady ||
      updatesSendingFor === active ||
      owlbearConnection.value.status !== "connected"
    )
      return;
    const sceneId = activeSceneId();
    if (!sceneId) return;
    const encounter = activeEncounter();
    const mappings = new Map(
      mappingsFor(owlbearStore.value, encounter.id, sceneId)
        .filter((entry) => !entry.missing)
        .map((entry) => [entry.instanceId, entry]),
    );
    const instances = new Map(encounter.combat.instances.map((entry) => [entry.id, entry]));
    const outbound = outboundFor(encounter.id);
    const updates: { update: CombatantUpdate; revision: number }[] = [];
    for (const [instanceId, stamp] of outbound) {
      if (!stamp.dirty || stamp.deferredRetry || !mappings.has(instanceId)) continue;
      const instance = instances.get(instanceId);
      if (!instance) continue;
      const statblock = stamp.statblock;
      const groupName =
        encounter.groups.find((group) => group.id === stamp.groupId)?.name ?? "Ungrouped";
      updates.push({
        update: {
          instanceId,
          ...(stamp.conditions !== undefined
            ? { conditions: boundedProtocolConditions(stamp.conditions) }
            : {}),
          currentStamina: clampProtocolStamina(stamp.stamina),
          maxStamina: clampProtocolStamina(stamp.maxStamina),
          name: boundedProtocolText(stamp.name, LIMITS.nameLength, "Combatant"),
          activationGroupId: stamp.groupId,
          activationGroupName: boundedProtocolText(groupName, LIMITS.groupNameLength, "Ungrouped"),
          statblock: statblock ?? null,
          individualStamina:
            instance.kind === "minion-squad"
              ? Math.max(
                  1,
                  clampProtocolStamina(
                    stamp.individualStamina ?? stampIndividualStamina(instance) ?? 1,
                  ),
                )
              : null,
          revision: stamp.revision,
        },
        revision: stamp.revision,
      });
    }
    if (!updates.length) return;
    const sentRevisions = new Map(
      updates.map((entry) => [entry.update.instanceId, entry.revision]),
    );
    updatesSendingFor = active;
    let failed = false;
    try {
      let appliedCount = 0;
      for (let offset = 0; offset < updates.length; offset += MAX_COMBATANT_UPDATES) {
        if (
          options.getConnection() !== active ||
          !outboundReady ||
          activeSceneId() !== sceneId ||
          activeEncounter().id !== encounter.id
        )
          return;
        const batch = updates.slice(offset, offset + MAX_COMBATANT_UPDATES);
        const result = await active.client.request<UpdatesResponse>(
          "UPDATE_COMBATANTS",
          {
            encounterId: encounter.id,
            expectedSceneId: sceneId,
            combatants: batch.map((entry) => entry.update),
          },
          45_000,
        );
        if (options.getConnection() !== active) return;
        const applied = new Set(result.appliedInstanceIds);
        for (const entry of batch) {
          const stamp = outbound.get(entry.update.instanceId);
          if (applied.has(entry.update.instanceId)) {
            appliedCount += 1;
            if (stamp && stamp.revision === entry.revision) {
              stamp.dirty = false;
              stamp.deferredRetry = false;
            }
          } else if (stamp && stamp.revision === entry.revision) {
            // Keep dirty so inbound updates don't overwrite the local edit and
            // a scene refresh will retry it, but don't spam PARTIAL_UPDATE on
            // unrelated edits in the meantime.
            stamp.deferredRetry = true;
          }
        }
      }
      if (appliedCount)
        log(`Synced ${appliedCount} combatant update${appliedCount === 1 ? "" : "s"} to Owlbear.`);
    } catch (error) {
      failed = true;
      if (options.getConnection() !== active) return;
      const message = error instanceof Error ? error.message : "Could not sync stamina.";
      setConnection({ lastError: message });
      log(`Stamina sync failed: ${message}`);
      if (
        !(error instanceof ProtocolError && error.code === "INVALID_PAYLOAD") &&
        options.getConnection() &&
        !retryTimer
      ) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void flushUpdates();
        }, 3_000);
      }
    } finally {
      if (updatesSendingFor === active) updatesSendingFor = null;
      if (!failed && options.getConnection() === active && outboundReady) {
        // Re-flush if a newer local edit landed while this batch was in flight.
        const hasNewerDirty = [...outbound.entries()].some(
          ([id, stamp]) =>
            stamp.dirty && !stamp.deferredRetry && stamp.revision !== sentRevisions.get(id),
        );
        if (hasNewerDirty) scheduleFlush();
      }
    }
  }

  function installSyncDriver(): void {
    let encounterId = activeEncounter().id;
    let knownEncounters = new Set(state.peek().encounters.map((entry) => entry.id));
    let lastEncounterDataSig = "";
    let lastStoreSig = "";
    let lastConnStatus = "";
    let initializedPrune = false;

    effect(() => {
      const appState = state.value;
      const storeVal = owlbearStore.value;
      const connStatus = owlbearConnection.value.status;
      const liveIds = new Set(appState.encounters.map((entry) => entry.id));
      let nextStore = owlbearStore.peek();
      let pruned = false;
      // On first run, also prune any stale encounter keys left in localStorage
      // from another tab or cleared app saves.
      const toCheck = initializedPrune
        ? knownEncounters
        : new Set([...knownEncounters, ...Object.keys(nextStore.encounters)]);
      initializedPrune = true;
      for (const oldId of toCheck) {
        if (!liveIds.has(oldId)) {
          evictScopesForEncounter(oldId);
          if (nextStore.encounters[oldId]) {
            nextStore = clearEncounterMappings(nextStore, oldId);
            pruned = true;
          }
        }
      }
      knownEncounters = liveIds;
      if (pruned) commitStore(nextStore);

      const currentEnc = activeEncounter();
      const selectedId = currentEnc.id;
      if (selectedId !== encounterId) {
        encounterId = selectedId;
        outboundReady = false;
        clearUnresolvedStatblocks();
        notifyOwlbearSelection(null);
        options.onEncounterSwitched();
      }

      // Clear stale selection / unresolved state if instances disappeared (reset/remove).
      const liveInstanceIds = new Set(currentEnc.combat.instances.map((entry) => entry.id));
      const selectedInst = owlbearSelectedInstanceId.peek();
      if (selectedInst && !liveInstanceIds.has(selectedInst)) {
        notifyOwlbearSelection(null);
      }
      if (!currentEnc.combat.instances.length) {
        clearUnresolvedStatblocks();
      }
      syncLinkedInstancesCount();

      // Ignore pure state.ui mutations (search typing, sidebar/filter toggles)
      // and lastSelectedInstanceId-only store bumps so we don't rescan on keystrokes.
      const encounterDataSig = [
        currentEnc.id,
        currentEnc.combat.round,
        currentEnc.groups.map((g) => `${g.id}:${g.name}`).join(","),
        currentEnc.combat.instances
          .map(
            (i) =>
              `${i.id}:${i.currentStamina}/${i.maxStamina}:${i.name}:${i.groupId}:${i.turns}:${i.turnsTaken}:${i.count}:${i.captainId ?? ""}:${i.conditions.join(",")}`,
          )
          .join("|"),
      ].join("#");
      const storeSig = `${Object.keys(storeVal.encounters).length}|${storeVal.encounters[selectedId]?.updatedAt ?? 0}|${JSON.stringify(storeVal.manualStatblocks)}|${JSON.stringify(storeVal.learnedStatblocks)}`;
      if (
        encounterDataSig !== lastEncounterDataSig ||
        storeSig !== lastStoreSig ||
        connStatus !== lastConnStatus ||
        pruned
      ) {
        lastEncounterDataSig = encounterDataSig;
        lastStoreSig = storeSig;
        lastConnStatus = connStatus;
        scheduleDiff();
      }
    });
  }

  return {
    setOutboundReady(ready: boolean): void {
      outboundReady = ready;
      if (!ready) clearAllTimers();
    },
    resetInitiativeBaseline(): void {
      initiativeBaseline = null;
    },
    clearAllTimers,
    scheduleDiff,
    installSyncDriver,
    receiveInitiative,
    applyObservedForCurrentEncounter,
    applyImportResult,
    applyExternalUpdate,
    markTokenDeleted,
  };
}
