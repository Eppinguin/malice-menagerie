import { beforeEach, describe, expect, it, vi } from "vitest";
import { isImage, type Item } from "@owlbear-rodeo/sdk";
import {
  SCENE_METADATA_KEY,
  SEAMUS_MINION_GROUPS_KEY,
  SEAMUS_TOKEN_METADATA_KEY,
  TOKEN_METADATA_KEY,
  validateCommand,
  validateResponse,
  type DesiredCombatant,
  type ImportRequest,
} from "../../../shared/obr/protocol.ts";
import { emptyIntegration, mergeSceneMappings, sanitizeIntegration } from "../identity.ts";

const scene = vi.hoisted(() => ({ items: [] as Item[], metadata: {} as Record<string, unknown> }));
const sdk = vi.hoisted(() => ({
  room: { id: "room-1", getMetadata: vi.fn(async () => ({})) },
  scene: {
    getMetadata: vi.fn(async () => structuredClone(scene.metadata)),
    setMetadata: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(scene.metadata, structuredClone(next));
    }),
    isReady: vi.fn(async () => true),
    onReadyChange: vi.fn((_callback: (ready: boolean) => void) => vi.fn()),
    onMetadataChange: vi.fn((_callback: (metadata: Record<string, unknown>) => void) => vi.fn()),
    grid: {
      getDpi: vi.fn(async () => 150),
      getType: vi.fn(async () => "SQUARE"),
      snapPosition: vi.fn(async (pos: { x: number; y: number }) => pos),
    },
    items: {
      getItems: vi.fn(async () => structuredClone(scene.items)),
      deleteItems: vi.fn(async (ids: string[]) => {
        scene.items = scene.items.filter((item) => !ids.includes(item.id));
      }),
      addItems: vi.fn(async (items: Item[]) => {
        scene.items.push(...structuredClone(items));
      }),
      updateItems: vi.fn(async (items: Item[] | string[], update: (drafts: Item[]) => void) => {
        const drafts = structuredClone(
          items.every((item) => typeof item === "string")
            ? scene.items.filter((item) => (items as string[]).includes(item.id))
            : (items as Item[]),
        );
        update(drafts);
        for (const item of drafts) {
          const index = scene.items.findIndex((i) => i.id === item.id);
          if (index >= 0) scene.items[index] = item;
        }
      }),
    },
  },
  player: { getColor: vi.fn(async () => "#00ff00") },
  viewport: {
    getPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    getScale: vi.fn(async () => 1),
    getWidth: vi.fn(async () => 1200),
    getHeight: vi.fn(async () => 800),
    inverseTransformPoint: vi.fn(async (point: { x: number; y: number }) => point),
  },
}));
vi.mock("@owlbear-rodeo/sdk", async () => {
  const { ImageBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/ImageBuilder.js");
  const { LabelBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/LabelBuilder.js");
  const { PathBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/PathBuilder.js");
  const { TextBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/TextBuilder.js");
  return {
    default: sdk,
    buildPath: () => new PathBuilder({ id: "gm" } as ConstructorParameters<typeof PathBuilder>[0]),
    buildText: () => new TextBuilder({ id: "gm" } as ConstructorParameters<typeof TextBuilder>[0]),
    buildLabel: () =>
      new LabelBuilder({ id: "gm" } as ConstructorParameters<typeof LabelBuilder>[0]),
    buildImage: (
      image: ConstructorParameters<typeof ImageBuilder>[1],
      grid: ConstructorParameters<typeof ImageBuilder>[2],
    ) =>
      new ImageBuilder({ id: "gm" } as ConstructorParameters<typeof ImageBuilder>[0], image, grid),
    isImage: (item: Item) => item.type === "IMAGE",
  };
});
vi.mock("../../../obr/src/tokenArtwork.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../obr/src/tokenArtwork.ts")>();
  const loadTokenArtwork = vi.fn(async () => ({
    url: "https://example.com/goblin.webp",
    width: 256,
    height: 256,
    mime: "image/webp",
  }));
  return {
    ...actual,
    isLegacyTokenImage: () => false,
    hasMappedArtwork: () => true,
    loadTokenArtwork,
    createTokenArtworkLoader: () => actual.createTokenArtworkLoader(loadTokenArtwork),
  };
});
import { cleanupInstances, importCombatants } from "../../../obr/src/importer.ts";
import {
  forgetSceneIdentity,
  sceneSummary,
  setSceneLabel,
  setTokensVisibility,
  tokenScaleForSize,
  updateTokensMetadata,
} from "../../../obr/src/scene.ts";
import { loadTokenArtwork } from "../../../obr/src/tokenArtwork.ts";
import { INITIALS_IMAGE_URL } from "../../../obr/src/placeholder.ts";
import {
  CONDITION_SYNC_STORAGE_KEY,
  TOKEN_ARTWORK_STORAGE_KEY,
} from "../../../obr/src/settings.ts";
import { applyUpdates } from "../../../obr/src/updates.ts";

function creature(index: number, count = 1): DesiredCombatant {
  return {
    instanceId: `instance-${index}`,
    entryId: `entry-${index}`,
    slot: 0,
    kind: count > 1 ? "minion-squad" : "creature",
    name: `Goblin ${index}`,
    count,
    activationGroupId: "group-1",
    activationGroupName: "Goblins",
    currentStamina: 10 * count,
    maxStamina: 10 * count,
    individualStamina: count > 1 ? 10 : null,
    statblock: null,
    minionGroupId: count > 1 ? `mm-${index}` : null,
    existingTokenIds: [],
    summoned: false,
  };
}
function request(
  combatants: DesiredCombatant[],
  mode: ImportRequest["mode"] = "import",
): ImportRequest {
  return {
    encounterId: "enc-1",
    encounterName: "Encounter",
    mode,
    combatants,
    expectedSceneId: "scene-1",
  };
}
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  forgetSceneIdentity();
  scene.items = [];
  scene.metadata = { [SCENE_METADATA_KEY]: { v: 1, sceneId: "scene-1" } };
});

describe("batched encounter import", () => {
  it.each([65, 99])(
    "keeps a %i-minion squad valid through import, persistence, and resend",
    async (count) => {
      const payload = request([creature(1, count)]);
      expect(validateCommand("IMPORT_ENCOUNTER", payload).ok).toBe(true);
      const result = await importCombatants(payload, vi.fn());
      expect(result.created).toBe(count);
      expect(result.mappings[0]?.tokenIds).toHaveLength(count);
      expect(validateResponse("IMPORT_ENCOUNTER", result).ok).toBe(true);
      expect(
        validateResponse("GET_SCENE_STATE", {
          scene: result.scene,
          mappings: result.mappings,
          minionGroups: [],
          orphanTokens: [],
        }).ok,
      ).toBe(true);
      const saved = mergeSceneMappings(
        emptyIntegration(),
        "room-1",
        "scene-1",
        result.mappings,
        "enc-1",
      );
      const restored = sanitizeIntegration(JSON.parse(JSON.stringify(saved)));
      const tokenIds = restored.encounters["enc-1"]?.scenes["scene-1"]?.mappings[0]?.tokenIds;
      expect(tokenIds).toEqual(result.mappings[0]?.tokenIds);
      const resend = request([{ ...creature(1, count), existingTokenIds: tokenIds! }]);
      expect(validateCommand("IMPORT_ENCOUNTER", resend).ok).toBe(true);
      const repeated = await importCombatants(resend, vi.fn());
      expect(repeated.created).toBe(0);
      expect(repeated.mappings[0]?.tokenIds).toEqual(tokenIds);
    },
  );

  it("creates readable initials by default without requesting TooManyTokens artwork", async () => {
    const result = await importCombatants(
      request([{ ...creature(1), name: "Goblin Warrior" }]),
      vi.fn(),
    );
    expect(result.created).toBe(1);
    const token = scene.items[0];
    expect(token?.type).toBe("IMAGE");
    if (!token || !isImage(token)) throw new Error("Expected image token");
    expect(token.image.url).toBe(INITIALS_IMAGE_URL);
    expect(token.text.plainText).toBe("GW");
    expect(token.textItemType).toBe("TEXT");
    expect(loadTokenArtwork).not.toHaveBeenCalled();
  });

  it("refreshes generated initials on rename and preserves custom text", async () => {
    await importCombatants(request([creature(1), creature(2)]), vi.fn());
    const custom = scene.items[1]!;
    if (!isImage(custom)) throw new Error("Expected image");
    custom.text.plainText = "GM text";
    await importCombatants(
      request([
        { ...creature(1), name: "Orc Warrior" },
        { ...creature(2), name: "Orc Archer" },
      ]),
      vi.fn(),
    );
    const generated = scene.items[0]!;
    if (!isImage(generated)) throw new Error("Expected image");
    expect(generated.name).toBe("Orc Warrior");
    expect(generated.text.plainText).toBe("OW");
    expect((scene.items[1] as typeof custom).text.plainText).toBe("GM text");
  });

  it("aborts when the scene changes during artwork preparation", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    vi.mocked(loadTokenArtwork).mockImplementationOnce(async () => {
      scene.metadata[SCENE_METADATA_KEY] = { v: 1, sceneId: "scene-2" };
      return { url: "https://example.com/art.png", width: 72, height: 72, mime: "image/png" };
    });
    await expect(importCombatants(request([creature(1, 2)]), vi.fn())).rejects.toThrow(
      "scene changed",
    );
    expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
    expect(sdk.scene.onReadyChange.mock.results[0]?.value).toHaveBeenCalled();
    expect(sdk.scene.onMetadataChange.mock.results[0]?.value).toHaveBeenCalled();
  });

  it("stops later batches after a scene transition", async () => {
    sdk.scene.items.addItems.mockImplementationOnce(async (items) => {
      scene.items.push(...structuredClone(items));
      sdk.scene.onReadyChange.mock.calls[0]![0](false);
      sdk.scene.onReadyChange.mock.calls[0]![0](true);
    });
    await expect(importCombatants(request([creature(1, 60)]), vi.fn())).rejects.toThrow(
      "scene changed",
    );
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(1);
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  });

  it("checks the scene again before retrying a throttled batch", async () => {
    vi.useFakeTimers();
    sdk.scene.items.addItems.mockImplementationOnce(async () => {
      scene.metadata[SCENE_METADATA_KEY] = { v: 1, sceneId: "scene-2" };
      throw new Error("Too many requests");
    });
    const pending = expect(importCombatants(request([creature(1)]), vi.fn())).rejects.toThrow(
      "scene changed",
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(1);
  });

  it("preserves intervening edits to unrelated minion groups", async () => {
    const other = {
      type: "MINION",
      id: "other",
      name: "Other",
      currentStamina: 20,
      individualStamina: 5,
    };
    scene.metadata[SEAMUS_MINION_GROUPS_KEY] = [other];
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    vi.mocked(loadTokenArtwork).mockImplementationOnce(async () => {
      other.currentStamina = 7;
      return { url: "https://example.com/art.png", width: 72, height: 72, mime: "image/png" };
    });
    await importCombatants(request([creature(1, 2)]), vi.fn());
    expect(scene.metadata[SEAMUS_MINION_GROUPS_KEY]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "other", currentStamina: 7 })]),
    );
  });

  it("reads the saved opt-in in the background and uses mapped artwork", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === TOKEN_ARTWORK_STORAGE_KEY ? "true" : null),
    });
    await importCombatants(request([creature(1)]), vi.fn());
    const token = scene.items[0];
    if (!token || !isImage(token)) throw new Error("Expected image token");
    expect(token.image.url).toBe("https://example.com/goblin.webp");
    expect(token.text.plainText).toBe("");
    expect(loadTokenArtwork).toHaveBeenCalledTimes(1);
  });

  it("still creates a token with initials when opted-in artwork cannot load", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    vi.mocked(loadTokenArtwork).mockRejectedValueOnce(new Error("Offline"));
    const result = await importCombatants(
      request([{ ...creature(1), name: "Goblin Warrior" }]),
      vi.fn(),
    );
    expect(result.created).toBe(1);
    expect(result.missing).toEqual([]);
    const token = scene.items[0];
    if (!token || !isImage(token)) throw new Error("Expected image token");
    expect(token.text.plainText).toBe("GW");
  });

  it("falls back for a whole squad after one artwork failure and retries on a later send", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    vi.mocked(loadTokenArtwork).mockRejectedValueOnce(new Error("Artwork request timed out"));
    const result = await importCombatants(request([creature(1, 13), creature(2)]), vi.fn());
    expect(result.created).toBe(14);
    expect(result.missing).toEqual([]);
    expect(loadTokenArtwork).toHaveBeenCalledTimes(1);
    expect(
      scene.items.every((item) => isImage(item) && item.image.url === INITIALS_IMAGE_URL),
    ).toBe(true);

    await importCombatants(request([creature(3)]), vi.fn());
    expect(loadTokenArtwork).toHaveBeenCalledTimes(2);
    const last = scene.items.at(-1)!;
    expect(isImage(last) && last.image.url).toBe("https://example.com/goblin.webp");
  });

  it.each([
    "http://localhost:5174/src/assets/token-initials.svg?no-inline",
    "http://127.0.0.1:5189/assets/token-initials-DCQlqvsf.svg",
  ])("repairs an existing blocked initials image on resend: %s", async (url) => {
    const roster = [{ ...creature(1), name: "Goblin Warrior" }];
    await importCombatants(request(roster), vi.fn());
    const token = scene.items[0];
    if (!token || !isImage(token)) throw new Error("Expected image token");
    token.image = { url, width: 256, height: 256, mime: "image/svg+xml" };
    token.grid.dpi = 256;
    const id = token.id;
    // Enabling artwork must not replace an existing initials token with a portrait.
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    const result = await importCombatants(request(roster), vi.fn());
    const repaired = scene.items[0];
    if (!repaired || !isImage(repaired)) throw new Error("Expected image token");
    expect(result.created).toBe(0);
    expect(repaired.id).toBe(id);
    expect(repaired.image.url).toBe(INITIALS_IMAGE_URL);
    expect(repaired.grid.dpi).toBe(72);
    expect(repaired.text.plainText).toBe("GW");
    expect(loadTokenArtwork).not.toHaveBeenCalled();
  });

  it("sends 120 creatures with three add requests, one placement snapshot, and no redundant updates", async () => {
    const roster = Array.from({ length: 120 }, (_, i) => creature(i));
    const result = await importCombatants(request(roster), vi.fn());
    expect(result.created).toBe(120);
    expect(result.missing).toEqual([]);
    expect(result.mappings).toHaveLength(120);
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(3);
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    expect(sdk.scene.items.getItems).toHaveBeenCalledTimes(3);
    expect(sdk.viewport.inverseTransformPoint).toHaveBeenCalledTimes(1);
    expect(new Set(scene.items.map((item) => `${item.position.x},${item.position.y}`)).size).toBe(
      120,
    );
    expect(scene.items[0]?.metadata[SEAMUS_TOKEN_METADATA_KEY]).toMatchObject({
      type: "MONSTER",
      stamina: 10,
    });
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  });

  it("writes multiple minion squads in batches and preserves other encounters' groups", async () => {
    const other = {
      type: "MINION",
      id: "other-group",
      name: "Other encounter",
      currentStamina: 20,
      individualStamina: 5,
    };
    scene.metadata[SEAMUS_MINION_GROUPS_KEY] = [other];
    const result = await importCombatants(request([creature(1, 40), creature(2, 40)]), vi.fn());
    expect(result.created).toBe(80);
    expect(result.mappings.map((m) => m.tokenIds.length)).toEqual([40, 40]);
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(2);
    expect(sdk.scene.setMetadata).toHaveBeenCalledTimes(1);
    expect(scene.metadata[SEAMUS_MINION_GROUPS_KEY]).toEqual(expect.arrayContaining([other]));
  });

  it("does not create duplicates or write unchanged tokens on a repeat send", async () => {
    const roster = Array.from({ length: 60 }, (_, i) => creature(i));
    await importCombatants(request(roster), vi.fn());
    const ids = scene.items.map((i) => i.id);
    vi.clearAllMocks();
    const result = await importCombatants(request(roster, "add"), vi.fn());
    expect(result.created).toBe(0);
    expect(scene.items.map((i) => i.id)).toEqual(ids);
    expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  });

  it("updates linked creatures in batches while keeping custom names, art, and temporary Stamina", async () => {
    const roster = Array.from({ length: 60 }, (_, i) => creature(i));
    await importCombatants(request(roster), vi.fn());
    scene.items[0]!.name = "GM name";
    (
      scene.items[0]!.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>
    ).temporaryStamina = 7;
    const art = structuredClone((scene.items[0] as { image?: unknown }).image);
    vi.clearAllMocks();
    const result = await importCombatants(
      request(
        roster.map((c) => ({ ...c, currentStamina: 4 })),
        "reconcile",
      ),
      vi.fn(),
    );
    expect(result.created).toBe(0);
    expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(2);
    expect(scene.items[0]?.name).toBe("GM name");
    expect(scene.items[0]?.metadata[SEAMUS_TOKEN_METADATA_KEY]).toMatchObject({
      stamina: 4,
      temporaryStamina: 7,
    });
    expect((scene.items[0] as { image?: unknown }).image).toEqual(art);
  });

  it("recovers from a rate limit in the same send using the same token ids", async () => {
    vi.useFakeTimers();
    sdk.scene.items.addItems.mockRejectedValueOnce("Too many requests");
    const pending = importCombatants(request([creature(1, 8)]), vi.fn());
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.created).toBe(8);
    expect(result.warnings).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(2);
    expect(sdk.scene.items.addItems.mock.calls[0]?.[0].map((i) => i.id)).toEqual(
      sdk.scene.items.addItems.mock.calls[1]?.[0].map((i) => i.id),
    );
    expect(new Set(scene.items.map((i) => i.id)).size).toBe(8);
  });

  it("retries a throttled update without recreating tokens", async () => {
    const roster = [creature(1), creature(2)];
    await importCombatants(request(roster), vi.fn());
    vi.clearAllMocks();
    vi.useFakeTimers();
    sdk.scene.items.updateItems.mockRejectedValueOnce({ error: "Too many requests" });
    const pending = importCombatants(
      request(
        roster.map((c) => ({ ...c, currentStamina: 5 })),
        "reconcile",
      ),
      vi.fn(),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.missing).toEqual([]);
    expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
    expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(2);
    expect(scene.items).toHaveLength(2);
  });

  it("does not create missing tokens during reconcile", async () => {
    const result = await importCombatants(
      request([creature(1), creature(2, 4)], "reconcile"),
      vi.fn(),
    );
    expect(result.created).toBe(0);
    expect(result.missing).toHaveLength(2);
    expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
  });

  it("reports an unrecoverable batch error without claiming the tokens were created", async () => {
    sdk.scene.items.addItems.mockRejectedValueOnce("Invalid item metadata");
    const result = await importCombatants(request([creature(1), creature(2)]), vi.fn());
    expect(result.created).toBe(0);
    expect(result.createdInstanceIds).toEqual([]);
    expect(result.missing).toHaveLength(2);
    expect(result.warnings).toContain("Invalid item metadata");
    expect(sdk.scene.items.addItems).toHaveBeenCalledTimes(1);
  });

  it("batches automatic Stamina updates too", async () => {
    const roster = Array.from({ length: 60 }, (_, i) => creature(i));
    await importCombatants(request(roster), vi.fn());
    vi.clearAllMocks();
    await applyUpdates(
      "enc-1",
      roster.map((c) => ({
        instanceId: c.instanceId,
        currentStamina: 3,
        maxStamina: 10,
        name: c.name,
        activationGroupId: c.activationGroupId,
        activationGroupName: c.activationGroupName,
        statblock: null,
        revision: 1,
      })),
      "scene-1",
    );
    expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(2);
    expect(
      scene.items.every(
        (i) => (i.metadata[SEAMUS_TOKEN_METADATA_KEY] as Record<string, unknown>).stamina === 3,
      ),
    ).toBe(true);
    expect(scene.items.every((i) => i.metadata[TOKEN_METADATA_KEY])).toBe(true);
  });
});

it("imports condition labels and syncs their removal without a Stamina change", async () => {
  const combatant = { ...creature(1), conditions: ["Dazed"] };
  const imported = await importCombatants(request([combatant]), vi.fn());
  expect(imported.mappings[0]?.conditions).toEqual(["Dazed"]);
  expect(scene.items.filter((item) => item.type === "LABEL")).toHaveLength(1);
  await applyUpdates(
    "enc-1",
    [
      {
        instanceId: combatant.instanceId,
        currentStamina: 10,
        maxStamina: 10,
        name: combatant.name,
        activationGroupId: "group-1",
        activationGroupName: "Goblins",
        statblock: null,
        revision: 1,
        conditions: [],
      },
    ],
    "scene-1",
  );
  expect(scene.items.filter((item) => item.type === "LABEL")).toHaveLength(0);
  expect(scene.items.filter((item) => item.type === "IMAGE")).toHaveLength(1);
});

it("imports and clears native Marked conditions when the room is configured for Marked", async () => {
  const markedRoom = {
    "com.battle-system.mark/m": { s: { l: [], g: [], d: "36", o: "85", s: "4" } },
  };
  sdk.room.getMetadata.mockResolvedValueOnce(markedRoom);
  const combatant = { ...creature(1), conditions: ["Dazed"] };
  const imported = await importCombatants(request([combatant]), vi.fn());
  expect(imported.mappings[0]?.conditions).toEqual(["Dazed"]);
  expect(scene.items.filter((item) => item.type === "PATH")).toHaveLength(1);
  expect(scene.items.filter((item) => item.type === "TEXT")).toHaveLength(1);
  expect(scene.items.some((item) => item.type === "LABEL")).toBe(false);
  sdk.room.getMetadata.mockResolvedValueOnce(markedRoom);
  await applyUpdates(
    "enc-1",
    [
      {
        instanceId: combatant.instanceId,
        currentStamina: 10,
        maxStamina: 10,
        name: combatant.name,
        activationGroupId: "group-1",
        activationGroupName: "Goblins",
        statblock: null,
        revision: 1,
        conditions: [],
      },
    ],
    "scene-1",
  );
  expect(scene.items).toHaveLength(1);
  expect(scene.items[0]?.type).toBe("IMAGE");
});

it("reports only combatants whose tokens were present for the update", async () => {
  const present = creature(1);
  const deleted = creature(2);
  const imported = await importCombatants(request([present, deleted]), vi.fn());
  const deletedMapping = imported.mappings.find((entry) => entry.instanceId === deleted.instanceId);
  await sdk.scene.items.deleteItems(deletedMapping!.tokenIds);

  const result = await applyUpdates(
    "enc-1",
    [present, deleted].map((entry) => ({ ...entry, currentStamina: 3, revision: 1 })),
    "scene-1",
  );

  expect(result.applied.map((entry) => entry.instanceId)).toEqual([present.instanceId]);
  expect(result.warnings).toEqual([`${deleted.name}: no token in this scene.`]);
  expect(scene.items[0]?.metadata[SEAMUS_TOKEN_METADATA_KEY]).toMatchObject({ stamina: 3 });
});

it("rejects a queued update when the active scene has changed without writing anything", async () => {
  await importCombatants(request([creature(1)]), vi.fn());
  // Both scenes can have matching encounter and instance IDs.
  scene.metadata[SCENE_METADATA_KEY] = { v: 1, sceneId: "scene-2" };
  forgetSceneIdentity();
  vi.clearAllMocks();
  await expect(applyUpdates("enc-1", [{ ...creature(1), revision: 1 }], "scene-1")).rejects.toThrow(
    "scene changed",
  );
  expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
  expect(sdk.scene.items.addItems).not.toHaveBeenCalled();
  expect(sdk.scene.items.deleteItems).not.toHaveBeenCalled();
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
});

it("merges only requested squad fields into fresh metadata on every retry", async () => {
  await importCombatants(request([creature(1, 2), creature(2, 2)]), vi.fn());
  const groups = () => scene.metadata[SEAMUS_MINION_GROUPS_KEY] as Record<string, unknown>[];
  const other = structuredClone(groups()[1]!);
  other.id = "added-during-update";
  sdk.scene.items.updateItems.mockImplementationOnce(async () => {
    groups()[0]!.nameTagsEnabled = false;
    groups()[0]!.gmOnly = false;
    groups()[0]!.resourceId = "new-reference";
    groups()[0]!.custom = "keep";
    groups()[1]!.currentStamina = 7;
    groups().push(other);
  });
  sdk.scene.setMetadata.mockImplementationOnce(async () => {
    groups()[1]!.currentStamina = 4;
    groups()[0]!.custom = "edited-during-retry";
    throw new Error("Too many requests");
  });
  vi.useFakeTimers();
  try {
    const pending = applyUpdates(
      "enc-1",
      [{ ...creature(1, 2), name: "Renamed", currentStamina: 3, statblock: null, revision: 1 }],
      "scene-1",
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(groups()[0]).toMatchObject({
      name: "Renamed",
      currentStamina: 3,
      nameTagsEnabled: false,
      gmOnly: false,
      resourceId: "new-reference",
      custom: "edited-during-retry",
    });
    expect(groups()[1]!.currentStamina).toBe(4);
    expect(groups()[2]).toEqual(other);
  } finally {
    vi.useRealTimers();
  }
});

it("guards combatant writes after a scene transition during a throttled batch", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  vi.clearAllMocks();
  sdk.scene.items.updateItems.mockImplementationOnce(async () => {
    scene.metadata[SCENE_METADATA_KEY] = { sceneId: "scene-2" };
    throw new Error("Too many requests");
  });
  vi.useFakeTimers();
  try {
    const pending = expect(
      applyUpdates("enc-1", [{ ...creature(1, 2), name: "Renamed", revision: 1 }], "scene-1"),
    ).rejects.toThrow("scene changed");
    await vi.runAllTimersAsync();
    await pending;
    expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(1);
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])(
  "preserves a GM rename made after preparation (retry: %s)",
  async (retry) => {
    await importCombatants(request([creature(1)]), vi.fn());
    const snapshot = structuredClone(scene.items[0]!);
    const rename = () => {
      scene.items[0]!.name = "GM custom name";
      (scene.items[0]!.metadata as Record<string, unknown>)["gm"] = "keep";
    };
    if (retry) {
      vi.useFakeTimers();
      sdk.scene.items.updateItems.mockImplementationOnce(async () => {
        rename();
        throw new Error("Too many requests");
      });
    }
    try {
      const pending = updateTokensMetadata(
        [
          {
            item: snapshot,
            desiredName: "Orc Warrior",
            metadata: {
              [TOKEN_METADATA_KEY]: {
                ...(snapshot.metadata[TOKEN_METADATA_KEY] as object),
                name: "Orc Warrior",
              },
            },
          },
        ],
        async () => {
          if (!retry) rename();
        },
      );
      if (retry) await vi.runAllTimersAsync();
      await pending;
      expect(scene.items[0]!.name).toBe("GM custom name");
      expect(scene.items[0]!.metadata["gm"]).toBe("keep");
      expect(scene.items[0]!.metadata[TOKEN_METADATA_KEY]).toMatchObject({ name: "Orc Warrior" });
      const updated = scene.items[0]!;
      if (!isImage(updated)) throw new Error("Expected image");
      expect(updated.text.plainText).toBe("G1");
    } finally {
      vi.useRealTimers();
    }
  },
);

it("cleans up only the requested instances and their groups", async () => {
  await importCombatants(request([creature(1, 3), creature(2, 2)]), vi.fn());
  const result = await cleanupInstances("enc-1", ["instance-1"], "scene-1");
  expect(result).toEqual({ deleted: 3, groupIds: ["mm-1"] });
  expect(scene.items).toHaveLength(2);
  expect(scene.metadata[SEAMUS_MINION_GROUPS_KEY]).toMatchObject([{ id: "mm-2" }]);
  expect(sdk.scene.onReadyChange.mock.results.at(-1)?.value).toHaveBeenCalled();
});

it("rejects cleanup requested for a different scene before deleting tokens", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  await expect(cleanupInstances("enc-1", ["instance-1"], "old-scene")).rejects.toThrow(
    "scene changed",
  );
  expect(sdk.scene.items.deleteItems).not.toHaveBeenCalled();
});

it("does not remove a new scene's groups after token deletion changes scenes", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  const nextMetadata = {
    ...structuredClone(scene.metadata),
    [SCENE_METADATA_KEY]: { sceneId: "scene-2" },
  };
  sdk.scene.items.deleteItems.mockImplementationOnce(async () => {
    scene.metadata = structuredClone(nextMetadata);
  });
  sdk.scene.setMetadata.mockClear();
  await expect(cleanupInstances("enc-1", ["instance-1"], "scene-1")).rejects.toThrow(
    "scene changed",
  );
  expect(scene.metadata).toEqual(nextMetadata);
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
});

it.each(["tokens", "groups"])(
  "revalidates cleanup before retrying throttled %s deletion",
  async (stage) => {
    await importCombatants(request([creature(1, 2)]), vi.fn());
    const write = stage === "tokens" ? sdk.scene.items.deleteItems : sdk.scene.setMetadata;
    write.mockClear();
    write.mockImplementationOnce(async () => {
      scene.metadata = { ...scene.metadata, [SCENE_METADATA_KEY]: { sceneId: "scene-2" } };
      throw new Error("Too many requests");
    });
    vi.useFakeTimers();
    try {
      const pending = expect(cleanupInstances("enc-1", ["instance-1"], "scene-1")).rejects.toThrow(
        "scene changed",
      );
      await vi.runAllTimersAsync();
      await pending;
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("checks the scene again after reading cleanup group metadata", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  sdk.scene.items.deleteItems.mockImplementationOnce(async () => {
    // First read validates the scene, the second prepares the group update.
    sdk.scene.getMetadata.mockImplementationOnce(async () => structuredClone(scene.metadata));
    sdk.scene.getMetadata.mockImplementationOnce(async () => {
      scene.metadata = { ...scene.metadata, [SCENE_METADATA_KEY]: { sceneId: "scene-2" } };
      return structuredClone(scene.metadata);
    });
  });
  sdk.scene.setMetadata.mockClear();
  await expect(cleanupInstances("enc-1", ["instance-1"], "scene-1")).rejects.toThrow(
    "scene changed",
  );
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
});

it("stops cleanup when a scene transition returns to the original scene", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  sdk.scene.items.deleteItems.mockImplementationOnce(async () => {
    const onReady = sdk.scene.onReadyChange.mock.calls.at(-1)![0];
    onReady(false);
    onReady(true);
  });
  sdk.scene.setMetadata.mockClear();
  await expect(cleanupInstances("enc-1", ["instance-1"], "scene-1")).rejects.toThrow(
    "scene changed",
  );
  expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  expect(sdk.scene.onReadyChange.mock.results.at(-1)?.value).toHaveBeenCalled();
  expect(sdk.scene.onMetadataChange.mock.results.at(-1)?.value).toHaveBeenCalled();
});

it("does not overwrite legacy token art during Stamina updates without sourcePath", async () => {
  await importCombatants(request([creature(1)]), vi.fn());
  const token = scene.items[0]!;
  if (!isImage(token)) throw new Error("Expected image");
  token.image = {
    url: "https://example.com/token.png",
    width: 128,
    height: 128,
    mime: "image/png",
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === TOKEN_ARTWORK_STORAGE_KEY ? "true" : null),
  });
  vi.clearAllMocks();
  await applyUpdates("enc-1", [{ ...creature(1), currentStamina: 4, revision: 1 }], "scene-1");
  expect(loadTokenArtwork).not.toHaveBeenCalled();
  expect((scene.items[0] as typeof token).image.url).toBe("https://example.com/token.png");
});

it("skips condition label writes and omits conditions from mappings when condition sync is off", async () => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === CONDITION_SYNC_STORAGE_KEY ? "off" : null),
  });
  const imported = await importCombatants(
    request([{ ...creature(1), conditions: ["Dazed"] }]),
    vi.fn(),
  );
  expect(scene.items.some((item) => item.type === "LABEL")).toBe(false);
  expect(imported.mappings[0]?.conditions).toBeUndefined();
});

it("centers token grid.offset, scales Draw Steel sizes, and reserves multi-cell footprints", async () => {
  expect(tokenScaleForSize("1T")).toEqual({ scale: 0.7, cells: 1 });
  expect(tokenScaleForSize("1S")).toEqual({ scale: 0.85, cells: 1 });
  expect(tokenScaleForSize("1M")).toEqual({ scale: 1, cells: 1 });
  expect(tokenScaleForSize("1L")).toEqual({ scale: 1, cells: 1 });
  expect(tokenScaleForSize("2")).toEqual({ scale: 2, cells: 2 });
  expect(tokenScaleForSize("3")).toEqual({ scale: 3, cells: 3 });

  const dragon = { ...creature(1), name: "Adult Dragon", size: "3" };
  const goblin = { ...creature(2), name: "Goblin Sniper", size: "1S" };
  await importCombatants(request([dragon, goblin]), vi.fn());
  const dragonToken = scene.items[0]!;
  const goblinToken = scene.items[1]!;
  if (!isImage(dragonToken) || !isImage(goblinToken)) throw new Error("Expected image tokens");

  expect(dragonToken.grid.offset).toEqual({
    x: dragonToken.image.width / 2,
    y: dragonToken.image.height / 2,
  });
  expect(dragonToken.scale).toEqual({ x: 3, y: 3 });
  expect(goblinToken.scale).toEqual({ x: 0.85, y: 0.85 });

  // The 1×1 goblin must not overlap the 3×3 dragon's bounding box (450×450 at 150 dpi).
  const halfDragon = (3 * 150) / 2;
  const halfGoblin = 150 / 2;
  const dx = Math.abs(goblinToken.position.x - dragonToken.position.x);
  const dy = Math.abs(goblinToken.position.y - dragonToken.position.y);
  expect(dx >= halfDragon + halfGoblin || dy >= halfDragon + halfGoblin).toBe(true);
});

it("stores and resets a custom scene nickname in scene metadata", async () => {
  const renamed = await setSceneLabel("scene-1", "Goblin Ambush");
  expect(renamed.label).toBe("Goblin Ambush");
  expect((await sceneSummary()).label).toBe("Goblin Ambush");

  const reset = await setSceneLabel("scene-1", "   ");
  expect(reset.label).toBe("Owlbear scene cene-1");
});

it("numbers newly spawned minion squad tokens and fills deleted slot numbers on resend", async () => {
  const squad = { ...creature(1, 3), name: "Goblin Spinecleaver" };
  await importCombatants(request([squad]), vi.fn());
  const names = scene.items.map((item) => item.name);
  expect(names).toEqual([
    "Goblin Spinecleaver 1",
    "Goblin Spinecleaver 2",
    "Goblin Spinecleaver 3",
  ]);
  expect(scene.items.map((item) => (isImage(item) ? item.text.plainText : ""))).toEqual([
    "G1",
    "G2",
    "G3",
  ]);
  // Delete minion #2 and resend: only slot #2 is recreated.
  const secondId = scene.items[1]!.id;
  await sdk.scene.items.deleteItems([secondId]);
  await importCombatants(request([squad], "add"), vi.fn());
  expect(scene.items.map((item) => item.name).sort()).toEqual([
    "Goblin Spinecleaver 1",
    "Goblin Spinecleaver 2",
    "Goblin Spinecleaver 3",
  ]);
});

it("spawns hidden tokens when requested and toggles visibility on tokens and attachments", async () => {
  const combatant = { ...creature(1), conditions: ["Dazed"] };
  const imported = await importCombatants({ ...request([combatant]), hidden: true }, vi.fn());
  expect(imported.mappings[0]?.visible).toBe(false);
  expect(scene.items.every((item) => item.visible === false)).toBe(true);

  await setTokensVisibility("enc-1", combatant.instanceId, true, "scene-1");
  expect(scene.items.every((item) => item.visible === true)).toBe(true);

  await setTokensVisibility("enc-1", combatant.instanceId, false, "scene-1");
  expect(scene.items.every((item) => item.visible === false)).toBe(true);
});

it("deletes attached descendants (rings, labels, Marked! nested items) during cleanup", async () => {
  const combatant = { ...creature(1), conditions: ["Dazed"] };
  await importCombatants(request([combatant]), vi.fn());
  const tokenId = scene.items.find((item) => item.type === "IMAGE")!.id;
  scene.items.push(
    { id: "ring-1", type: "SHAPE", attachedTo: tokenId, metadata: {} } as unknown as Item,
    { id: "mark-root", type: "PATH", attachedTo: tokenId, metadata: {} } as unknown as Item,
    { id: "mark-counter", type: "TEXT", attachedTo: "mark-root", metadata: {} } as unknown as Item,
  );
  const result = await cleanupInstances("enc-1", [combatant.instanceId], "scene-1");
  expect(result.deleted).toBe(1);
  expect(scene.items).toEqual([]);
});

it("spawns and recovers only standing minions, and retires empty defeated squad groups", async () => {
  const squad = {
    ...creature(1, 4),
    name: "Goblin Spinecleaver",
    currentStamina: 40,
    maxStamina: 40,
    individualStamina: 10,
  };
  await importCombatants(request([squad]), vi.fn());
  expect(scene.items).toHaveLength(4);

  // Two minions die (18/40 => 2 standing) and the GM removes slots #1 and #3.
  const removed = scene.items
    .filter((item) => item.name.endsWith(" 1") || item.name.endsWith(" 3"))
    .map((item) => item.id);
  await sdk.scene.items.deleteItems(removed);
  const damaged = { ...squad, currentStamina: 18 };
  const afterDamage = await importCombatants(request([damaged], "add"), vi.fn());
  expect(afterDamage.created).toBe(0);
  expect(afterDamage.warnings).toEqual([]);
  expect(scene.items.map((item) => item.name).sort()).toEqual([
    "Goblin Spinecleaver 2",
    "Goblin Spinecleaver 4",
  ]);

  // Healing back to 3 standing (25/40) recreates only one missing minion (slot #1).
  const healed = await importCombatants(
    request([{ ...squad, currentStamina: 25 }], "add"),
    vi.fn(),
  );
  expect(healed.created).toBe(1);
  expect(scene.items.map((item) => item.name).sort()).toEqual([
    "Goblin Spinecleaver 1",
    "Goblin Spinecleaver 2",
    "Goblin Spinecleaver 4",
  ]);

  // Deleting all tokens of a defeated squad never respawns them and retires its empty group.
  await sdk.scene.items.deleteItems(scene.items.map((item) => item.id));
  const wiped = await importCombatants(request([{ ...squad, currentStamina: 0 }], "add"), vi.fn());
  expect(wiped.created).toBe(0);
  expect(wiped.missing).toEqual([]);
  expect(scene.items).toEqual([]);
  expect(scene.metadata[SEAMUS_MINION_GROUPS_KEY]).toEqual([]);
});

it("renames numbered minion squad tokens and initials while preserving GM renames", async () => {
  const squad = { ...creature(1, 3), name: "Goblin Spinecleaver" };
  await importCombatants(request([squad]), vi.fn());
  scene.items[1]!.name = "Snaggles";
  const third = scene.items[2]!;
  if (!isImage(third)) throw new Error("Expected image");
  third.text.plainText = "GM";

  await applyUpdates("enc-1", [{ ...squad, name: "Orc Ambushers", revision: 1 }], "scene-1");
  expect(scene.items.map((item) => item.name)).toEqual([
    "Orc Ambushers 1",
    "Snaggles",
    "Orc Ambushers 3",
  ]);
  expect(scene.items.map((item) => (isImage(item) ? item.text.plainText : ""))).toEqual([
    "O1",
    "G2",
    "GM",
  ]);
});

it("skips condition label writes and deletions for minion squads", async () => {
  const squad = { ...creature(1, 2), name: "Goblin Spinecleaver", conditions: ["Slowed"] };
  const imported = await importCombatants(request([squad]), vi.fn());
  expect(imported.mappings[0]?.conditions).toBeUndefined();
  expect(scene.items.filter((item) => item.type === "LABEL")).toHaveLength(0);

  // A GM places a per-minion condition label on minion #1; Malice updates must leave it intact.
  const firstId = scene.items[0]!.id;
  scene.items.push({
    id: `${firstId}-label-dazed`,
    type: "LABEL",
    attachedTo: firstId,
    metadata: {},
    text: { plainText: "Dazed" },
  } as unknown as Item);
  await applyUpdates(
    "enc-1",
    [{ ...squad, currentStamina: 15, conditions: [], revision: 1 }],
    "scene-1",
  );
  expect(scene.items.filter((item) => item.type === "LABEL")).toHaveLength(1);
});

it("repairs legacy broken token.png and data: URLs to initials even when TooManyTokens artwork is off", async () => {
  await importCombatants(request([creature(1)]), vi.fn());
  const first = scene.items[0]!;
  if (!isImage(first)) throw new Error("Expected image");
  first.image.url = "https://old-host.example/token.png";
  first.text.plainText = "";

  await importCombatants(request([creature(1)], "reconcile"), vi.fn());
  const repaired = scene.items[0]!;
  if (!isImage(repaired)) throw new Error("Expected image");
  expect(repaired.image.url).toBe(INITIALS_IMAGE_URL);
  expect(repaired.text.plainText).toBe("G1");

  repaired.image.url = "data:image/png;base64,AAAA";
  await importCombatants(request([creature(1)], "reconcile"), vi.fn());
  const repairedData = scene.items[0]!;
  if (!isImage(repairedData)) throw new Error("Expected image");
  expect(repairedData.image.url).toBe(INITIALS_IMAGE_URL);
});

it("keeps a Seamus minion group during cleanup if another surviving token still references it", async () => {
  await importCombatants(request([creature(1, 2)]), vi.fn());
  const groupId = (scene.metadata[SEAMUS_MINION_GROUPS_KEY] as { id: string }[])[0]!.id;
  // Add an independent token referencing the same Seamus minion group.
  scene.items.push({
    ...structuredClone(scene.items[0]!),
    id: "manual-minion",
    metadata: { [SEAMUS_TOKEN_METADATA_KEY]: { type: "MINION", groupId } },
  });

  await cleanupInstances("enc-1", ["instance-1"], "scene-1");
  expect(scene.items.map((item) => item.id)).toEqual(["manual-minion"]);
  expect(scene.metadata[SEAMUS_MINION_GROUPS_KEY]).toEqual([
    expect.objectContaining({ id: groupId }),
  ]);
});

it("scopes setTokensVisibility to managed overlays and leaves unrelated hidden GM attachments untouched", async () => {
  const combatant = { ...creature(1), conditions: ["Dazed"] };
  await importCombatants({ ...request([combatant]), hidden: true }, vi.fn());
  const tokenId = scene.items.find((item) => item.type === "IMAGE")!.id;
  // Add an unrelated hidden GM note attached to the token.
  scene.items.push({
    id: "gm-secret-note",
    type: "TEXT",
    attachedTo: tokenId,
    visible: false,
    metadata: {},
  } as unknown as Item);

  await setTokensVisibility("enc-1", combatant.instanceId, true, "scene-1");
  expect(scene.items.find((item) => item.id === tokenId)?.visible).toBe(true);
  expect(scene.items.find((item) => item.type === "LABEL")?.visible).toBe(true);
  // The unrelated GM note must stay hidden when revealing the token.
  expect(scene.items.find((item) => item.id === "gm-secret-note")?.visible).toBe(false);
});

it("snaps placements on hex grids and deduplicates overlapping snapped centers", async () => {
  sdk.scene.grid.getType.mockResolvedValueOnce("HEX_VERTICAL");
  // Simulate first two spiral cells snapping to the same hex center, third to a distinct hex.
  sdk.scene.grid.snapPosition
    .mockResolvedValueOnce({ x: 600, y: 400 })
    .mockResolvedValueOnce({ x: 600, y: 400 })
    .mockResolvedValueOnce({ x: 750, y: 400 });

  await importCombatants(request([creature(1), creature(2)]), vi.fn());
  const positions = scene.items
    .filter((item) => item.type === "IMAGE")
    .map((item) => item.position);
  expect(positions).toEqual([
    { x: 600, y: 400 },
    { x: 750, y: 400 },
  ]);
});
