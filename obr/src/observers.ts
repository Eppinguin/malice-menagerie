import { readLabelConditions } from "./conditionLabels.ts";
import { conditionFromLabel, sameConditions } from "../../shared/obr/conditionLabels.ts";
import { readRingsInitiative } from "./rings.ts";
import { conditionSyncMode } from "./settings.ts";
import OBR, { type Item, type Metadata, type Player } from "@owlbear-rodeo/sdk";
import { withRateLimitRetry } from "./requests.ts";
import {
  LIMITS,
  SCENE_METADATA_KEY,
  TOKEN_METADATA_KEY,
  type CombatantUpdate,
  type SceneSummary,
  type StatblockRef,
} from "../../shared/obr/protocol.ts";
import {
  boundedName,
  buildMappings,
  clampStamina,
  forgetSceneIdentity,
  getSceneIdentity,
  readIntegrationToken,
  sceneSummary,
  tokenStamina,
} from "./scene.ts";
import { readMinionGroups, readSeamusMonster, type SeamusMinionGroup } from "./seamus.ts";

export type ObserverEmit = (type: string, payload: unknown) => void;

interface TokenValues {
  currentStamina: number;
  maxStamina: number;
  name: string;
}

interface ObservedState {
  conditions?: string[];
  currentStamina: number;
  maxStamina: number;
  name: string;
  tokenIds: string[];
  kind: "creature" | "minion-squad";
  statblock: StatblockRef | null;
  visible: boolean;
  /** Per-token snapshots for multi-token creatures so edits on any duplicate
   * token are detected without ping-ponging against unchanged sibling tokens. */
  tokenSnapshots?: Map<string, TokenValues>;
}

const DEBOUNCE_MS = 120;

/**
 * Watches OBR items, scene metadata, and selection, and reports *changes*
 * back to Malice.
 *
 * Echo suppression is intentional: every write performed by this extension is
 * recorded as the new baseline, so the change event OBR emits for our own
 * write is not mistaken for an external edit.
 */
export class SceneObserver {
  private readonly emit: ObserverEmit;
  private readonly onSceneChanged: (scene: SceneSummary) => void;
  private readonly onSceneLost: (reason: string) => void;
  private readonly ringsEnabled: () => boolean;
  private readonly conditionsEnabled: () => boolean;
  private items: Item[] = [];
  private groups: SeamusMinionGroup[] = [];
  private metadata: Metadata = {};
  private initiativeBaseline = "";
  private baseline = new Map<string, ObservedState>();
  private encounterId: string | null = null;
  private sceneId: string | null = null;
  private selectionKey = "";
  private selectionGeneration = 0;
  private sceneGeneration = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposers: (() => void)[] = [];
  private started = false;
  private sceneReady = false;
  private pendingSceneNotify = true;
  private writeDepth = 0;

  get isWriting(): boolean {
    return this.writeDepth > 0;
  }

  constructor(options: {
    emit: ObserverEmit;
    onSceneChanged: (scene: SceneSummary) => void;
    onSceneLost: (reason: string) => void;
    ringsEnabled?: () => boolean;
    conditionsEnabled?: () => boolean;
  }) {
    this.emit = options.emit;
    this.onSceneChanged = options.onSceneChanged;
    this.onSceneLost = options.onSceneLost;
    this.ringsEnabled = options.ringsEnabled ?? (() => true);
    this.conditionsEnabled = options.conditionsEnabled ?? (() => conditionSyncMode() !== "off");
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.disposers.push(
      OBR.scene.items.onChange((items) => {
        this.items = items;
        this.schedule();
      }),
      OBR.scene.onMetadataChange((metadata) => {
        this.metadata = metadata;
        this.groups = readMinionGroups(metadata);
        this.checkScene(metadata);
        this.schedule();
      }),
      OBR.player.onChange((player) => {
        void this.checkSelection(player);
      }),
      OBR.scene.onReadyChange((ready) => {
        if (ready) {
          void this.resumeScene();
        } else {
          this.sceneGeneration += 1;
          this.sceneReady = false;
          this.pendingSceneNotify = true;
          forgetSceneIdentity();
          this.sceneId = null;
          this.selectionKey = "";
          this.items = [];
          this.groups = [];
          this.metadata = {};
          this.initiativeBaseline = "";
          this.baseline.clear();
          if (this.timer !== undefined) clearTimeout(this.timer);
          this.timer = undefined;
          this.onSceneLost("The Owlbear scene is loading.");
        }
      }),
    );
    // OBR.onReady is the SDK handshake, not scene readiness. In a reloading
    // room these reads used to reject twice before the scene was available.
    void OBR.scene
      .isReady()
      .then((ready) => {
        if (ready && this.started) return this.resumeScene();
      })
      .catch(() => {
        // onReadyChange retries once Owlbear finishes loading the scene.
      });
  }

  stop(): void {
    this.started = false;
    this.sceneGeneration += 1;
    this.selectionGeneration += 1;
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  setEncounter(encounterId: string | null): void {
    if (this.encounterId === encounterId) return;
    this.encounterId = encounterId;
    this.selectionKey = "";
    if (!encounterId) {
      this.baseline.clear();
      this.initiativeBaseline = "";
      return;
    }
    if (!this.writeDepth && this.started)
      void this.rebaseline().then(() => this.syncCurrentSelection());
  }

  /** Don't publish a half-imported squad while tokens and group metadata
   * are being written. Record only the values written before releasing this guard;
   * pending observations must retain unrelated external changes. */
  suspendWrites(): () => void {
    this.writeDepth += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return () => {
      this.writeDepth = Math.max(0, this.writeDepth - 1);
      this.schedule();
    };
  }

  /** Set the baseline to the map's current values without emitting events. */
  async rebaseline(): Promise<void> {
    await this.refreshBaseline(true);
  }

  /** Suppress initiative echoes without consuming pending combatant observations. */
  async rebaselineInitiative(): Promise<void> {
    await this.refreshBaseline(false);
  }

  /** Refresh the cached scene snapshot without resetting combatant baselines,
   * so markWritten() diffs against committed post-write data while retaining
   * unrelated external edits made while our write was in flight. */
  async refreshCache(): Promise<void> {
    const generation = this.sceneGeneration;
    try {
      if (!(await OBR.scene.isReady())) return;
      const [items, metadata] = await withRateLimitRetry(() =>
        Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata()]),
      );
      if (!this.started || generation !== this.sceneGeneration) return;
      this.items = items;
      this.groups = readMinionGroups(metadata);
      this.metadata = metadata;
    } catch {
      // Scene not ready yet; the ready callback will handle recovery.
    }
  }

  private async refreshBaseline(includeCombatants: boolean): Promise<void> {
    const generation = this.sceneGeneration;
    if (!this.encounterId) {
      this.baseline.clear();
      this.initiativeBaseline = "";
      return;
    }
    try {
      if (!(await OBR.scene.isReady())) return;
      const [items, metadata] = await withRateLimitRetry(() =>
        Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata()]),
      );
      if (!this.started || generation !== this.sceneGeneration || !this.encounterId) return;
      this.items = items;
      this.groups = readMinionGroups(metadata);
      this.metadata = metadata;
      this.initiativeBaseline = this.ringsEnabled()
        ? JSON.stringify(readRingsInitiative(items, metadata, this.encounterId))
        : "";
      if (includeCombatants) this.baseline = this.observed(items, this.groups);
      const identity = await getSceneIdentity();
      if (!this.started || generation !== this.sceneGeneration) return;
      this.sceneId = identity.sceneId;
      this.sceneReady = true;
    } catch {
      // Scene not ready yet; the ready callback will retry.
    }
  }

  private async resumeScene(): Promise<void> {
    if (!this.started) return;
    const generation = this.sceneGeneration;
    forgetSceneIdentity();
    await this.refreshBaseline(true);
    if (!this.started || generation !== this.sceneGeneration) return;
    if (this.pendingSceneNotify) {
      this.pendingSceneNotify = false;
      try {
        const summary = await sceneSummary();
        if (!this.started || generation !== this.sceneGeneration) return;
        this.sceneId = summary.sceneId;
        this.sceneReady = true;
        this.onSceneChanged(summary);
      } catch {
        if (!this.started || generation !== this.sceneGeneration) return;
        this.pendingSceneNotify = true;
        this.onSceneLost("The new scene could not be read.");
      }
    }
  }

  /** Record a value this extension just wrote, so it is not echoed back. */
  markWritten(state: {
    instanceId: string;
    kind: "creature" | "minion-squad";
    currentStamina: number;
    maxStamina: number;
    name: string;
    tokenIds: string[];
    statblock?: StatblockRef | null;
    conditions?: string[];
    visible?: boolean;
  }): void {
    const previous = this.baseline.get(state.instanceId);
    const normalizedConditions =
      state.conditions !== undefined
        ? [
            ...new Set(
              state.conditions
                .map(conditionFromLabel)
                .filter((name): name is string => name !== null),
            ),
          ].sort()
        : undefined;
    const conditions =
      state.kind !== "minion-squad" && this.conditionsEnabled()
        ? (normalizedConditions ?? previous?.conditions ?? [])
        : undefined;
    this.baseline.set(state.instanceId, {
      ...(conditions !== undefined ? { conditions } : {}),
      currentStamina: clampStamina(state.currentStamina),
      maxStamina: clampStamina(state.maxStamina),
      name: boundedName(state.name),
      tokenIds: state.tokenIds.slice(0, LIMITS.tokenIdsPerInstance),
      kind: state.kind,
      statblock: state.statblock !== undefined ? state.statblock : (previous?.statblock ?? null),
      visible: state.visible ?? previous?.visible ?? true,
    });
  }

  private schedule(): void {
    if (!this.started || this.writeDepth || !this.sceneReady) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.evaluate();
    }, DEBOUNCE_MS);
  }

  private evaluate(): void {
    if (!this.started || this.writeDepth || !this.sceneReady || !this.encounterId || !this.sceneId)
      return;
    if (this.ringsEnabled()) {
      const initiative = readRingsInitiative(this.items, this.metadata, this.encounterId);
      const signature = JSON.stringify(initiative);
      if (initiative && signature !== this.initiativeBaseline) {
        this.emit("INITIATIVE_UPDATED", { sceneId: this.sceneId, initiative });
      }
      this.initiativeBaseline = signature;
    }
    const next = this.observed(this.items, this.groups);
    for (const [instanceId, state] of next) {
      const previous = this.baseline.get(instanceId);
      if (!previous) continue;
      const removed = previous.tokenIds
        .filter((id) => !state.tokenIds.includes(id))
        .slice(0, LIMITS.tokenIdsPerInstance);
      if (removed.length) {
        this.emit("TOKEN_DELETED", {
          encounterId: this.encounterId,
          instanceId,
          sceneId: this.sceneId,
          tokenIds: removed,
          allMissing: state.tokenIds.length === 0,
        });
      }
      const conditionsChanged =
        state.conditions !== undefined &&
        !sameConditions(previous.conditions ?? [], state.conditions);
      const maxStaminaChanged =
        state.kind === "creature" && previous.maxStamina !== state.maxStamina;
      if (
        previous.currentStamina !== state.currentStamina ||
        maxStaminaChanged ||
        previous.name !== state.name ||
        previous.visible !== state.visible ||
        conditionsChanged
      ) {
        const update: CombatantUpdate = {
          instanceId,
          ...(state.conditions !== undefined ? { conditions: state.conditions } : {}),
          currentStamina: clampStamina(state.currentStamina),
          maxStamina: clampStamina(state.maxStamina),
          name: boundedName(state.name),
          activationGroupId: "owlbear",
          activationGroupName: "Owlbear",
          statblock: state.statblock,
          visible: state.visible,
          revision: 0,
        };
        this.emit("COMBATANT_UPDATED", {
          encounterId: this.encounterId,
          update,
          sceneId: this.sceneId,
          tokenIds: state.tokenIds.slice(0, LIMITS.tokenIdsPerInstance),
          observedAt: Date.now(),
        });
      }
    }
    for (const [instanceId, previous] of this.baseline) {
      if (next.has(instanceId)) continue;
      if (previous.tokenIds.length)
        this.emit("TOKEN_DELETED", {
          encounterId: this.encounterId,
          instanceId,
          sceneId: this.sceneId,
          tokenIds: previous.tokenIds.slice(0, LIMITS.tokenIdsPerInstance),
          allMissing: true,
        });
    }
    this.baseline = next;
  }

  private observed(
    items: readonly Item[],
    groups: readonly SeamusMinionGroup[],
  ): Map<string, ObservedState> {
    const result = new Map<string, ObservedState>();
    if (!this.encounterId) return result;
    const byInstance = new Map<string, Item[]>();
    for (const item of items) {
      const data = readIntegrationToken(item);
      if (!data || data.encounterId !== this.encounterId) continue;
      const list = byInstance.get(data.instanceId) ?? [];
      list.push(item);
      byInstance.set(data.instanceId, list);
    }
    const readConditions = this.conditionsEnabled();
    for (const [instanceId, tokens] of byInstance) {
      const first = tokens[0] as Item;
      const data = readIntegrationToken(first);
      if (!data) continue;
      const isSquad = data.kind === "minion-squad";
      // For multi-token creatures, compare each token against its own previous
      // snapshot so an edit on any duplicate token wins without ping-ponging
      // against an unchanged sibling on subsequent map events.
      const prior = !isSquad && tokens.length > 1 ? this.baseline.get(instanceId) : undefined;
      let tokenSnapshots: Map<string, TokenValues> | undefined;
      let source = first;
      if (!isSquad && tokens.length > 1) {
        tokenSnapshots = new Map();
        let changedToken: Item | undefined;
        for (const token of tokens) {
          const s = tokenStamina(token, groups);
          const m = readSeamusMonster(token);
          const current = Math.max(0, s.current);
          const max = Math.max(0, s.max);
          const tokenName = m?.name || data.name;
          tokenSnapshots.set(token.id, {
            currentStamina: current,
            maxStamina: max,
            name: tokenName,
          });
          if (!changedToken && prior) {
            const prev = prior.tokenSnapshots?.get(token.id) ?? {
              currentStamina: prior.currentStamina,
              maxStamina: prior.maxStamina,
              name: prior.name,
            };
            if (
              current !== prev.currentStamina ||
              max !== prev.maxStamina ||
              tokenName !== prev.name
            ) {
              changedToken = token;
            }
          }
        }
        if (changedToken) {
          source = changedToken;
        } else if (prior) {
          // None of the duplicate tokens changed since the last observation:
          // preserve the previously agreed values rather than flipping back to tokens[0].
          result.set(instanceId, {
            ...(readConditions
              ? {
                  conditions: readLabelConditions(
                    items,
                    tokens.map((token) => token.id),
                  ),
                }
              : {}),
            currentStamina: prior.currentStamina,
            maxStamina: prior.maxStamina,
            name: prior.name,
            tokenIds: tokens.map((token) => token.id),
            kind: data.kind,
            statblock: prior.statblock,
            visible: tokens.some((token) => token.visible),
            tokenSnapshots,
          });
          continue;
        }
      }
      const stamina = tokenStamina(source, groups);
      const monster = readSeamusMonster(source);
      const tokenIds = tokens.slice(0, LIMITS.tokenIdsPerInstance).map((token) => token.id);
      const rawName = isSquad ? stamina.name || data.name : monster?.name || data.name;
      const resourceId = monster?.resourceId?.trim().slice(0, 120) ?? "";
      const statblockName = boundedName(
        monster?.statblockName || monster?.name || data.name,
        "Combatant",
      );
      result.set(instanceId, {
        ...(readConditions && !isSquad
          ? {
              conditions: readLabelConditions(items, tokenIds),
            }
          : {}),
        currentStamina: clampStamina(stamina.current),
        maxStamina: isSquad
          ? clampStamina((stamina.individual ?? 1) * Math.max(1, tokens.length))
          : clampStamina(stamina.max),
        name: boundedName(rawName),
        tokenIds,
        kind: data.kind,
        statblock: resourceId ? { resourceId, name: statblockName } : null,
        visible: tokens.some((token) => token.visible),
        ...(tokenSnapshots ? { tokenSnapshots } : {}),
      });
    }
    return result;
  }

  private checkScene(metadata: Metadata): void {
    if (!this.started || !this.sceneReady) return;
    const value = metadata[SCENE_METADATA_KEY];
    const sceneId =
      typeof value === "object" &&
      value !== null &&
      typeof (value as Record<string, unknown>)["sceneId"] === "string"
        ? ((value as Record<string, unknown>)["sceneId"] as string)
        : null;
    if (!sceneId) return;
    if (this.sceneId === null) {
      this.sceneId = sceneId;
      return;
    }
    if (sceneId !== this.sceneId) {
      const generation = ++this.sceneGeneration;
      forgetSceneIdentity();
      this.sceneId = sceneId;
      this.initiativeBaseline = "";
      this.baseline.clear();
      void sceneSummary()
        .then((scene) => {
          if (!this.started || generation !== this.sceneGeneration) return;
          this.onSceneChanged(scene);
        })
        .catch(() => {
          if (!this.started || generation !== this.sceneGeneration) return;
          this.onSceneLost("The new scene could not be read.");
        });
    }
  }

  private async syncCurrentSelection(): Promise<void> {
    if (!this.started || !this.encounterId || typeof OBR.player.getSelection !== "function") return;
    try {
      const selection = await OBR.player.getSelection();
      if (this.started && selection?.length) await this.checkSelection({ selection } as Player);
    } catch {
      // Initial selection lookup is best-effort.
    }
  }

  private resolveLinkedItem(
    byId: ReadonlyMap<string, Item>,
    itemId: string,
  ): { item: Item; instanceId: string } | null {
    let current = byId.get(itemId);
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const data = readIntegrationToken(current);
      if (data && data.encounterId === this.encounterId)
        return { item: current, instanceId: data.instanceId };
      current = current.attachedTo ? byId.get(current.attachedTo) : undefined;
    }
    return null;
  }

  private async checkSelection(player: Player): Promise<void> {
    if (!this.started || !this.encounterId) return;
    const selection = player.selection ?? [];
    const key = selection.join(",");
    if (key === this.selectionKey) return;
    const generation = ++this.selectionGeneration;
    let items = this.items;
    if (selection.length && selection.some((id) => !items.some((item) => item.id === id))) {
      try {
        if (await OBR.scene.isReady()) {
          const fresh = await OBR.scene.items.getItems();
          if (!this.started || generation !== this.selectionGeneration) return;
          this.items = fresh;
          items = fresh;
        }
      } catch {
        if (!this.started || generation !== this.selectionGeneration) return;
      }
    }
    if (!this.started || generation !== this.selectionGeneration || !this.encounterId) return;
    this.selectionKey = key;
    const byId = new Map(items.map((item) => [item.id, item]));
    let instanceId: string | null = null;
    const matched: string[] = [];
    const seen = new Set<string>();
    for (const id of selection) {
      const resolved = this.resolveLinkedItem(byId, id);
      if (!resolved || seen.has(resolved.item.id)) continue;
      seen.add(resolved.item.id);
      if (matched.length < LIMITS.tokenIdsPerInstance) matched.push(resolved.item.id);
      instanceId ??= resolved.instanceId;
    }
    this.emit("SELECTION_CHANGED", {
      encounterId: instanceId ? this.encounterId : null,
      instanceId,
      tokenIds: matched,
    });
  }

  /** Test/debug helper: the current observed snapshot. */
  snapshot() {
    if (!this.encounterId) return [];
    return buildMappings({
      items: this.items,
      groups: this.groups,
      encounterId: this.encounterId,
      sceneId: this.sceneId ?? "",
    });
  }
}

/** Key written on items by this integration; exported for diagnostics. */
export const OBSERVED_TOKEN_KEY = TOKEN_METADATA_KEY;
