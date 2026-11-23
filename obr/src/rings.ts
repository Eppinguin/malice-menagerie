/** External contract verified against SeamusFinlayson/rings-initiative at
 * bc3e3c0802a56baec2dcc0ea87dd86b03ed24d02. Keep its spelling of `catagory`.
 */
import OBR, {
  buildShape,
  type Item,
  type Image,
  type Shape,
  type Metadata,
} from "@owlbear-rodeo/sdk";
import { INTEGRATION_NAMESPACE, type InitiativeState } from "../../shared/obr/protocol.ts";
import { getSceneIdentity, readIntegrationToken, tokenBounds } from "./scene.ts";
import { ITEM_BATCH_SIZE, withRateLimitRetry } from "./requests.ts";
import { watchScene } from "./sceneGuard.ts";

export const RINGS_TOKEN_KEY = "rodeo.owlbear.colored-rings/initiative";
export const RINGS_SHAPE_KEY = "rodeo.owlbear.colored-rings/metadata";
export const RINGS_SCENE_KEY = "rodeo.owlbear.colored-rings/Initiative";
export const MANAGED_RING_KEY = `${INTEGRATION_NAMESPACE}/initiative-ring`;
const colors = [
  "#1a6aff",
  "#ff7433",
  "#ff4d4d",
  "#ffd433",
  "#B07126",
  "#884dff",
  "#85ff66",
  "#519E00",
  "#eb8aff",
  "#44e0f1",
  "#222222",
  "#ffffff",
];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function bounded(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.round(value)))
    : fallback;
}
function ringsFor(items: readonly Item[], tokenId: string) {
  return items
    .filter(
      (item) =>
        item.type === "SHAPE" &&
        item.attachedTo === tokenId &&
        record(item.metadata[RINGS_SHAPE_KEY])["enabled"] === true,
    )
    .sort((a, b) => Math.abs(b.scale.x) - Math.abs(a.scale.x));
}

/** Mirrors Rings' category + outermost color grouping. A ringless token is
 * its own group. Multiple map tokens for one squad have a single turn budget. */
export function readRingsInitiative(
  items: readonly Item[],
  metadata: Metadata,
  encounterId: string,
): InitiativeState | undefined {
  const outerRings = new Map<string, Shape>();
  for (const item of items) {
    if (
      item.type !== "SHAPE" ||
      !item.attachedTo ||
      !record(item.metadata[RINGS_SHAPE_KEY])["enabled"]
    )
      continue;
    const previous = outerRings.get(item.attachedTo);
    if (!previous || Math.abs(previous.scale.x) < Math.abs(item.scale.x))
      outerRings.set(item.attachedTo, item as Shape);
  }
  const byInstance = new Map<string, Item[]>();
  const peers = new Map<string, { id: string; owned: boolean }>();
  const tokenGroup = (token: Item) => {
    const data = record(token.metadata[RINGS_TOKEN_KEY]);
    const category = typeof data["catagory"] === "string" ? data["catagory"] : "Adversaries";
    const ring = outerRings.get(token.id);
    const color = ring?.style.strokeColor ?? "";
    const owner = record(ring?.metadata[MANAGED_RING_KEY]);
    const owned =
      owner["encounterId"] === encounterId &&
      owner["category"] === category &&
      owner["color"] === color &&
      typeof owner["groupId"] === "string";
    return {
      category,
      key: color ? JSON.stringify([category, color]) : token.id,
      id: owned ? (owner["groupId"] as string) : `rings-${ring?.id ?? token.id}`,
      owned,
    };
  };
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const identity = readIntegrationToken(item);
    if (!identity || identity.encounterId !== encounterId || !item.metadata[RINGS_TOKEN_KEY])
      continue;
    const data = record(item.metadata[RINGS_TOKEN_KEY]);
    if (!outerRings.has(item.id) && data["type"] !== "ALWAYS") continue;
    const tokens = byInstance.get(identity.instanceId) ?? [];
    tokens.push(item);
    byInstance.set(identity.instanceId, tokens);
    const group = tokenGroup(item);
    const previous = peers.get(group.key);
    if (!previous || (!previous.owned && group.owned)) peers.set(group.key, group);
  }
  if (!byInstance.size) return undefined;
  const combatants = [...byInstance]
    .flatMap(([instanceId, tokens]) => {
      // The carrier is the token with the squad's nonzero turn maximum. Reading
      // only the carrier ensures Ctrl+D duplicate tokens never double turns.
      const first =
        tokens.find(
          (token) => bounded(record(token.metadata[RINGS_TOKEN_KEY])["turnsMaximum"], 1, 100) > 0,
        ) ?? tokens[0]!;
      const group = tokenGroup(first);
      const firstData = record(first.metadata[RINGS_TOKEN_KEY]);
      const maximum = bounded(firstData["turnsMaximum"], 1, 100);
      // Only zero-budget followers remain after a carrier is deleted. There is
      // no turn state to observe: omit this instance so Malice retains its
      // budget and the next sync transfers it to a surviving token.
      if (maximum === 0) return [];
      const remaining = Math.min(maximum, bounded(firstData["turns"], 1, 100));
      return [
        {
          instanceId,
          groupId: peers.get(group.key)!.id,
          groupName: group.category.slice(0, 120) || "Adversaries",
          turns: maximum,
          turnsTaken: Math.max(0, maximum - remaining),
        },
      ];
    })
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return {
    encounterId,
    round: Math.max(1, bounded(record(metadata[RINGS_SCENE_KEY])["round"], 1, 10_000)),
    combatants,
  };
}

function makeRing(token: Image, color: string, dpi: number, owner: Record<string, unknown>): Item {
  const bounds = tokenBounds(token, dpi);
  const diameter = Math.min(bounds.unscaledWidth, bounds.unscaledHeight);
  return buildShape()
    .shapeType("CIRCLE")
    .width(diameter)
    .height(diameter)
    .position({
      x: bounds.centerX,
      y: bounds.centerY,
    })
    .scale({ x: bounds.scaleX * 1.05, y: bounds.scaleY * 1.05 })
    .fillOpacity(0)
    .strokeColor(color)
    .strokeOpacity(1)
    .strokeWidth(5)
    .attachedTo(token.id)
    .locked(true)
    .disableHit(true)
    .visible(token.visible)
    .layer("ATTACHMENT")
    .name("Malice activation group")
    .metadata({ [RINGS_SHAPE_KEY]: { enabled: true }, [MANAGED_RING_KEY]: owner })
    .build();
}

/** Writes only linked tokens and our own rings; manual rings and other
 * encounters stay intact. A category per activation group avoids palette limits. */
export async function syncRingsInitiative(state: InitiativeState): Promise<void> {
  const guard = watchScene();
  try {
    if (state.expectedSceneId) {
      guard.bind(state.expectedSceneId);
      await withRateLimitRetry(() => guard.check());
    }
    const { sceneId } = await withRateLimitRetry(() => getSceneIdentity());
    if (state.expectedSceneId && state.expectedSceneId !== sceneId)
      throw new Error("The Owlbear scene changed. Reconnect before syncing initiative.");
    guard.bind(sceneId);
    await withRateLimitRetry(() => guard.check());
    const [items, metadata, dpi] = await withRateLimitRetry(() =>
      Promise.all([OBR.scene.items.getItems(), OBR.scene.getMetadata(), OBR.scene.grid.getDpi()]),
    );
    const updates = new Map<
      string,
      {
        initiative?: Record<string, unknown>;
        ring?: {
          scale: { x: number; y: number };
          visible: boolean;
          strokeColor: string;
          owner: Record<string, unknown>;
        };
      }
    >();
    const additions: Item[] = [];
    const groupIds = [...new Set(state.combatants.map((entry) => entry.groupId))].sort();
    // Preserve distinct existing colors before assigning new groups. Older
    // syncs reused the first color for every differently named category.
    const appearance = new Map<string, { category: string; color: string }>();
    const used = new Set<string>();
    const usedColors = new Set<string>();
    const names = new Map(state.combatants.map((entry) => [entry.groupId, entry.groupName]));
    for (const groupId of groupIds) {
      const existing = items.find((item) => {
        const owner = record(item.metadata[MANAGED_RING_KEY]);
        return (
          item.type === "SHAPE" &&
          owner["encounterId"] === state.encounterId &&
          owner["groupId"] === groupId
        );
      }) as Shape | undefined;
      if (!existing) continue;
      const category = names.get(groupId)!;
      const color = existing.style.strokeColor;
      const key = JSON.stringify([category, color]);
      if (!usedColors.has(color)) {
        appearance.set(groupId, { category, color });
        used.add(key);
        usedColors.add(color);
      }
    }
    for (const groupId of groupIds) {
      if (appearance.has(groupId)) continue;
      let category = names.get(groupId)!;
      let color =
        colors.find((color) => !usedColors.has(color)) ??
        colors.find((color) => !used.has(JSON.stringify([category, color])));
      // More than twelve identically named groups need a distinct category too.
      if (!color) {
        category = `${category.slice(0, 100)} · ${groupIds.indexOf(groupId) + 1}`;
        color = colors[0]!;
      }
      appearance.set(groupId, { category, color });
      used.add(JSON.stringify([category, color]));
      usedColors.add(color);
    }
    const activeInstanceIds = new Set(state.combatants.map((entry) => entry.instanceId));
    for (const entry of state.combatants) {
      const tokens = items
        .filter((item) => {
          const identity = readIntegrationToken(item);
          return (
            identity?.encounterId === state.encounterId &&
            identity.instanceId === entry.instanceId &&
            item.type === "IMAGE"
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      // Keep an existing carrier stable when new tokens with earlier UUIDs arrive.
      const existingCarrier = tokens.find(
        (token) => bounded(record(token.metadata[RINGS_TOKEN_KEY])["turnsMaximum"], 0, 100) > 0,
      );
      const carrierId = existingCarrier?.id ?? tokens[0]?.id;
      for (const token of tokens) {
        const { category, color } = appearance.get(entry.groupId)!;
        const previous = record(token.metadata[RINGS_TOKEN_KEY]);
        const identity = readIntegrationToken(token)!;
        // Duplicate creature tokens and minion followers never multiply actions.
        const carrier = token.id === carrierId;
        const wasFollower = previous["turnsMaximum"] === 0;
        const initiative = {
          ...previous,
          type: "RING",
          catagory: category,
          turns: carrier ? entry.turns - entry.turnsTaken : 0,
          turnsMaximum: carrier ? entry.turns : 0,
          reactions: carrier ? (wasFollower ? 1 : (previous["reactions"] ?? 1)) : 0,
          reactionsMaximum: carrier ? (wasFollower ? 1 : (previous["reactionsMaximum"] ?? 1)) : 0,
          active: carrier && previous["active"] === true && entry.turnsTaken > 0,
        };
        if (JSON.stringify(previous) !== JSON.stringify(initiative))
          updates.set(token.id, { initiative });
        const owner = {
          encounterId: state.encounterId,
          instanceId: identity.instanceId,
          groupId: entry.groupId,
          category,
          color,
        };
        const managed = items.find(
          (item) =>
            item.attachedTo === token.id &&
            record(item.metadata[MANAGED_RING_KEY])["encounterId"] === state.encounterId,
        );
        if (!managed) {
          const ring = makeRing(token as Image, color, dpi, owner);
          const outer = ringsFor(items, token.id)[0];
          if (outer)
            ring.scale = { x: Math.abs(outer.scale.x) * 1.05, y: Math.abs(outer.scale.y) * 1.05 };
          additions.push(ring);
        } else if (managed.type === "SHAPE") {
          const outer = ringsFor(items, token.id)[0];
          const scale =
            outer && outer.id !== managed.id
              ? { x: Math.abs(outer.scale.x) * 1.05, y: Math.abs(outer.scale.y) * 1.05 }
              : { x: Math.abs(managed.scale.x), y: Math.abs(managed.scale.y) };
          const managedShape = managed as Shape;
          const changed =
            managed.scale.x !== scale.x ||
            managed.scale.y !== scale.y ||
            managed.visible !== token.visible ||
            managedShape.style.strokeColor !== color ||
            JSON.stringify(managed.metadata[MANAGED_RING_KEY]) !== JSON.stringify(owner);
          if (changed) {
            updates.set(managed.id, {
              ring: { scale, visible: token.visible, strokeColor: color, owner },
            });
          }
        }
      }
    }
    // Zero Rings turns and remove managed rings for encounter tokens absent
    // from the active initiative roster (e.g. defeated or removed combatants).
    const orphanRingIds: string[] = [];
    for (const item of items) {
      if (item.type === "SHAPE") {
        const owner = record(item.metadata[MANAGED_RING_KEY]);
        if (
          owner["encounterId"] === state.encounterId &&
          typeof owner["instanceId"] === "string" &&
          !activeInstanceIds.has(owner["instanceId"])
        ) {
          orphanRingIds.push(item.id);
        }
        continue;
      }
      if (item.type === "IMAGE") {
        const identity = readIntegrationToken(item);
        if (
          identity?.encounterId === state.encounterId &&
          !activeInstanceIds.has(identity.instanceId) &&
          item.metadata[RINGS_TOKEN_KEY]
        ) {
          const previous = record(item.metadata[RINGS_TOKEN_KEY]);
          if (
            previous["turns"] !== 0 ||
            previous["turnsMaximum"] !== 0 ||
            previous["active"] === true
          ) {
            updates.set(item.id, {
              initiative: {
                ...previous,
                turns: 0,
                turnsMaximum: 0,
                reactions: 0,
                reactionsMaximum: 0,
                active: false,
              },
            });
          }
        }
      }
    }
    if (orphanRingIds.length && typeof OBR.scene.items.deleteItems === "function") {
      for (let offset = 0; offset < orphanRingIds.length; offset += ITEM_BATCH_SIZE)
        await withRateLimitRetry(async () => {
          await guard.check();
          await OBR.scene.items.deleteItems(orphanRingIds.slice(offset, offset + ITEM_BATCH_SIZE));
        });
    }
    for (let offset = 0; offset < additions.length; offset += ITEM_BATCH_SIZE)
      await withRateLimitRetry(async () => {
        await guard.check();
        await OBR.scene.items.addItems(additions.slice(offset, offset + ITEM_BATCH_SIZE));
      });
    const ids = [...updates.keys()];
    for (let offset = 0; offset < ids.length; offset += ITEM_BATCH_SIZE)
      await withRateLimitRetry(async () => {
        await guard.check();
        await OBR.scene.items.updateItems(ids.slice(offset, offset + ITEM_BATCH_SIZE), (drafts) => {
          for (const item of drafts) {
            const update = updates.get(item.id)!;
            if (update.initiative) item.metadata[RINGS_TOKEN_KEY] = update.initiative;
            if (update.ring) {
              item.scale = update.ring.scale;
              item.visible = update.ring.visible;
              (item as Shape).style.strokeColor = update.ring.strokeColor;
              item.metadata[MANAGED_RING_KEY] = update.ring.owner;
            }
          }
        });
      });
    const previousScene = record(metadata[RINGS_SCENE_KEY]);
    if (previousScene["round"] !== state.round)
      await withRateLimitRetry(async () => {
        await guard.check();
        const fresh = record((await OBR.scene.getMetadata())[RINGS_SCENE_KEY]);
        await guard.check();
        await OBR.scene.setMetadata({ [RINGS_SCENE_KEY]: { ...fresh, round: state.round } });
      });
  } finally {
    guard.dispose();
  }
}
