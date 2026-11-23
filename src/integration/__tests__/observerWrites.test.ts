import { afterEach, expect, it, vi } from "vitest";
import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import {
  SCENE_METADATA_KEY,
  SEAMUS_MINION_GROUPS_KEY,
  SEAMUS_TOKEN_METADATA_KEY,
  TOKEN_METADATA_KEY,
} from "../../../shared/obr/protocol.ts";
const world = vi.hoisted(() => ({
  items: [] as Item[],
  metadata: {} as Metadata,
  onItems: null as ((items: Item[]) => void) | null,
  onMetadata: null as ((metadata: Metadata) => void) | null,
  onPlayer: null as ((player: { selection?: string[] }) => void) | null,
  onReadyChange: null as ((ready: boolean) => void) | null,
}));
vi.mock("@owlbear-rodeo/sdk", () => ({
  buildImage: vi.fn(),
  isImage: vi.fn(),
  default: {
    room: { id: "room-1" },
    player: {
      onChange: (fn: (player: { selection?: string[] }) => void) => {
        world.onPlayer = fn;
        return () => {};
      },
    },
    scene: {
      isReady: async () => true,
      items: {
        getItems: async () => world.items,
        onChange: (fn: (items: Item[]) => void) => {
          world.onItems = fn;
          return () => {};
        },
      },
      getMetadata: async () => world.metadata,
      onMetadataChange: (fn: (metadata: Metadata) => void) => {
        world.onMetadata = fn;
        return () => {};
      },
      onReadyChange: (fn: (ready: boolean) => void) => {
        world.onReadyChange = fn;
        return () => {};
      },
    },
  },
}));
import { SceneObserver } from "../../../obr/src/observers.ts";
import { forgetSceneIdentity } from "../../../obr/src/scene.ts";
import { mergeRawMinionGroups } from "../../../obr/src/seamus.ts";
afterEach(() => vi.useRealTimers());

it("does not sync transient minion values during a batched write, then resumes normal observations", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  world.metadata = {
    [SCENE_METADATA_KEY]: { sceneId: "scene-1" },
    [SEAMUS_MINION_GROUPS_KEY]: [
      { type: "MINION", id: "squad", name: "Squad", currentStamina: 40, individualStamina: 10 },
    ],
  };
  world.items = [
    {
      id: "token-1",
      name: "Squad",
      type: "IMAGE",
      visible: true,
      locked: false,
      createdUserId: "gm",
      zIndex: 0,
      lastModified: "2026-11-16T00:00:00Z",
      lastModifiedUserId: "gm",
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      layer: "CHARACTER",
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc-1",
          instanceId: "squad-1",
          kind: "minion-squad",
          name: "Squad",
          minionGroupId: "squad",
        },
        [SEAMUS_TOKEN_METADATA_KEY]: { type: "MINION", groupId: "squad" },
      },
    },
  ];
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.setEncounter("enc-1");
  observer.start();
  await observer.rebaseline();
  const resume = observer.suspendWrites();
  world.onItems?.([]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(emit).not.toHaveBeenCalled();
  world.onItems?.(world.items);
  (world.metadata[SEAMUS_MINION_GROUPS_KEY] as { currentStamina: number }[])[0]!.currentStamina =
    30;
  world.onMetadata?.(world.metadata);
  await observer.rebaseline();
  resume();
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();
  (world.metadata[SEAMUS_MINION_GROUPS_KEY] as { currentStamina: number }[])[0]!.currentStamina =
    20;
  world.onMetadata?.(world.metadata);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).toHaveBeenCalledWith(
    "COMBATANT_UPDATED",
    expect.objectContaining({ update: expect.objectContaining({ currentStamina: 20 }) }),
  );
  observer.stop();
});

it.each(["none", "before", "during"])(
  "suppresses initiative echoes with external combatant changes %s the write",
  async (phase) => {
    vi.useFakeTimers();
    forgetSceneIdentity();
    const initiativeKey = "rodeo.owlbear.colored-rings/initiative";
    const roundKey = "rodeo.owlbear.colored-rings/Initiative";
    world.items = [
      {
        id: "rings-token",
        type: "IMAGE",
        name: "Goblin",
        scale: { x: 1, y: 1 },
        metadata: {
          [TOKEN_METADATA_KEY]: {
            v: 1,
            encounterId: "enc",
            instanceId: "a",
            name: "Goblin",
            kind: "creature",
          },
          [SEAMUS_TOKEN_METADATA_KEY]: {
            type: "MONSTER",
            name: "Goblin",
            stamina: 10,
            staminaMaximum: 10,
          },
          [initiativeKey]: { type: "ALWAYS", catagory: "Goblins", turns: 1, turnsMaximum: 1 },
        },
      } as unknown as Item,
    ];
    world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" }, [roundKey]: { round: 1 } };
    const emit = vi.fn();
    const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
    observer.setEncounter("enc");
    observer.start();
    await observer.rebaseline();
    (world.items[0]!.metadata[initiativeKey] as Record<string, unknown>)["turns"] = 0;
    world.onItems?.(world.items);
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).toHaveBeenCalledWith(
      "INITIATIVE_UPDATED",
      expect.objectContaining({
        sceneId: "scene",
        initiative: expect.objectContaining({
          round: 1,
          combatants: [expect.objectContaining({ instanceId: "a", turnsTaken: 1 })],
        }),
      }),
    );
    emit.mockClear();
    const externalChange = () => {
      (world.items[0]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>).stamina = 7;
      world.items.push({
        id: "rings-token-label-external",
        type: "LABEL",
        attachedTo: "rings-token",
        metadata: {},
        text: { plainText: "Dazed" },
      } as unknown as Item);
      world.onItems?.(world.items);
    };
    if (phase === "before") externalChange();
    const resume = observer.suspendWrites();
    if (phase === "during") externalChange();
    (world.items[0]!.metadata[initiativeKey] as Record<string, unknown>)["turns"] = 1;
    world.onItems?.(world.items);
    await observer.rebaselineInitiative();
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalled();
    resume();
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalledWith("INITIATIVE_UPDATED", expect.anything());
    if (phase === "none") expect(emit).not.toHaveBeenCalled();
    else
      expect(emit).toHaveBeenCalledWith(
        "COMBATANT_UPDATED",
        expect.objectContaining({
          update: expect.objectContaining({ currentStamina: 7, conditions: ["Dazed"] }),
        }),
      );
    world.metadata[roundKey] = { round: 2 };
    world.onMetadata?.(world.metadata);
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).toHaveBeenCalledWith(
      "INITIATIVE_UPDATED",
      expect.objectContaining({ initiative: expect.objectContaining({ round: 2 }) }),
    );
    observer.stop();
  },
);

it.each(["Token Labels", "Marked!"])(
  "observes %s additions/removals, ignores annotations and suppresses own writes",
  async (provider) => {
    vi.useFakeTimers();
    forgetSceneIdentity();
    world.items = [
      {
        id: "token",
        type: "IMAGE",
        name: "Goblin",
        scale: { x: 1, y: 1 },
        metadata: {
          [TOKEN_METADATA_KEY]: {
            v: 1,
            encounterId: "enc",
            instanceId: "a",
            name: "Goblin",
            kind: "creature",
          },
          [SEAMUS_TOKEN_METADATA_KEY]: {
            type: "MONSTER",
            name: "Goblin",
            stamina: 10,
            staminaMaximum: 10,
          },
        },
      } as unknown as Item,
    ];
    world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
    const emit = vi.fn();
    const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
    observer.setEncounter("enc");
    observer.start();
    await observer.rebaseline();
    const label = (provider === "Marked!"
      ? {
          id: "marked-root",
          type: "PATH",
          name: "Dazed 😵‍💫 (SE) 🎲",
          attachedTo: "token",
          metadata: {
            "com.battle-system.mark/direction": 601,
            "com.battle-system.mark/place": 0,
            "com.battle-system.mark/comboid": "combo",
          },
        }
      : {
          id: "token-label-1",
          type: "LABEL",
          attachedTo: "token",
          metadata: {},
          text: { plainText: "Dazed 😵‍💫 (SE) 🎲" },
        }) as unknown as Item;
    world.items.push(label);
    world.onItems?.(world.items);
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).toHaveBeenCalledWith(
      "COMBATANT_UPDATED",
      expect.objectContaining({
        update: expect.objectContaining({ conditions: ["Dazed"], currentStamina: 10 }),
      }),
    );
    emit.mockClear();
    world.items.pop();
    world.onItems?.(world.items);
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).toHaveBeenCalledWith(
      "COMBATANT_UPDATED",
      expect.objectContaining({
        update: expect.objectContaining({ conditions: [] }),
      }),
    );
    emit.mockClear();
    const resume = observer.suspendWrites();
    world.items.push(label);
    world.onItems?.(world.items);
    await observer.rebaseline();
    resume();
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalled();
    world.items.push({
      ...label,
      id: "token-label-2",
      name: "Quest giver",
      text: { plainText: "Quest giver" },
    } as unknown as Item);
    world.onItems?.(world.items);
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalled();
    observer.stop();
  },
);

it.each(["stamina", "conditions", "deletion", "initiative"])(
  "preserves an unrelated external %s change while suppressing a combatant write",
  async (change) => {
    vi.useFakeTimers();
    forgetSceneIdentity();
    const token = (id: string) =>
      ({
        id,
        type: "IMAGE",
        name: id,
        scale: { x: 1, y: 1 },
        metadata: {
          [TOKEN_METADATA_KEY]: {
            v: 1,
            encounterId: "enc",
            instanceId: id,
            name: id,
            kind: "creature",
          },
          [SEAMUS_TOKEN_METADATA_KEY]: {
            type: "MONSTER",
            name: id,
            stamina: 10,
            staminaMaximum: 10,
          },
        },
      }) as unknown as Item;
    world.items = [token("a"), token("b")];
    const roundKey = "rodeo.owlbear.colored-rings/Initiative";
    world.items[1]!.metadata["rodeo.owlbear.colored-rings/initiative"] = {
      type: "ALWAYS",
      catagory: "B",
      turns: 1,
      turnsMaximum: 1,
    };
    world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" }, [roundKey]: { round: 1 } };
    const emit = vi.fn();
    const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
    observer.setEncounter("enc");
    observer.start();
    await observer.rebaseline();
    const resume = observer.suspendWrites();
    (world.items[0]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>).stamina = 5;
    world.items.push({
      id: "a-label-own",
      type: "LABEL",
      attachedTo: "a",
      metadata: {},
      text: { plainText: "Dazed" },
    } as unknown as Item);
    if (change === "stamina")
      (world.items[1]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>).stamina = 7;
    if (change === "conditions")
      world.items.push({
        id: "b-label-external",
        type: "LABEL",
        attachedTo: "b",
        metadata: {},
        text: { plainText: "Slowed" },
      } as unknown as Item);
    if (change === "deletion") world.items = world.items.filter((item) => item.id !== "b");
    if (change === "initiative") world.metadata[roundKey] = { round: 2 };
    world.onItems?.(world.items);
    world.onMetadata?.(world.metadata);
    observer.markWritten({
      instanceId: "a",
      kind: "creature",
      currentStamina: 5,
      maxStamina: 10,
      name: "a",
      tokenIds: ["a"],
      conditions: ["Dazed"],
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalled();
    resume();
    await vi.advanceTimersByTimeAsync(200);
    expect(emit).not.toHaveBeenCalledWith(
      "COMBATANT_UPDATED",
      expect.objectContaining({ update: expect.objectContaining({ instanceId: "a" }) }),
    );
    if (change === "deletion")
      expect(emit).toHaveBeenCalledWith(
        "TOKEN_DELETED",
        expect.objectContaining({ instanceId: "b", allMissing: true }),
      );
    else if (change === "initiative")
      expect(emit).toHaveBeenCalledWith(
        "INITIATIVE_UPDATED",
        expect.objectContaining({ initiative: expect.objectContaining({ round: 2 }) }),
      );
    else
      expect(emit).toHaveBeenCalledWith(
        "COMBATANT_UPDATED",
        expect.objectContaining({
          update: expect.objectContaining({
            instanceId: "b",
            ...(change === "stamina" ? { currentStamina: 7 } : { conditions: ["Slowed"] }),
          }),
        }),
      );
    observer.stop();
  },
);

it("skips Rings observation when ringsEnabled is false and omits conditions when conditionsEnabled is false", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  const initiativeKey = "rodeo.owlbear.colored-rings/initiative";
  const roundKey = "rodeo.owlbear.colored-rings/Initiative";
  world.items = [
    {
      id: "token",
      type: "IMAGE",
      name: "Goblin",
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "a",
          name: "Goblin",
          kind: "creature",
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Goblin",
          stamina: 10,
          staminaMaximum: 10,
        },
        [initiativeKey]: { type: "ALWAYS", catagory: "Goblins", turns: 1, turnsMaximum: 1 },
      },
    } as unknown as Item,
  ];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" }, [roundKey]: { round: 1 } };
  const emit = vi.fn();
  const observer = new SceneObserver({
    emit,
    onSceneChanged: vi.fn(),
    onSceneLost: vi.fn(),
    ringsEnabled: () => false,
    conditionsEnabled: () => false,
  });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();
  (world.items[0]!.metadata[initiativeKey] as Record<string, unknown>)["turns"] = 0;
  world.metadata[roundKey] = { round: 2 };
  world.items.push({
    id: "token-label-1",
    type: "LABEL",
    attachedTo: "token",
    metadata: {},
    text: { plainText: "Dazed" },
  } as unknown as Item);
  world.onItems?.(world.items);
  world.onMetadata?.(world.metadata);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();

  (world.items[0]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>).stamina = 6;
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    "COMBATANT_UPDATED",
    expect.objectContaining({
      update: expect.objectContaining({ currentStamina: 6 }),
    }),
  );
  const emittedUpdate = (emit.mock.calls[0]![1] as { update: { conditions?: string[] } }).update;
  expect(emittedUpdate.conditions).toBeUndefined();
  observer.stop();
});

it("resolves Owlbear selection from stale cache, attached items, and clears on deselect", async () => {
  forgetSceneIdentity();
  world.items = [
    {
      id: "token-1",
      type: "IMAGE",
      name: "Goblin",
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "inst-1",
          name: "Goblin",
          kind: "creature",
        },
      },
    } as unknown as Item,
    {
      id: "token-1-label-dazed",
      type: "LABEL",
      attachedTo: "token-1",
      metadata: {},
      text: { plainText: "Dazed" },
    } as unknown as Item,
  ];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.start();
  observer.setEncounter("enc");

  // Selection arrives before onItems/rebaseline populates cache: falls back to getItems().
  world.onPlayer?.({ selection: ["token-1"] });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(emit).toHaveBeenCalledWith("SELECTION_CHANGED", {
    encounterId: "enc",
    instanceId: "inst-1",
    tokenIds: ["token-1"],
  });

  emit.mockClear();
  world.onPlayer?.({ selection: ["token-1-label-dazed"] });
  await Promise.resolve();
  expect(emit).toHaveBeenCalledWith("SELECTION_CHANGED", {
    encounterId: "enc",
    instanceId: "inst-1",
    tokenIds: ["token-1"],
  });

  emit.mockClear();
  world.onPlayer?.({ selection: [] });
  await Promise.resolve();
  expect(emit).toHaveBeenCalledWith("SELECTION_CHANGED", {
    encounterId: null,
    instanceId: null,
    tokenIds: [],
  });
  observer.stop();
});

it("ignores per-minion condition labels and avoids spurious updates when a fallen minion token is deleted", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  const squadToken = (id: string) =>
    ({
      id,
      name: `Squad ${id}`,
      type: "IMAGE",
      visible: true,
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "squad-1",
          kind: "minion-squad",
          name: "Squad",
          minionGroupId: "squad",
        },
        [SEAMUS_TOKEN_METADATA_KEY]: { type: "MINION", groupId: "squad" },
      },
    }) as unknown as Item;
  world.items = [squadToken("m1"), squadToken("m2")];
  world.metadata = {
    [SCENE_METADATA_KEY]: { sceneId: "scene" },
    [SEAMUS_MINION_GROUPS_KEY]: [
      { type: "MINION", id: "squad", name: "Squad", currentStamina: 10, individualStamina: 10 },
    ],
  };
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();

  // Putting a label on one minion token must not emit a squad-wide condition update.
  world.items.push({
    id: "m1-label-slowed",
    type: "LABEL",
    attachedTo: "m1",
    metadata: {},
    text: { plainText: "Slowed" },
  } as unknown as Item);
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();

  // Deleting the fallen minion emits TOKEN_DELETED only (no spurious COMBATANT_UPDATED).
  world.items = world.items.filter((item) => item.id !== "m1" && item.attachedTo !== "m1");
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith("TOKEN_DELETED", {
    encounterId: "enc",
    instanceId: "squad-1",
    sceneId: "scene",
    tokenIds: ["m1"],
    allMissing: false,
  });
  observer.stop();
});

it("does not echo custom non-catalog conditions back after markWritten", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  world.items = [
    {
      id: "t1",
      name: "Goblin",
      type: "IMAGE",
      visible: true,
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "inst-1",
          kind: "creature",
          name: "Goblin",
          minionGroupId: null,
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Goblin",
          stamina: 12,
          staminaMaximum: 12,
          temporaryStamina: 0,
          gmOnly: true,
          statblockName: "",
          resourceId: "",
        },
      },
    } as unknown as Item,
    {
      id: "t1-label-dazed",
      type: "LABEL",
      attachedTo: "t1",
      metadata: {},
      text: { plainText: "Dazed" },
    } as unknown as Item,
  ];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();

  const resume = observer.suspendWrites();
  observer.markWritten({
    instanceId: "inst-1",
    kind: "creature",
    currentStamina: 12,
    maxStamina: 12,
    name: "Goblin",
    tokenIds: ["t1"],
    conditions: ["Dazed", "On Fire"],
  });
  resume();
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();
  observer.stop();
});

it("refreshes cached scene data before markWritten so delayed onChange events cannot revert writes while preserving unrelated external edits", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  world.items = [
    {
      id: "t1",
      name: "Goblin A",
      type: "IMAGE",
      visible: true,
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "inst-1",
          kind: "creature",
          name: "Goblin A",
          minionGroupId: null,
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Goblin A",
          stamina: 20,
          staminaMaximum: 20,
          temporaryStamina: 0,
          gmOnly: true,
          statblockName: "",
          resourceId: "",
        },
      },
    } as unknown as Item,
    {
      id: "t2",
      name: "Goblin B",
      type: "IMAGE",
      visible: true,
      scale: { x: 1, y: 1 },
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "inst-2",
          kind: "creature",
          name: "Goblin B",
          minionGroupId: null,
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Goblin B",
          stamina: 15,
          staminaMaximum: 15,
          temporaryStamina: 0,
          gmOnly: true,
          statblockName: "",
          resourceId: "",
        },
      },
    } as unknown as Item,
  ];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();

  const resume = observer.suspendWrites();
  // Simulate our write committing inst-1 to 10 AND an unrelated Owlbear edit
  // changing inst-2 to 9 while OBR.scene.items.onChange has not fired yet.
  world.items = structuredClone(world.items);
  (world.items[0]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>)["stamina"] = 10;
  (world.items[1]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>)["stamina"] = 9;
  await observer.refreshCache();
  observer.markWritten({
    instanceId: "inst-1",
    kind: "creature",
    currentStamina: 10,
    maxStamina: 20,
    name: "Goblin A",
    tokenIds: ["t1"],
  });
  resume();
  await vi.advanceTimersByTimeAsync(200);

  // inst-1 must NOT echo 20 back, and inst-2's unrelated edit MUST still be emitted.
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    "COMBATANT_UPDATED",
    expect.objectContaining({
      update: expect.objectContaining({ instanceId: "inst-2", currentStamina: 9 }),
    }),
  );
  observer.stop();
});

it("observes stamina edits made on a secondary linked token of a multi-token creature", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  const makeCreature = (id: string, stamina: number) =>
    ({
      id,
      type: "IMAGE",
      name: "Boss",
      visible: true,
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "boss-1",
          kind: "creature",
          name: "Boss",
          minionGroupId: null,
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Boss",
          stamina,
          staminaMaximum: 30,
          temporaryStamina: 0,
          gmOnly: true,
          statblockName: "",
          resourceId: "",
        },
      },
    }) as unknown as Item;

  world.items = [makeCreature("t1", 30), makeCreature("t2", 30)];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene" } };
  const emit = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost: vi.fn() });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();

  // Edit stamina on the second token while the first token still reads 30.
  world.items = [makeCreature("t1", 30), makeCreature("t2", 22)];
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);

  expect(emit).toHaveBeenCalledWith(
    "COMBATANT_UPDATED",
    expect.objectContaining({
      update: expect.objectContaining({ instanceId: "boss-1", currentStamina: 22 }),
    }),
  );

  // Subsequent unrelated map changes must not flip back to t1's old 30 value.
  emit.mockClear();
  world.onItems?.([makeCreature("t1", 30), makeCreature("t2", 22)]);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();

  // Later editing t1 itself does emit t1's new value.
  world.items = [makeCreature("t1", 18), makeCreature("t2", 22)];
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).toHaveBeenCalledWith(
    "COMBATANT_UPDATED",
    expect.objectContaining({
      update: expect.objectContaining({ instanceId: "boss-1", currentStamina: 18 }),
    }),
  );
  observer.stop();
});

it("suppresses stale TOKEN_DELETED during scene unload and preserves statblock in markWritten", async () => {
  vi.useFakeTimers();
  forgetSceneIdentity();
  world.items = [
    {
      id: "t1",
      name: "Goblin",
      type: "IMAGE",
      visible: true,
      metadata: {
        [TOKEN_METADATA_KEY]: {
          v: 1,
          encounterId: "enc",
          instanceId: "inst-1",
          kind: "creature",
          name: "Goblin",
          minionGroupId: null,
        },
        [SEAMUS_TOKEN_METADATA_KEY]: {
          type: "MONSTER",
          name: "Goblin",
          stamina: 12,
          staminaMaximum: 12,
          temporaryStamina: 0,
          gmOnly: true,
          statblockName: "Goblin Warrior",
          resourceId: "res-goblin",
        },
      },
    } as unknown as Item,
  ];
  world.metadata = { [SCENE_METADATA_KEY]: { sceneId: "scene-1" } };
  const emit = vi.fn();
  const onSceneLost = vi.fn();
  const observer = new SceneObserver({ emit, onSceneChanged: vi.fn(), onSceneLost });
  observer.setEncounter("enc");
  observer.start();
  await observer.rebaseline();

  // markWritten without statblock preserves the previously baselined statblock so no echo fires.
  const resume = observer.suspendWrites();
  observer.markWritten({
    instanceId: "inst-1",
    kind: "creature",
    currentStamina: 12,
    maxStamina: 12,
    name: "Goblin",
    tokenIds: ["t1"],
  });
  resume();
  world.onItems?.(world.items);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();

  // Scene closes -> empty items arriving while sceneReady is false must not emit TOKEN_DELETED.
  onSceneLost.mockClear();
  world.onReadyChange?.(false);
  expect(onSceneLost).toHaveBeenCalledOnce();
  world.items = [];
  world.onItems?.([]);
  await vi.advanceTimersByTimeAsync(200);
  expect(emit).not.toHaveBeenCalled();
  observer.stop();
});

it("preserves non-MINION Seamus group entries when merging raw minion groups", () => {
  const existing = [
    { type: "HERO_PARTY", id: "party-1", name: "Heroes" },
    { type: "MINION", id: "squad-1", name: "Old", currentStamina: 10, individualStamina: 5 },
    { custom: true },
  ];
  const merged = mergeRawMinionGroups({ [SEAMUS_MINION_GROUPS_KEY]: existing }, [
    {
      type: "MINION",
      id: "squad-1",
      name: "Updated",
      currentStamina: 15,
      individualStamina: 5,
      nameTagsEnabled: true,
    },
    {
      type: "MINION",
      id: "squad-2",
      name: "New",
      currentStamina: 20,
      individualStamina: 5,
      nameTagsEnabled: true,
    },
  ]);
  expect(merged).toEqual([
    { type: "HERO_PARTY", id: "party-1", name: "Heroes" },
    {
      type: "MINION",
      id: "squad-1",
      name: "Updated",
      currentStamina: 15,
      individualStamina: 5,
      nameTagsEnabled: true,
    },
    { custom: true },
    {
      type: "MINION",
      id: "squad-2",
      name: "New",
      currentStamina: 20,
      individualStamina: 5,
      nameTagsEnabled: true,
    },
  ]);
});
