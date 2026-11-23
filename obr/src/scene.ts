import { readLabelConditions } from "./conditionLabels.ts";
import { isMarkedRoot } from "./marked.ts";
import OBR, {
  buildImage,
  isImage,
  type Image,
  type Item,
  type Metadata,
  type Vector2,
} from "@owlbear-rodeo/sdk";
import {
  INTEGRATION_NAMESPACE,
  LIMITS,
  SCENE_METADATA_KEY,
  SEAMUS_TOKEN_METADATA_KEY,
  TOKEN_METADATA_KEY,
  newMessageId,
  type CombatantKind,
  type SceneSummary,
  type TokenMapping,
} from "../../shared/obr/protocol.ts";
import { ITEM_BATCH_SIZE, withRateLimitRetry } from "./requests.ts";
import { HIGHLIGHT_METADATA_KEY } from "./config.ts";
import { watchScene } from "./sceneGuard.ts";
import { readSeamusMinionGroupId, readSeamusMonster, type SeamusMinionGroup } from "./seamus.ts";
import { renamedTokenTarget, syncedMinionSlot } from "./tokenNames.ts";
import {
  isLegacyTokenImage,
  loadTokenArtwork,
  hasMappedArtwork,
  type TokenArtworkLoader,
} from "./tokenArtwork.ts";
import { conditionSyncMode, tokenInitials, usesTokenArtwork } from "./settings.ts";
import {
  INITIALS_IMAGE_URL,
  isBrokenInitialsImage,
  isBrokenLegacyImage,
  placeholderArtwork,
} from "./placeholder.ts";

export const MODULE_VERSION = 1 as const;

export interface IntegrationTokenData {
  v: typeof MODULE_VERSION;
  encounterId: string;
  instanceId: string;
  entryId: string | null;
  slot: number;
  kind: CombatantKind;
  name: string;
  minionGroupId: string | null;
}

interface SceneIdentity {
  sceneId: string;
  roomId: string;
}

let identityPromise: Promise<SceneIdentity> | null = null;
let identityGeneration = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampStamina(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LIMITS.stamina, Math.max(0, Math.round(value)));
}

export function boundedName(value: string, fallback = "Combatant"): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, LIMITS.nameLength);
}

/** Safe world-space geometry for an IMAGE token, guarding against zero/missing dpi or scale. */
export function tokenBounds(
  token: Image,
  sceneDpi: number,
): {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  unscaledWidth: number;
  unscaledHeight: number;
  offsetX: number;
  offsetY: number;
} {
  const safeSceneDpi = Number.isFinite(sceneDpi) && sceneDpi > 0 ? sceneDpi : 150;
  const rawTokenDpi = token.grid?.dpi;
  const tokenDpi =
    typeof rawTokenDpi === "number" && Number.isFinite(rawTokenDpi) && rawTokenDpi > 0
      ? rawTokenDpi
      : safeSceneDpi;
  const imgW =
    typeof token.image?.width === "number" &&
    Number.isFinite(token.image.width) &&
    token.image.width > 0
      ? token.image.width
      : tokenDpi;
  const imgH =
    typeof token.image?.height === "number" &&
    Number.isFinite(token.image.height) &&
    token.image.height > 0
      ? token.image.height
      : tokenDpi;
  const rawScaleX = token.scale?.x;
  const rawScaleY = token.scale?.y;
  const scaleX =
    typeof rawScaleX === "number" && Number.isFinite(rawScaleX) ? Math.abs(rawScaleX) : 1;
  const scaleY =
    typeof rawScaleY === "number" && Number.isFinite(rawScaleY) ? Math.abs(rawScaleY) : 1;
  const unscaledWidth = (imgW * safeSceneDpi) / tokenDpi;
  const unscaledHeight = (imgH * safeSceneDpi) / tokenDpi;
  const rawOx = token.grid?.offset?.x;
  const rawOy = token.grid?.offset?.y;
  const offsetX =
    ((typeof rawOx === "number" && Number.isFinite(rawOx) ? rawOx : imgW / 2) * safeSceneDpi) /
    tokenDpi;
  const offsetY =
    ((typeof rawOy === "number" && Number.isFinite(rawOy) ? rawOy : imgH / 2) * safeSceneDpi) /
    tokenDpi;
  const width = unscaledWidth * scaleX;
  const height = unscaledHeight * scaleY;
  const posX =
    typeof token.position?.x === "number" && Number.isFinite(token.position.x)
      ? token.position.x
      : 0;
  const posY =
    typeof token.position?.y === "number" && Number.isFinite(token.position.y)
      ? token.position.y
      : 0;
  const left = posX - offsetX * scaleX;
  const top = posY - offsetY * scaleY;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    scaleX,
    scaleY,
    unscaledWidth,
    unscaledHeight,
    offsetX,
    offsetY,
  };
}

function newSceneId(): string {
  return `scn-${newMessageId()}`;
}

/** OBR has no scene id, so one is minted into scene metadata once per scene.
    Persisted metadata is authoritative; only concurrent reads share a promise. */
export function getSceneIdentity(): Promise<SceneIdentity> {
  if (!identityPromise) {
    const generation = identityGeneration;
    identityPromise = (async () => {
      const roomId = OBR.room.id;
      const metadata = await OBR.scene.getMetadata();
      const existing = metadata[SCENE_METADATA_KEY];
      if (isRecord(existing) && typeof existing["sceneId"] === "string" && existing["sceneId"]) {
        return { sceneId: existing["sceneId"], roomId };
      }
      if (generation !== identityGeneration) {
        throw new Error("The Owlbear scene changed while reading its identity.");
      }
      const sceneId = newSceneId();
      await OBR.scene.setMetadata({
        [SCENE_METADATA_KEY]: { v: MODULE_VERSION, sceneId, mintedAt: Date.now() },
      });
      // Another participant may have minted an ID at the same time. Read back
      // the persisted winner instead of caching our proposed identity.
      const persisted = (await OBR.scene.getMetadata())[SCENE_METADATA_KEY];
      if (!isRecord(persisted) || typeof persisted["sceneId"] !== "string" || !persisted["sceneId"])
        throw new Error("The Owlbear scene identity could not be read.");
      return { sceneId: persisted["sceneId"], roomId };
    })();
    const pending = identityPromise;
    // Do not retain a settled identity: a later competing write or missed
    // metadata event must be recoverable on the next operation.
    void pending.then(
      () => {
        if (identityPromise === pending) identityPromise = null;
      },
      () => {
        if (identityPromise === pending) identityPromise = null;
      },
    );
  }
  return identityPromise;
}

/** Reset the cached identity when OBR reports a different scene. */
export function forgetSceneIdentity(): void {
  identityGeneration += 1;
  identityPromise = null;
}

export function tokenScaleForSize(size?: string | number): { scale: number; cells: number } {
  if (size === undefined || size === null) return { scale: 1, cells: 1 };
  const match = /^\s*(\d+)\s*([tsml])?/i.exec(String(size));
  if (!match) return { scale: 1, cells: 1 };
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 1) return { scale: 1, cells: 1 };
  if (num >= 2) {
    const cells = Math.min(10, Math.round(num));
    return { scale: cells, cells };
  }
  const suffix = (match[2] ?? "").toUpperCase();
  if (suffix === "T") return { scale: 0.7, cells: 1 };
  if (suffix === "S") return { scale: 0.85, cells: 1 };
  return { scale: 1, cells: 1 };
}

function customSceneLabel(metadata: Metadata): string | null {
  const existing = metadata[SCENE_METADATA_KEY];
  if (!isRecord(existing) || typeof existing["label"] !== "string") return null;
  const trimmed = existing["label"].trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export async function setSceneLabel(
  expectedSceneId: string,
  rawLabel: string,
): Promise<SceneSummary> {
  const guard = watchScene();
  try {
    guard.bind(expectedSceneId);
    await withRateLimitRetry(async () => {
      await guard.check();
      const metadata = await OBR.scene.getMetadata();
      const existing = isRecord(metadata[SCENE_METADATA_KEY]) ? metadata[SCENE_METADATA_KEY] : null;
      if (!existing || existing["sceneId"] !== expectedSceneId) {
        throw new Error("The Owlbear scene changed. Reconnect, then try again.");
      }
      const label = rawLabel.trim().slice(0, 80);
      const next: Record<string, unknown> = { ...existing };
      if (label) next["label"] = label;
      else delete next["label"];
      await guard.check();
      await OBR.scene.setMetadata({ [SCENE_METADATA_KEY]: next });
    });
    return withRateLimitRetry(() => sceneSummary());
  } finally {
    guard.dispose();
  }
}

export async function sceneSummary(): Promise<SceneSummary> {
  const { sceneId, roomId } = await getSceneIdentity();
  const [gridDpi, position, scale, ready, metadata] = await Promise.all([
    OBR.scene.grid.getDpi(),
    OBR.viewport.getPosition(),
    OBR.viewport.getScale(),
    OBR.scene.isReady(),
    OBR.scene.getMetadata(),
  ]);
  return {
    roomId,
    sceneId,
    sceneReady: ready,
    gridDpi,
    viewport: { x: position.x, y: position.y, scale },
    label: customSceneLabel(metadata) ?? `Owlbear scene ${sceneId.slice(-6)}`,
  };
}

export function readIntegrationToken(item: Item): IntegrationTokenData | null {
  const value = item.metadata[TOKEN_METADATA_KEY];
  if (!isRecord(value)) return null;
  if (
    value["v"] !== MODULE_VERSION ||
    typeof value["encounterId"] !== "string" ||
    typeof value["instanceId"] !== "string" ||
    typeof value["name"] !== "string" ||
    (value["kind"] !== "creature" && value["kind"] !== "minion-squad")
  )
    return null;
  return {
    v: MODULE_VERSION,
    encounterId: value["encounterId"],
    instanceId: value["instanceId"],
    entryId: typeof value["entryId"] === "string" ? value["entryId"] : null,
    slot: typeof value["slot"] === "number" ? value["slot"] : 0,
    kind: value["kind"],
    name: value["name"],
    minionGroupId: typeof value["minionGroupId"] === "string" ? value["minionGroupId"] : null,
  };
}

export function integrationData(next: {
  encounterId: string;
  instanceId: string;
  entryId: string | null;
  slot: number;
  kind: CombatantKind;
  name: string;
  minionGroupId: string | null;
}): IntegrationTokenData {
  return { v: MODULE_VERSION, ...next };
}

export async function getItems(): Promise<Item[]> {
  return OBR.scene.items.getItems();
}

export function tokensForEncounter(
  items: readonly Item[],
  encounterId: string,
): { item: Item; data: IntegrationTokenData }[] {
  const out: { item: Item; data: IntegrationTokenData }[] = [];
  for (const item of items) {
    const data = readIntegrationToken(item);
    if (data && data.encounterId === encounterId) out.push({ item, data });
  }
  return out;
}

export function tokenStamina(
  item: Item,
  groups: readonly SeamusMinionGroup[],
): { current: number; max: number; individual: number | null; name: string } {
  const groupId = readSeamusMinionGroupId(item);
  if (groupId) {
    const group = groups.find((entry) => entry.id === groupId);
    if (group) {
      return {
        current: clampStamina(group.currentStamina),
        max: clampStamina(group.individualStamina),
        individual: Math.max(1, clampStamina(group.individualStamina)),
        name: group.name || item.name,
      };
    }
  }
  const monster = readSeamusMonster(item);
  if (monster) {
    return {
      current: clampStamina(monster.stamina),
      max: clampStamina(monster.staminaMaximum),
      individual: null,
      name: monster.name || item.name,
    };
  }
  return { current: 0, max: 0, individual: null, name: item.name };
}

/** Summarise every token this integration owns for one encounter. */
export function buildMappings(options: {
  items: readonly Item[];
  groups: readonly SeamusMinionGroup[];
  encounterId: string;
  sceneId: string;
}): TokenMapping[] {
  const byInstance = new Map<string, { item: Item; data: IntegrationTokenData }[]>();
  for (const entry of tokensForEncounter(options.items, options.encounterId)) {
    const list = byInstance.get(entry.data.instanceId) ?? [];
    list.push(entry);
    byInstance.set(entry.data.instanceId, list);
  }
  const mappings: TokenMapping[] = [];
  for (const [instanceId, entries] of byInstance) {
    const first = entries[0] as { item: Item; data: IntegrationTokenData };
    const stamina = tokenStamina(first.item, options.groups);
    const isSquad = first.data.kind === "minion-squad";
    const count = entries.length;
    const tokenIds = entries.slice(0, LIMITS.tokenIdsPerInstance).map((entry) => entry.item.id);
    const liveGroupId = isSquad
      ? (readSeamusMinionGroupId(first.item) ?? first.data.minionGroupId)
      : first.data.minionGroupId;
    mappings.push({
      encounterId: options.encounterId,
      instanceId,
      sceneId: options.sceneId,
      tokenIds,
      minionGroupId: liveGroupId,
      entryId: first.data.entryId,
      slot: first.data.slot,
      kind: first.data.kind,
      name: boundedName(stamina.name || first.data.name),
      ...(!isSquad && conditionSyncMode() !== "off"
        ? {
            conditions: readLabelConditions(options.items, tokenIds),
          }
        : {}),
      currentStamina: clampStamina(stamina.current),
      maxStamina: isSquad
        ? clampStamina((stamina.individual ?? 1) * Math.max(1, count))
        : clampStamina(stamina.max),
      individualStamina: isSquad ? Math.max(1, clampStamina(stamina.individual ?? 1)) : null,
      visible: entries.some((entry) => entry.item.visible),
      missing: false,
      updatedAt: Date.now(),
    });
  }
  return mappings;
}

/** Take one viewport/scene snapshot, then reserve placements locally.
 * On hex grids, snap candidate positions through Owlbear's grid helper and
 * deduplicate snapped centers so tokens sit cleanly in hex cells without stacking. */
export async function tokenPlacement(
  items: readonly Item[],
  dpi: number,
): Promise<(cells?: number) => Promise<Vector2>> {
  const safeDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 150;
  const [width, height] = await withRateLimitRetry(() =>
    Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]),
  );
  const world = await withRateLimitRetry(() =>
    OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 }),
  );
  const gridType =
    typeof OBR.scene.grid.getType === "function"
      ? await withRateLimitRetry(() => OBR.scene.grid.getType()).catch(() => "SQUARE" as const)
      : ("SQUARE" as const);
  const useSnap = gridType !== "SQUARE" && typeof OBR.scene.grid.snapPosition === "function";
  const occupied = new Set<string>();
  const snappedOccupied = new Set<string>();
  const snapKey = (point: Vector2) => `${Math.round(point.x / 4)},${Math.round(point.y / 4)}`;
  for (const item of items) {
    if (item.layer !== "CHARACTER" && item.layer !== "PROP" && item.layer !== "MOUNT") continue;
    markItemOccupied(occupied, item, safeDpi);
    if (useSnap) snappedOccupied.add(snapKey(item.position));
  }
  const startX = Math.floor(world.x / safeDpi);
  const startY = Math.floor(world.y / safeDpi);
  // Keep one spiral cursor per footprint size so large squads stay O(N) while
  // multi-cell monsters (Size 2+) find a clean N×N block of free cells.
  const generators = new Map<number, Generator<Vector2, never>>();
  function* availableBlocks(cells: number): Generator<Vector2, never> {
    for (let radius = 0; ; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const bx = startX + dx;
          const by = startY + dy;
          if (!blockFree(occupied, bx, by, cells)) continue;
          for (let cy = 0; cy < cells; cy += 1) {
            for (let cx = 0; cx < cells; cx += 1) occupied.add(`${bx + cx},${by + cy}`);
          }
          yield { x: (bx + cells / 2) * safeDpi, y: (by + cells / 2) * safeDpi };
        }
      }
    }
  }
  return async (cells = 1) => {
    const span = Math.max(1, Math.min(10, Math.round(cells)));
    let generator = generators.get(span);
    if (!generator) {
      generator = availableBlocks(span);
      generators.set(span, generator);
    }
    if (!useSnap) return generator.next().value;
    for (let attempts = 0; attempts < 24; attempts += 1) {
      const candidate = generator.next().value;
      const snapped = await withRateLimitRetry(() =>
        OBR.scene.grid.snapPosition(candidate, 1, false, true),
      ).catch(() => candidate);
      const key = snapKey(snapped);
      if (snappedOccupied.has(key)) continue;
      snappedOccupied.add(key);
      return snapped;
    }
    return generator.next().value;
  };
}

function blockFree(occupied: ReadonlySet<string>, bx: number, by: number, cells: number): boolean {
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      if (occupied.has(`${bx + cx},${by + cy}`)) return false;
    }
  }
  return true;
}

function markItemOccupied(occupied: Set<string>, item: Item, dpi: number): void {
  if (isImage(item) && item.grid?.dpi > 0 && item.image?.width > 0 && item.image?.height > 0) {
    const scaleX = Math.abs(item.scale?.x ?? 1);
    const scaleY = Math.abs(item.scale?.y ?? 1);
    const width = ((item.image.width * dpi) / item.grid.dpi) * scaleX;
    const height = ((item.image.height * dpi) / item.grid.dpi) * scaleY;
    const ox = (((item.grid.offset?.x ?? item.image.width / 2) * dpi) / item.grid.dpi) * scaleX;
    const oy = (((item.grid.offset?.y ?? item.image.height / 2) * dpi) / item.grid.dpi) * scaleY;
    const minX = Math.floor((item.position.x - ox + 1) / dpi);
    const maxX = Math.min(
      minX + 19,
      Math.floor((item.position.x - ox + Math.max(1, width - 1)) / dpi),
    );
    const minY = Math.floor((item.position.y - oy + 1) / dpi);
    const maxY = Math.min(
      minY + 19,
      Math.floor((item.position.y - oy + Math.max(1, height - 1)) / dpi),
    );
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) occupied.add(`${cx},${cy}`);
    }
    return;
  }
  occupied.add(`${Math.floor(item.position.x / dpi)},${Math.floor(item.position.y / dpi)}`);
}

function initialsText(name: string, label?: string) {
  return buildImage(placeholderArtwork(), { dpi: 72, offset: { x: 36, y: 36 } })
    .textItemType("TEXT")
    .plainText(label ?? tokenInitials(name))
    .fontFamily("Roboto")
    .fontSize(24)
    .fontWeight(600)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .textFillColor("#ffffff")
    .textStrokeWidth(0)
    .textWidth(72)
    .textHeight(72)
    .textPadding(0)
    .build().text;
}

export async function buildToken(options: {
  name: string;
  position: Vector2;
  integration: IntegrationTokenData;
  metadata: Metadata;
  sourcePath?: string | undefined;
  size?: string | undefined;
  visible?: boolean | undefined;
  initials?: string | undefined;
  loadArtwork?: TokenArtworkLoader;
}): Promise<Item> {
  let initials = !usesTokenArtwork() || !hasMappedArtwork(options.sourcePath);
  let artwork = placeholderArtwork();
  if (!initials) {
    try {
      artwork = await (options.loadArtwork ?? loadTokenArtwork)(options.sourcePath);
    } catch {
      initials = true;
    }
  }
  const { scale } = tokenScaleForSize(options.size);
  const image = buildImage(artwork, {
    dpi: Math.max(artwork.width, artwork.height),
    offset: { x: artwork.width / 2, y: artwork.height / 2 },
  })
    .name(options.name)
    .position(options.position)
    .scale({ x: scale, y: scale })
    .layer("CHARACTER")
    .visible(options.visible ?? true)
    .metadata({
      ...options.metadata,
      [TOKEN_METADATA_KEY]: options.integration,
    });
  if (initials) image.textItemType("TEXT").text(initialsText(options.name, options.initials));
  const item = image.build();
  return item;
}

/**
 * A token is renamed only while it still carries the name this integration
 * last wrote. A name the GM changed in Owlbear is the GM's, so it is left
 * alone; the linked metadata still follows Malice.
 *
 * Tokens created by older builds still point at a `token.png` on the extension
 * host or at an inlined `data:` URL; neither renders in Owlbear. Repair that
 * URL here so a normal send heals them; art the GM supplied is left untouched.
 */
export interface TokenMetadataUpdate {
  item: Item;
  metadata: Metadata;
  desiredName: string;
  sourcePath?: string | undefined;
  /** True when updating a minion squad token (even if adopting metadata-less tokens). */
  isSquad?: boolean | undefined;
  /** True during explicit imports/reconciles so broken legacy URLs are repaired. */
  repairLegacy?: boolean | undefined;
}

/** Prepare changes locally, then update a whole batch in one SDK request. */
export async function updateTokensMetadata(
  updates: readonly TokenMetadataUpdate[],
  beforeWrite: () => Promise<void> = async () => {},
  loadArtwork: TokenArtworkLoader = loadTokenArtwork,
): Promise<void> {
  const prepared = [];
  for (const update of updates) {
    const { item, metadata, desiredName, sourcePath, repairLegacy } = update;
    const existingMeta = readIntegrationToken(item);
    const isSquad = update.isSquad ?? existingMeta?.kind === "minion-squad";
    const renameTarget = renamedTokenTarget(
      item.name,
      existingMeta?.name ?? null,
      desiredName,
      isSquad,
    );
    const brokenInitials = isImage(item) && isBrokenInitialsImage(item.image.url);
    const brokenLegacy =
      Boolean(repairLegacy) && isImage(item) && isBrokenLegacyImage(item.image.url);
    const upgradeArtwork =
      isImage(item) &&
      sourcePath &&
      hasMappedArtwork(sourcePath) &&
      (brokenInitials || isLegacyTokenImage(item.image.url)) &&
      usesTokenArtwork()
        ? await loadArtwork(sourcePath).catch(() => null)
        : null;
    const repairInitials = !upgradeArtwork && (brokenInitials || brokenLegacy);
    const artwork = upgradeArtwork ?? (repairInitials ? placeholderArtwork() : null);
    if (
      (!renameTarget || item.name === renameTarget.name) &&
      !artwork &&
      Object.entries(metadata).every(
        ([key, value]) => JSON.stringify(item.metadata[key]) === JSON.stringify(value),
      )
    )
      continue;
    prepared.push({ ...update, artwork, repairInitials });
  }
  for (let offset = 0; offset < prepared.length; offset += ITEM_BATCH_SIZE) {
    const batch = prepared.slice(offset, offset + ITEM_BATCH_SIZE);
    const byId = new Map(batch.map((update) => [update.item.id, update]));
    await withRateLimitRetry(async () => {
      await beforeWrite();
      return OBR.scene.items.updateItems(
        batch.map((update) => update.item.id),
        (drafts) => {
          for (const draft of drafts) {
            const update = byId.get(draft.id);
            if (!update) continue;
            const existingMeta = readIntegrationToken(draft);
            const isSquad = update.isSquad ?? existingMeta?.kind === "minion-squad";
            const renameTarget = renamedTokenTarget(
              draft.name,
              existingMeta?.name ?? null,
              update.desiredName,
              isSquad,
            );
            if (renameTarget && draft.name !== renameTarget.name) {
              if (
                isImage(draft) &&
                draft.image.url === INITIALS_IMAGE_URL &&
                draft.textItemType === "TEXT"
              ) {
                const previousInitials =
                  renameTarget.slotNumber !== null && existingMeta?.name
                    ? tokenInitials(existingMeta.name, renameTarget.slotNumber)
                    : tokenInitials(draft.name);
                if (draft.text.plainText === previousInitials) {
                  draft.text.plainText =
                    renameTarget.slotNumber !== null
                      ? tokenInitials(update.desiredName, renameTarget.slotNumber)
                      : tokenInitials(update.desiredName);
                }
              }
              draft.name = renameTarget.name;
            }
            for (const [key, value] of Object.entries(update.metadata)) {
              if (
                key === SEAMUS_TOKEN_METADATA_KEY &&
                isRecord(value) &&
                value["type"] === "MONSTER" &&
                isRecord(draft.metadata[key])
              ) {
                const live = draft.metadata[key] as Record<string, unknown>;
                draft.metadata[key] = {
                  ...live,
                  ...value,
                  // Preserve live GM-only / temporary stamina edits made while
                  // artwork prefetch or rate-limit retries were in flight.
                  ...(typeof live["gmOnly"] === "boolean" ? { gmOnly: live["gmOnly"] } : {}),
                  ...(typeof live["temporaryStamina"] === "number" &&
                  Number.isFinite(live["temporaryStamina"])
                    ? { temporaryStamina: live["temporaryStamina"] }
                    : {}),
                };
              } else {
                draft.metadata[key] = value;
              }
            }
            if (
              isImage(draft) &&
              isImage(update.item) &&
              draft.image.url === update.item.image.url &&
              update.artwork
            ) {
              // Keep the existing on-map size and anchor ratio when replacing
              // an older image with different pixel dimensions.
              const oldW = draft.image.width || 1;
              const oldH = draft.image.height || 1;
              const ox = draft.grid.offset?.x ?? oldW / 2;
              const oy = draft.grid.offset?.y ?? oldH / 2;
              if (update.repairInitials) {
                const slot = isSquad ? syncedMinionSlot(draft.name, update.desiredName) : null;
                draft.text = initialsText(
                  draft.name,
                  slot !== null ? tokenInitials(update.desiredName, slot) : undefined,
                );
                draft.textItemType = "TEXT";
              }
              draft.image = { ...draft.image, ...update.artwork };
              draft.grid = {
                ...draft.grid,
                dpi: Math.max(update.artwork.width, update.artwork.height),
                offset: {
                  x: (ox / oldW) * update.artwork.width,
                  y: (oy / oldH) * update.artwork.height,
                },
              };
            }
          }
        },
      );
    });
  }
}

/** Select the linked creature or whole squad using Owlbear's native selection. */
export async function selectTokens(tokenIds: readonly string[]): Promise<void> {
  await clearHighlights();
  if (!tokenIds.length) return;
  await OBR.player.select([...tokenIds], true);
}

export async function clearHighlights(): Promise<void> {
  try {
    const local = await OBR.scene.local.getItems();
    const stale = local.filter((item) => item.metadata[HIGHLIGHT_METADATA_KEY] === true);
    if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));
  } catch {
    // Local items disappear with the scene; nothing to clean up.
  }
}

/** Centre the viewport on the tokens without changing its zoom. */
export async function focusTokens(tokenIds: readonly string[]): Promise<void> {
  if (!tokenIds.length) return;
  const bounds = await OBR.scene.items.getItemBounds([...tokenIds]);
  if (!Number.isFinite(bounds.center.x) || !Number.isFinite(bounds.center.y)) return;
  const [position, scale, width, height] = await Promise.all([
    OBR.viewport.getPosition(),
    OBR.viewport.getScale(),
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  // Pan is a screen-space translation. Convert the token centre to screen
  // coordinates before calculating the offset; a world-space delta has the
  // wrong direction and ignores zoom.
  const tokenOnScreen = await OBR.viewport.transformPoint(bounds.center);
  await OBR.viewport.animateTo({
    position: {
      x: position.x + width / 2 - tokenOnScreen.x,
      y: position.y + height / 2 - tokenOnScreen.y,
    },
    scale,
  });
}

/** Collect every item attached beneath `rootIds`, including nested attachments
 * (such as Marked! text and counter controls). */
export function collectAttachedIds(items: readonly Item[], rootIds: Iterable<string>): string[] {
  const ids = new Set(rootIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of items) {
      if (item.attachedTo && ids.has(item.attachedTo) && !ids.has(item.id)) {
        ids.add(item.id);
        expanded = true;
      }
    }
  }
  return [...ids];
}

const RINGS_OVERLAY_KEYS = [
  "rodeo.owlbear.colored-rings/metadata",
  `${INTEGRATION_NAMESPACE}/initiative-ring`,
] as const;

function isManagedOverlay(item: Item): boolean {
  if (item.type === "LABEL" && item.attachedTo && item.id.startsWith(`${item.attachedTo}-label-`))
    return true;
  if (item.type === "SHAPE" && RINGS_OVERLAY_KEYS.some((key) => key in item.metadata)) return true;
  return isMarkedRoot(item);
}

/** Collect root tokens plus only overlays managed by this integration, Rings,
 * Token Labels, or Marked! (including Marked! descendants), so revealing a token
 * does not unintentionally expose unrelated GM-attached notes or auras. */
export function collectManagedOverlayIds(
  items: readonly Item[],
  rootIds: Iterable<string>,
): string[] {
  const roots = new Set(rootIds);
  const managed = new Set(roots);
  const markedRoots = new Set<string>();
  for (const item of items) {
    if (!item.attachedTo || !roots.has(item.attachedTo)) continue;
    if (!isManagedOverlay(item)) continue;
    managed.add(item.id);
    if (isMarkedRoot(item)) markedRoots.add(item.id);
  }
  if (markedRoots.size) {
    for (const id of collectAttachedIds(items, markedRoots)) managed.add(id);
  }
  return [...managed];
}

/** Hide or reveal a combatant's linked tokens and managed overlays (rings, labels, markers). */
export async function setTokensVisibility(
  encounterId: string,
  instanceId: string,
  visible: boolean,
  expectedSceneId: string,
): Promise<{ visible: boolean }> {
  const guard = watchScene();
  try {
    guard.bind(expectedSceneId);
    await withRateLimitRetry(() => guard.check());
    const items = await withRateLimitRetry(() => getItems());
    const roots = items
      .filter((item) => {
        const data = readIntegrationToken(item);
        return data?.encounterId === encounterId && data.instanceId === instanceId;
      })
      .map((item) => item.id);
    if (!roots.length) return { visible };
    const targets = collectManagedOverlayIds(items, roots);
    for (let offset = 0; offset < targets.length; offset += ITEM_BATCH_SIZE) {
      const batch = targets.slice(offset, offset + ITEM_BATCH_SIZE);
      await withRateLimitRetry(async () => {
        await guard.check();
        await OBR.scene.items.updateItems(batch, (drafts) => {
          for (const draft of drafts) draft.visible = visible;
        });
      });
    }
    return { visible };
  } finally {
    guard.dispose();
  }
}
