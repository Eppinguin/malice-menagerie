import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Image, Item, Label } from "@owlbear-rodeo/sdk";
import { conditionFromLabel, mergeLabelConditions } from "../../../shared/obr/conditionLabels.ts";

const world = vi.hoisted(() => ({ items: [] as Item[] }));
const sdk = vi.hoisted(() => ({
  addItems: vi.fn(async (items: Item[]) => {
    world.items.push(...structuredClone(items));
  }),
  deleteItems: vi.fn(async (ids: string[]) => {
    world.items = world.items.filter((item) => !ids.includes(item.id));
  }),
}));
vi.mock("@owlbear-rodeo/sdk", async () => {
  const { LabelBuilder } = await import("@owlbear-rodeo/sdk/lib/builders/LabelBuilder.js");
  return {
    default: { scene: { items: sdk } },
    buildLabel: () =>
      new LabelBuilder({ id: "gm" } as ConstructorParameters<typeof LabelBuilder>[0]),
  };
});
import { isMarkedRoot, MARKED_NAMESPACE } from "../../../obr/src/marked.ts";
import { readLabelConditions, syncConditionLabels } from "../../../obr/src/conditionLabels.ts";

const token = {
  id: "token",
  type: "IMAGE",
  visible: true,
  position: { x: 300, y: 300 },
  scale: { x: 1, y: 1 },
  image: { width: 150, height: 150 },
  grid: { dpi: 150 },
} as Image;
function label(text: string, suffix = text, attachedTo = "token"): Label {
  return {
    id: `${attachedTo}-label-${suffix}`,
    type: "LABEL",
    attachedTo,
    text: { plainText: text },
  } as Label;
}

beforeEach(() => {
  vi.clearAllMocks();
  world.items = [token];
});

describe("Token Labels contract", () => {
  it.each(["Dazed", "dazed", "Dazed (SE)", "Dazed 😵‍💫 (EoT) 1️⃣", "Dazed 😵‍💫 (SE) 🎲"])(
    "recognizes %s",
    (text) => expect(conditionFromLabel(text)).toBe("Dazed"),
  );
  it.each(["Dazed by Bob", "Dazedness", "Winded", "Dying", "Invisible", "", "Dazed (unknown)"])(
    "preserves unrelated annotation %s",
    (text) => expect(conditionFromLabel(text)).toBeNull(),
  );
  it("keeps custom app conditions when accepting labels", () => {
    expect(mergeLabelConditions(["Blessed", "Dazed"], ["Prone"])).toEqual(["Blessed", "Prone"]);
  });
  it("creates compatible labels once and makes them removable through an empty condition list", async () => {
    const targets = [{ tokenIds: ["token"], conditions: ["Dazed", "Prone"] }];
    await syncConditionLabels(world.items, targets, 150);
    expect(readLabelConditions(world.items, ["token"])).toEqual(["Dazed", "Prone"]);
    expect(world.items[1]).toMatchObject({
      id: expect.stringMatching(/^token-label-malice-dazed-/),
      type: "LABEL",
      attachedTo: "token",
      position: { x: 225, y: 240 },
      visible: true,
      text: { plainText: "Dazed" },
      style: { pointerDirection: "LEFT" },
    });
    sdk.addItems.mockClear();
    await syncConditionLabels(world.items, targets, 150);
    expect(sdk.addItems).not.toHaveBeenCalled();
    await syncConditionLabels(world.items, [{ tokenIds: ["token"], conditions: [] }], 150);
    expect(world.items).toEqual([token]);
  });
  it("retains existing duration, emoji and custom annotations while removing ended conditions", async () => {
    const existing = [label("Dazed 😵‍💫 (SE) 🎲"), label("Prone"), label("Quest giver")];
    world.items.push(...existing);
    await syncConditionLabels(world.items, [{ tokenIds: ["token"], conditions: ["Dazed"] }], 150);
    expect(world.items).toEqual([token, existing[0], existing[2]]);
    expect(sdk.addItems).not.toHaveBeenCalled();
  });
  it("uses a free position when replacing one of several labels", async () => {
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token"], conditions: ["Dazed", "Prone"] }],
      150,
    );
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token"], conditions: ["Prone", "Slowed"] }],
      150,
    );
    const labels = world.items.filter((item) => item.type === "LABEL");
    expect(labels).toHaveLength(2);
    expect(labels[0]?.position).not.toEqual(labels[1]?.position);
  });
  it("does not change labels for an older bridge payload", async () => {
    world.items.push(label("Dazed"));
    await syncConditionLabels(world.items, [{ tokenIds: ["token"] }], 150);
    expect(sdk.addItems).not.toHaveBeenCalled();
    expect(sdk.deleteItems).not.toHaveBeenCalled();
  });
  it("only reads attached labels with upstream ids and unions conditions across a squad", () => {
    world.items.push(
      label("Dazed"),
      label("Prone", "p", "second"),
      { ...label("Slowed"), id: "some-other-extension" },
      label("Weakened", "w", "unlinked"),
    );
    expect(readLabelConditions(world.items, ["token", "second"])).toEqual(["Dazed", "Prone"]);
  });
  it("writes a condition to every minion in a squad", async () => {
    world.items.push({ ...token, id: "second" });
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token", "second"], conditions: ["Slowed"] }],
      150,
    );
    expect(readLabelConditions(world.items, ["token"])).toEqual(["Slowed"]);
    expect(readLabelConditions(world.items, ["second"])).toEqual(["Slowed"]);
  });
  it("respects explicit condition sync modes (off and token-labels)", async () => {
    world.items.push(label("Dazed"));
    expect(readLabelConditions(world.items, ["token"], "off")).toEqual([]);
    expect(readLabelConditions(world.items, ["token"], "marked")).toEqual([]);
    expect(readLabelConditions(world.items, ["token"], "token-labels")).toEqual(["Dazed"]);
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token"], conditions: ["Slowed"] }],
      150,
      {},
      async () => {},
      "off",
    );
    expect(sdk.addItems).not.toHaveBeenCalled();
    expect(sdk.deleteItems).not.toHaveBeenCalled();
  });
  it("aligns labels against top-left-anchored tokens using grid.offset", async () => {
    const topLeft = {
      ...token,
      id: "legacy",
      position: { x: 225, y: 225 },
      grid: { dpi: 150, offset: { x: 0, y: 0 } },
    } as Image;
    world.items = [topLeft];
    await syncConditionLabels(world.items, [{ tokenIds: ["legacy"], conditions: ["Dazed"] }], 150);
    expect(world.items[1]).toMatchObject({ position: { x: 225, y: 240 } });
  });
  it("clears stale Marked! condition markers when switching to token-labels mode while keeping custom marks", async () => {
    const markedRoot = (name: string, id: string) =>
      ({
        id,
        name,
        type: "PATH",
        attachedTo: "token",
        metadata: {
          [`${MARKED_NAMESPACE}/direction`]: 601,
          [`${MARKED_NAMESPACE}/place`]: 0,
          [`${MARKED_NAMESPACE}/comboid`]: id,
        },
      }) as unknown as Item;
    world.items.push(markedRoot("Dazed", "m-dazed"), markedRoot("Custom mark", "m-custom"));
    await syncConditionLabels(
      world.items,
      [{ tokenIds: ["token"], conditions: ["Dazed"] }],
      150,
      {},
      async () => {},
      "token-labels",
    );
    expect(world.items.filter(isMarkedRoot).map((item) => item.name)).toEqual(["Custom mark"]);
    expect(readLabelConditions(world.items, ["token"], "token-labels")).toEqual(["Dazed"]);
  });

  it("preserves duration suffixes on existing conditions during mergeLabelConditions", () => {
    expect(mergeLabelConditions(["Bleeding (EoT)", "Prone (SE)"], ["Bleeding"])).toEqual([
      "Bleeding (EoT)",
    ]);
    expect(mergeLabelConditions(["Bleeding (EoT)", "Custom tag"], ["Bleeding", "Dazed"])).toEqual([
      "Custom tag",
      "Bleeding (EoT)",
      "Dazed",
    ]);
  });

  it("produces finite label positions when token.grid.dpi is zero", async () => {
    const zeroDpi = { ...token, id: "zero", grid: { dpi: 0 } } as Image;
    world.items = [zeroDpi];
    await syncConditionLabels(world.items, [{ tokenIds: ["zero"], conditions: ["Dazed"] }], 150);
    const created = world.items.find((item) => item.type === "LABEL") as Label;
    expect(Number.isFinite(created.position.x)).toBe(true);
    expect(Number.isFinite(created.position.y)).toBe(true);
  });
});
