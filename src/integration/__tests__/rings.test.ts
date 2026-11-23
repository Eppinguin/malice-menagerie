import { beforeEach, expect, it, vi } from "vitest";
import type { Item, Image, Metadata, Shape } from "@owlbear-rodeo/sdk";
import {
  SCENE_METADATA_KEY,
  TOKEN_METADATA_KEY,
  isInitiativeState,
  validateCommand,
  validateEvent,
  type InitiativeState,
} from "../../../shared/obr/protocol.ts";
const world = vi.hoisted(() => ({ items: [] as Item[], metadata: {} as Metadata }));
const sdk = vi.hoisted(() => ({
  room: { id: "room" },
  scene: {
    isReady: vi.fn(async () => true),
    onReadyChange: vi.fn((_callback: (ready: boolean) => void) => vi.fn()),
    onMetadataChange: vi.fn((_callback: (metadata: Metadata) => void) => vi.fn()),
    getMetadata: vi.fn(async () => world.metadata),
    setMetadata: vi.fn(async (metadata: Metadata) => Object.assign(world.metadata, metadata)),
    grid: { getDpi: async () => 150 },
    items: {
      getItems: vi.fn(async () => world.items),
      addItems: vi.fn(async (items: Item[]) => {
        world.items.push(...items);
      }),
      updateItems: vi.fn(async (ids: string[], update: (items: Item[]) => void) => {
        update(world.items.filter((item) => ids.includes(item.id)));
      }),
    },
  },
}));
vi.mock("@owlbear-rodeo/sdk", async () => {
  const { ShapeBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/ShapeBuilder.js");
  return {
    default: sdk,
    buildImage: vi.fn(),
    isImage: (item: Item) => item.type === "IMAGE",
    buildShape: () =>
      new ShapeBuilder({ id: "gm" } as ConstructorParameters<typeof ShapeBuilder>[0]),
  };
});
import {
  MANAGED_RING_KEY,
  RINGS_TOKEN_KEY,
  RINGS_SHAPE_KEY,
  RINGS_SCENE_KEY,
  readRingsInitiative,
  syncRingsInitiative,
} from "../../../obr/src/rings.ts";
import { forgetSceneIdentity } from "../../../obr/src/scene.ts";

function token(id: string, instanceId = id, kind = "creature"): Item {
  return {
    id,
    type: "IMAGE",
    name: id,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    visible: true,
    layer: "CHARACTER",
    image: { width: 300, height: 300, url: "https://example.com/token.png", mime: "image/png" },
    grid: { dpi: 150, offset: { x: 150, y: 150 } },
    metadata: {
      [TOKEN_METADATA_KEY]: {
        v: 1,
        encounterId: "enc",
        instanceId,
        kind,
        name: id,
        minionGroupId: kind === "minion-squad" ? "squad" : null,
      },
      unrelated: { keep: true },
    },
  } as unknown as Image;
}
function state(): InitiativeState {
  return {
    encounterId: "enc",
    round: 3,
    combatants: [
      { instanceId: "a", groupId: "g1", groupName: "Goblins", turns: 1, turnsTaken: 0 },
      { instanceId: "b", groupId: "g1", groupName: "Goblins", turns: 3, turnsTaken: 1 },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  forgetSceneIdentity();
  world.items = [token("a"), token("b")];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
});

it("creates actual Rings groups, shares group color, and preserves other metadata", async () => {
  await syncRingsInitiative(state());
  const rings = world.items.filter((item) => item.type === "SHAPE") as Shape[];
  expect(rings).toHaveLength(2);
  expect(rings[0]!.style.strokeColor).toBe(rings[1]!.style.strokeColor);
  expect(rings.every((ring) => ring.metadata[RINGS_SHAPE_KEY])).toBe(true);
  expect(world.items[0]!.metadata["unrelated"]).toEqual({ keep: true });
  expect(world.metadata[RINGS_SCENE_KEY]).toEqual({ round: 3 });
  expect(readRingsInitiative(world.items, world.metadata, "enc")).toEqual(state());
  vi.clearAllMocks();
  await syncRingsInitiative(state());
  expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
  expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
});

it("assigns different colors across differently named groups and repairs old duplicates", async () => {
  const desired = state();
  desired.combatants[1]!.groupId = "g2";
  desired.combatants[1]!.groupName = "Orcs";
  await syncRingsInitiative(desired);
  const rings = world.items.filter((item) => item.type === "SHAPE") as Shape[];
  expect(new Set(rings.map((ring) => ring.style.strokeColor)).size).toBe(2);

  // Reproduce the previous sync's blue rings in every category.
  rings[1]!.style.strokeColor = rings[0]!.style.strokeColor;
  (rings[1]!.metadata[MANAGED_RING_KEY] as Record<string, unknown>)["color"] =
    rings[0]!.style.strokeColor;
  await syncRingsInitiative(desired);
  expect(new Set(rings.map((ring) => ring.style.strokeColor)).size).toBe(2);
  expect(readRingsInitiative(world.items, world.metadata, "enc")).toEqual(desired);

  vi.clearAllMocks();
  await syncRingsInitiative(desired);
  expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
});

it.each([true, false])(
  "exhausts the palette before reusing colors (same name: %s)",
  async (sameName) => {
    world.items = Array.from({ length: 14 }, (_, i) => token(`token-${i}`));
    const desired: InitiativeState = {
      ...state(),
      combatants: world.items.map((item, i) => ({
        instanceId: item.id,
        groupId: `group-${i.toString().padStart(2, "0")}`,
        groupName: sameName ? "Goblins" : `Group ${i}`,
        turns: 1,
        turnsTaken: 0,
      })),
    };
    await syncRingsInitiative(desired);
    const rings = world.items.filter((item) => item.type === "SHAPE") as Shape[];
    expect(new Set(rings.slice(0, 12).map((ring) => ring.style.strokeColor)).size).toBe(12);
    const observed = readRingsInitiative(world.items, world.metadata, "enc")!;
    expect(new Set(observed.combatants.map((entry) => entry.groupId)).size).toBe(14);

    vi.clearAllMocks();
    await syncRingsInitiative(desired);
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
  },
);

it("gives a minion squad one activation budget and observes turns consumed in Rings", async () => {
  world.items = [
    token("a1", "a", "minion-squad"),
    token("a2", "a", "minion-squad"),
    token("a3", "a", "minion-squad"),
    token("a4", "a", "minion-squad"),
  ];
  const desired = { ...state(), combatants: state().combatants.slice(0, 1) };
  await syncRingsInitiative(desired);
  const tokens = world.items.filter((item) => item.type === "IMAGE");
  const data = tokens.map(
    (item) => item.metadata[RINGS_TOKEN_KEY] as { turns: number; turnsMaximum: number },
  );
  expect(data.reduce((sum, entry) => sum + entry.turnsMaximum, 0)).toBe(1);
  data[0]!.turns = 0;
  expect(readRingsInitiative(world.items, world.metadata, "enc")!.combatants[0]!.turnsTaken).toBe(
    1,
  );
  data[0]!.turns = 1;
  expect(readRingsInitiative(world.items, world.metadata, "enc")!.combatants[0]!.turnsTaken).toBe(
    0,
  );
});

it("observes a category move and grouping onto another group's ring color", async () => {
  const desired = state();
  desired.combatants[1]!.groupId = "g2";
  desired.combatants[1]!.groupName = "Orcs";
  await syncRingsInitiative(desired);
  const a = world.items.find((item) => item.id === "a")!;
  const bRing = world.items.find((item) => item.attachedTo === "b")! as Shape;
  const aRing = world.items.find((item) => item.attachedTo === "a")! as Shape;
  (a.metadata[RINGS_TOKEN_KEY] as Record<string, unknown>)["catagory"] = "Orcs";
  aRing.style.strokeColor = bRing.style.strokeColor;
  const observed = readRingsInitiative(world.items, world.metadata, "enc")!;
  expect(observed.combatants.map((entry) => entry.groupId)).toEqual(["g2", "g2"]);
  expect(observed.combatants[0]!.groupName).toBe("Orcs");
});

it("updates group membership without replacing manual rings or other encounters", async () => {
  await syncRingsInitiative(state());
  const manual = {
    ...structuredClone(world.items.find((item) => item.type === "SHAPE")!),
    id: "manual",
  } as Shape;
  manual.scale = { x: 0.8, y: 0.8 };
  delete manual.metadata[MANAGED_RING_KEY];
  world.items.push(manual, token("outsider"));
  (world.items.at(-1)!.metadata[TOKEN_METADATA_KEY] as Record<string, unknown>)["encounterId"] =
    "other";
  const before = structuredClone(manual);
  const desired = state();
  desired.combatants[0]!.groupId = "g2";
  desired.combatants[0]!.groupName = "Reinforcements";
  await syncRingsInitiative(desired);
  expect(manual).toEqual(before);
  expect(world.items.at(-1)!.metadata[RINGS_TOKEN_KEY]).toBeUndefined();
  expect(readRingsInitiative(world.items, world.metadata, "enc")!.combatants[0]!.groupId).toBe(
    "g2",
  );
});

it("rejects a stale scene before writing tokens", async () => {
  await expect(syncRingsInitiative({ ...state(), expectedSceneId: "previous" })).rejects.toThrow(
    "scene changed",
  );
  expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
  expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
});

it("validates initiative at both bridge boundaries", () => {
  expect(validateCommand("SYNC_INITIATIVE", state()).ok).toBe(true);
  expect(validateEvent("INITIATIVE_UPDATED", { sceneId: "scene", initiative: state() }).ok).toBe(
    true,
  );
  expect(isInitiativeState({ ...state(), round: NaN })).toBe(false);
  const invalid = state();
  invalid.combatants[0]!.turnsTaken = 2;
  expect(validateCommand("SYNC_INITIATIVE", invalid).ok).toBe(false);
  expect(validateEvent("INITIATIVE_UPDATED", { initiative: state() }).ok).toBe(false);
  expect(
    isInitiativeState({ ...state(), combatants: [state().combatants[0], state().combatants[0]] }),
  ).toBe(false);
});

it("keeps identically named activation groups distinct across repeated syncs", async () => {
  const desired = state();
  desired.combatants[1]!.groupId = "g2";
  await syncRingsInitiative(desired);
  expect(
    readRingsInitiative(world.items, world.metadata, "enc")!.combatants.map(
      (entry) => entry.groupId,
    ),
  ).toEqual(["g1", "g2"]);
  world.items.push(token("c"));
  desired.combatants.push({
    instanceId: "c",
    groupId: "g0",
    groupName: "Goblins",
    turns: 1,
    turnsTaken: 0,
  });
  await syncRingsInitiative(desired);
  expect(
    readRingsInitiative(world.items, world.metadata, "enc")!.combatants.map(
      (entry) => entry.groupId,
    ),
  ).toEqual(["g1", "g2", "g0"]);
});

it.each(["addition", "token update", "round"])(
  "revalidates the scene before retrying a throttled %s write",
  async (stage) => {
    vi.useFakeTimers();
    try {
      const rejectAfterTransition = async () => {
        world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "new-scene" } };
        throw new Error("Too many requests");
      };
      const write =
        stage === "addition"
          ? sdk.scene.items.addItems
          : stage === "token update"
            ? sdk.scene.items.updateItems
            : sdk.scene.setMetadata;
      write.mockImplementationOnce(rejectAfterTransition);
      const pending = expect(
        syncRingsInitiative({ ...state(), expectedSceneId: "scene" }),
      ).rejects.toThrow("scene changed");
      await vi.runAllTimersAsync();
      await pending;
      expect(write).toHaveBeenCalledTimes(1);
      expect(world.metadata).toEqual({ [SCENE_METADATA_KEY]: { sceneId: "new-scene" } });
      expect(sdk.scene.onReadyChange.mock.results[0]?.value).toHaveBeenCalled();
      expect(sdk.scene.onMetadataChange.mock.results[0]?.value).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);

it("stops later ring batches even when the GM returns to the same scene", async () => {
  world.items = Array.from({ length: 60 }, (_, i) => token(`a-${i}`, "a"));
  sdk.scene.items.addItems.mockImplementationOnce(async () => {
    sdk.scene.onReadyChange.mock.calls[0]![0](false);
    sdk.scene.onReadyChange.mock.calls[0]![0](true);
  });
  await expect(syncRingsInitiative(state())).rejects.toThrow("scene changed");
  expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(1);
  expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
});

it.each([0, 1, 3])(
  "does not infer spent turns after deleting a carrier with %s turns taken",
  async (turnsTaken) => {
    world.items = [token("a1", "a", "minion-squad"), token("a2", "a", "minion-squad"), token("b")];
    const desired = state();
    desired.combatants[0]!.turns = 3;
    desired.combatants[0]!.turnsTaken = turnsTaken;
    await syncRingsInitiative(desired);
    world.items = world.items.filter((item) => item.id !== "a1" && item.attachedTo !== "a1");
    const observed = readRingsInitiative(world.items, world.metadata, "enc")!;
    expect(observed.combatants.map((entry) => entry.instanceId)).toEqual(["b"]);
    // The partial observation preserves Malice's budget; syncing assigns a new carrier.
    await syncRingsInitiative(desired);
    expect(readRingsInitiative(world.items, world.metadata, "enc")).toEqual(desired);
    expect(world.items.find((item) => item.id === "a2")!.metadata[RINGS_TOKEN_KEY]).toMatchObject({
      turnsMaximum: 3,
      turns: 3 - turnsTaken,
      reactions: 1,
      reactionsMaximum: 1,
    });
  },
);

it("keeps positive ring scale on flipped tokens and centers rings on scaled top-left tokens", async () => {
  const flipped = {
    ...token("flip", "a"),
    scale: { x: -1, y: 1 },
  } as Image;
  const scaledTopLeft = {
    ...token("big", "b"),
    position: { x: 100, y: 100 },
    scale: { x: 2, y: 2 },
    grid: { dpi: 150, offset: { x: 0, y: 0 } },
  } as Image;
  world.items = [flipped, scaledTopLeft];
  const desired = state();
  await syncRingsInitiative(desired);
  const flipRing = world.items.find((item) => item.type === "SHAPE" && item.attachedTo === "flip")!;
  expect(flipRing.scale.x).toBeGreaterThan(0);
  expect(flipRing.scale.y).toBeGreaterThan(0);

  const bigRing = world.items.find((item) => item.type === "SHAPE" && item.attachedTo === "big")!;
  expect(bigRing.position).toEqual({ x: 400, y: 400 });
  expect(bigRing.scale).toEqual({ x: 2.1, y: 2.1 });
  expect(readRingsInitiative(world.items, world.metadata, "enc")).toEqual(desired);
});

it("updates managed ring style without overwriting live position moved during async sync", async () => {
  await syncRingsInitiative(state());
  const ring = world.items.find(
    (item) => item.type === "SHAPE" && item.attachedTo === "a",
  )! as Shape;
  const originalPos = { ...ring.position };
  const movedPos = { x: originalPos.x + 300, y: originalPos.y + 150 };

  // Simulate the GM moving token "a" (and its attached ring) between getItems() and updateItems().
  sdk.scene.items.updateItems.mockImplementationOnce(
    async (ids: string[], update: (items: Item[]) => void) => {
      ring.position = { ...movedPos };
      update(world.items.filter((item) => ids.includes(item.id)));
    },
  );
  const desired = state();
  desired.combatants[0]!.groupId = "g2";
  desired.combatants[0]!.groupName = "Flankers";
  await syncRingsInitiative(desired);

  expect(ring.position).toEqual(movedPos);
  expect(readRingsInitiative(world.items, world.metadata, "enc")!.combatants[0]!.groupId).toBe(
    "g2",
  );
});

it("does not double turns when a linked token is duplicated (Ctrl+D) and keeps the existing carrier stable", async () => {
  world.items = [token("a1", "a", "minion-squad"), token("a2", "a", "minion-squad")];
  const desired = { ...state(), combatants: [state().combatants[0]!] };
  await syncRingsInitiative(desired);

  // Simulate Ctrl+D duplicating carrier a1 with its Rings metadata intact.
  const copy = {
    ...structuredClone(world.items.find((item) => item.id === "a1")!),
    id: "a0-dup",
  } as Item;
  world.items.unshift(copy);

  // Reading turns must read from a single carrier rather than summing both copies.
  const observed = readRingsInitiative(world.items, world.metadata, "enc")!;
  expect(observed.combatants[0]).toMatchObject({ turns: 1, turnsTaken: 0 });

  // Syncing normalizes the duplicate so total turnsMaximum stays 1 (no turn doubling).
  await syncRingsInitiative(desired);
  const metaById = new Map(
    world.items
      .filter((item) => item.type === "IMAGE")
      .map((item) => [
        item.id,
        item.metadata[RINGS_TOKEN_KEY] as {
          turns: number;
          turnsMaximum: number;
          active: boolean;
        },
      ]),
  );
  const entries = [...metaById.values()];
  expect(entries.reduce((sum, entry) => sum + entry.turnsMaximum, 0)).toBe(1);
  expect(entries.filter((entry) => entry.turnsMaximum === 1)).toHaveLength(1);
  expect(entries.every((entry) => entry.active === false)).toBe(true);

  // Adding a brand-new token with an earlier ID must not steal the carrier from the existing one.
  const carrierBefore = [...metaById.entries()].find(([, v]) => v.turnsMaximum === 1)![0];
  world.items.unshift(token("a0-fresh", "a", "minion-squad"));
  await syncRingsInitiative(desired);
  const carrierAfter = world.items.find(
    (item) =>
      item.type === "IMAGE" &&
      (item.metadata[RINGS_TOKEN_KEY] as { turnsMaximum?: number } | undefined)?.turnsMaximum === 1,
  )?.id;
  expect(carrierAfter).toBe(carrierBefore);
});

it("produces finite ring geometry even when token.grid.dpi is zero", async () => {
  const brokenGrid = {
    ...token("zero-dpi", "a"),
    grid: { dpi: 0, offset: { x: 0, y: 0 } },
  } as Image;
  world.items = [brokenGrid];
  await syncRingsInitiative({ ...state(), combatants: [state().combatants[0]!] });
  const ring = world.items.find((item) => item.type === "SHAPE") as Shape;
  expect(Number.isFinite(ring.position.x)).toBe(true);
  expect(Number.isFinite(ring.position.y)).toBe(true);
  expect(Number.isFinite(ring.scale.x) && ring.scale.x > 0).toBe(true);
  expect(Number.isFinite(ring.scale.y) && ring.scale.y > 0).toBe(true);
});
