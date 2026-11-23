import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Image, Item, Metadata, Text } from "@owlbear-rodeo/sdk";

const world = vi.hoisted(() => ({ items: [] as Item[] }));
const sdk = vi.hoisted(() => ({
  addItems: vi.fn(async (items: Item[]) => {
    world.items.push(...structuredClone(items));
  }),
  deleteItems: vi.fn(async (ids: string[]) => {
    world.items = world.items.filter((item) => !ids.includes(item.id));
  }),
  getColor: vi.fn(async () => "#00ff00"),
}));
vi.mock("@owlbear-rodeo/sdk", async () => {
  const { PathBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/PathBuilder.js");
  const { TextBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/TextBuilder.js");
  const { LabelBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/LabelBuilder.js");
  return {
    default: { scene: { items: sdk }, player: { getColor: sdk.getColor } },
    buildPath: () => new PathBuilder({ id: "gm" } as ConstructorParameters<typeof PathBuilder>[0]),
    buildText: () => new TextBuilder({ id: "gm" } as ConstructorParameters<typeof TextBuilder>[0]),
    buildLabel: () =>
      new LabelBuilder({ id: "gm" } as ConstructorParameters<typeof LabelBuilder>[0]),
  };
});
import {
  MARKED_CONFIG_KEY,
  MARKED_LEGACY_CONFIG_KEY,
  MARKED_NAMESPACE,
  isMarkedRoot,
  readMarkedConditions,
  readMarkedConfig,
  syncMarkedConditions,
} from "../../../obr/src/marked.ts";
import { readLabelConditions, syncConditionLabels } from "../../../obr/src/conditionLabels.ts";

const token = {
  id: "token",
  type: "IMAGE",
  visible: true,
  position: { x: 300, y: 300 },
  scale: { x: 1, y: 1 },
  image: { width: 150, height: 150 },
  grid: { dpi: 150, offset: { x: 75, y: 75 } },
} as Image;
const metadata: Metadata = {
  [MARKED_CONFIG_KEY]: {
    s: {
      g: [{ n: "#1", ts: "24", bo: "70", os: "2" }],
      l: [{ i: "dazed", n: "Dazed 😵‍💫", d: "Right", c: "#ffaa00", g: "#1", a: 1, k: 0 }],
      d: "36",
      o: "85",
      s: "4",
    },
  },
};
const target = [{ tokenIds: ["token"], conditions: ["Dazed"] }];
function root(name: string, id = "root", attachedTo = "token", direction = 601, place = 0): Item {
  return {
    id,
    type: "PATH",
    name,
    attachedTo,
    metadata: {
      [`${MARKED_NAMESPACE}/direction`]: direction,
      [`${MARKED_NAMESPACE}/place`]: place,
      [`${MARKED_NAMESPACE}/comboid`]: id,
    },
  } as unknown as Item;
}

beforeEach(() => {
  vi.clearAllMocks();
  world.items = [token];
});

describe("Marked! external contract", () => {
  it("reads the current compact room configuration without changing it", () => {
    const before = structuredClone(metadata);
    expect(readMarkedConfig(metadata)).toMatchObject({
      labels: [{ Name: "Dazed 😵‍💫", Direction: "Right", Color: "#ffaa00", Group: "#1" }],
      groups: [{ Num: "#1", TextSizeOverride: "24" }],
      fontSize: "36",
    });
    expect(metadata).toEqual(before);
  });
  it("supports compact and uncompressed legacy room settings", () => {
    const config = readMarkedConfig(metadata);
    expect(readMarkedConfig({ [MARKED_LEGACY_CONFIG_KEY]: metadata[MARKED_CONFIG_KEY] })).toEqual(
      config,
    );
    expect(
      readMarkedConfig({
        [MARKED_LEGACY_CONFIG_KEY]: {
          saveData: {
            Labels: [{ Name: "Dazed" }],
            Groups: [],
            Distance: "30",
            Opacity: "80",
            Stroke: "3",
          },
        },
      }),
    ).toMatchObject({ labels: [{ Name: "Dazed" }], fontSize: "30", opacity: "80", stroke: "3" });
  });
  it.each([{}, { [MARKED_CONFIG_KEY]: null }, { [MARKED_CONFIG_KEY]: { s: { l: "bad" } } }])(
    "does not select Marked for absent or malformed configuration",
    (value) => expect(readMarkedConfig(value)).toBeNull(),
  );
  it("creates a native marker with configured name, direction, color and group overrides", async () => {
    await syncConditionLabels(world.items, target, 150, metadata);
    const marker = world.items.find(isMarkedRoot)!;
    expect(marker).toMatchObject({
      type: "PATH",
      name: "Dazed 😵‍💫",
      attachedTo: "token",
      locked: true,
      visible: true,
      metadata: { [`${MARKED_NAMESPACE}/direction`]: 603, [`${MARKED_NAMESPACE}/place`]: 0 },
      style: { fillOpacity: 0.7, strokeWidth: 2, strokeColor: "#00ff00" },
    });
    const text = world.items.find((item) => item.type === "TEXT") as Text;
    expect(text).toMatchObject({
      attachedTo: marker.id,
      disableHit: true,
      text: { type: "PLAIN", plainText: "Dazed 😵‍💫", style: { fontSize: 24, fillColor: "#ffaa00" } },
    });
    expect(marker.position.x).toBe(390);
    expect(readLabelConditions(world.items, ["token"])).toEqual(["Dazed"]);
    expect(world.items.some((item) => item.type === "LABEL")).toBe(false);
    sdk.addItems.mockClear();
    await syncConditionLabels(world.items, target, 150, metadata);
    expect(sdk.addItems).not.toHaveBeenCalled();
  });
  it("keeps existing styled markers and their counters intact", async () => {
    const existing = root("Dazed 😵‍💫 (SE) 🎲");
    const counter = {
      id: "counter",
      type: "TEXT",
      attachedTo: existing.id,
      metadata: {},
    } as unknown as Item;
    world.items.push(existing, counter);
    await syncConditionLabels(world.items, target, 150, metadata);
    expect(world.items).toEqual([token, existing, counter]);
    expect(sdk.addItems).not.toHaveBeenCalled();
    expect(sdk.deleteItems).not.toHaveBeenCalled();
  });
  it("removes an ended marker and its descendants while preserving unrelated markers", async () => {
    world.items.push(
      root("Dazed"),
      root("Quest giver", "custom"),
      { id: "text", type: "TEXT", attachedTo: "root", metadata: {} } as unknown as Item,
      { id: "counter", type: "PATH", attachedTo: "root", metadata: {} } as unknown as Item,
      { id: "button", type: "PATH", attachedTo: "counter", metadata: {} } as unknown as Item,
    );
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token"], conditions: [] }],
      150,
      metadata,
    );
    expect(world.items.map((item) => item.id)).toEqual(["token", "custom"]);
  });
  it("migrates supported Token Labels to Marked without leaving duplicate condition sources", async () => {
    world.items.push(
      {
        id: "token-label-dazed",
        type: "LABEL",
        attachedTo: "token",
        text: { plainText: "Dazed" },
      } as unknown as Item,
      {
        id: "token-label-custom",
        type: "LABEL",
        attachedTo: "token",
        text: { plainText: "Quest giver" },
      } as unknown as Item,
    );
    await syncConditionLabels(world.items, target, 150, metadata);
    expect(world.items.some((item) => item.id === "token-label-dazed")).toBe(false);
    expect(world.items.some((item) => item.id === "token-label-custom")).toBe(true);
    expect(readLabelConditions(world.items, ["token"])).toEqual(["Dazed"]);
    const marker = world.items.find(isMarkedRoot)!;
    world.items = world.items.filter((item) => item.id !== marker.id);
    expect(readLabelConditions(world.items, ["token"])).toEqual([]);
  });
  it("reads only native root names for linked tokens, never orphan text or unrelated paths", () => {
    world.items.push(
      root("Dazed"),
      root("Slowed", "second-root", "second"),
      root("Prone", "unlinked", "other"),
      { ...root("Weakened", "plain"), metadata: {} },
      { ...root("Frightened", "orphan"), type: "TEXT" },
    );
    expect(readMarkedConditions(world.items, ["token", "second"])).toEqual(["Dazed", "Slowed"]);
  });
  it("uses a free stacking slot and applies conditions to every minion", async () => {
    world.items.push({ ...token, id: "second" }, root("Quest giver"));
    await syncMarkedConditions(
      world.items,
      [{ tokenIds: ["token", "second"], conditions: ["Prone", "Slowed"] }],
      150,
      null,
    );
    const roots = world.items.filter((item) => isMarkedRoot(item) && item.attachedTo === "token");
    expect(roots.map((item) => item.metadata[`${MARKED_NAMESPACE}/place`])).toEqual([0, 1, 2]);
    expect(readLabelConditions(world.items, ["second"])).toEqual(["Prone", "Slowed"]);
    expect(sdk.getColor).toHaveBeenCalledOnce();
  });
  it("preserves backward compatibility when conditions are omitted", async () => {
    world.items.push(root("Dazed"));
    await syncConditionLabels(world.items, [{ tokenIds: ["token"] }], 150, metadata);
    expect(sdk.addItems).not.toHaveBeenCalled();
    expect(sdk.deleteItems).not.toHaveBeenCalled();
  });
  it.each(["Top", "Bottom", "Left", "Right"])(
    "positions %s markers outside the token",
    async (direction) => {
      const config = readMarkedConfig(metadata)!;
      config.labels[0]!["Direction"] = direction;
      await syncMarkedConditions(world.items, target, 150, config);
      const marker = world.items.find(isMarkedRoot)!;
      const value =
        direction === "Left" || direction === "Right" ? marker.position.x : marker.position.y;
      if (direction === "Top" || direction === "Left") expect(value).toBeLessThan(225);
      else expect(value).toBeGreaterThan(375);
    },
  );
  it("centers Top and Right markers on top-left-anchored tokens identically to centered tokens", async () => {
    const topLeft = {
      ...token,
      id: "legacy",
      position: { x: 225, y: 225 },
      grid: { dpi: 150, offset: { x: 0, y: 0 } },
    } as Image;
    world.items = [topLeft];
    const config = readMarkedConfig(metadata)!;
    config.labels[0]!["Direction"] = "Top";
    await syncMarkedConditions(
      world.items,
      [{ tokenIds: ["legacy"], conditions: ["Dazed"] }],
      150,
      config,
    );
    const topMarker = world.items.find(isMarkedRoot)!;

    world.items = [token];
    await syncMarkedConditions(world.items, target, 150, config);
    const centeredMarker = world.items.find(isMarkedRoot)!;
    expect(topMarker.position).toEqual(centeredMarker.position);
  });
  it("positions markers symmetrically on horizontally flipped tokens", async () => {
    const flipped = {
      ...token,
      id: "flipped",
      scale: { x: -1, y: 1 },
    } as Image;
    const config = readMarkedConfig(metadata)!;
    config.labels[0]!["Direction"] = "Right";

    world.items = [token];
    await syncMarkedConditions(world.items, target, 150, config);
    const normalMarker = world.items.find(isMarkedRoot)!;

    world.items = [flipped];
    await syncMarkedConditions(
      world.items,
      [{ tokenIds: ["flipped"], conditions: ["Dazed"] }],
      150,
      config,
    );
    const flippedMarker = world.items.find(isMarkedRoot)!;
    expect(flippedMarker.position).toEqual(normalMarker.position);
  });
  it("preserves explicit zero opacity and outline stroke overrides", async () => {
    const zeroMeta: Metadata = {
      [MARKED_CONFIG_KEY]: {
        s: {
          g: [{ n: "#1", ts: "", bo: 0, os: 0 }],
          l: [{ i: "dazed", n: "Dazed", d: "Top", c: "#ffaa00", g: "#1" }],
          d: "36",
          o: "85",
          s: "4",
        },
      },
    };
    await syncConditionLabels(world.items, target, 150, zeroMeta);
    const marker = world.items.find(isMarkedRoot)!;
    expect(marker).toMatchObject({
      style: { fillOpacity: 0, strokeWidth: 0 },
    });
  });

  it("places Marked! root paths on the TEXT layer and stays finite when token.grid.dpi is zero", async () => {
    const zeroDpiToken = {
      ...token,
      id: "zero",
      grid: { dpi: 0, offset: { x: 0, y: 0 } },
    } as Image;
    world.items = [zeroDpiToken];
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["zero"], conditions: ["Dazed"] }],
      150,
      metadata,
    );
    const marker = world.items.find(isMarkedRoot)!;
    expect(marker.layer).toBe("TEXT");
    expect(Number.isFinite(marker.position.x)).toBe(true);
    expect(Number.isFinite(marker.position.y)).toBe(true);
  });
});
