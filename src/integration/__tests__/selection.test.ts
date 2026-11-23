import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  player: { select: vi.fn(async (_ids: string[], _replace?: boolean) => {}) },
  scene: {
    local: {
      getItems: vi.fn(async (): Promise<{ id: string; metadata: Record<string, unknown> }[]> => []),
      deleteItems: vi.fn(async (_ids: string[]) => {}),
    },
  },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk, buildImage: vi.fn(), isImage: vi.fn() }));

import { selectTokens } from "../../../obr/src/scene.ts";
import { HIGHLIGHT_METADATA_KEY } from "../../../obr/src/config.ts";

beforeEach(() => vi.clearAllMocks());

describe("native Owlbear selection", () => {
  it("selects the linked token and replaces the previous selection", async () => {
    await selectTokens(["token-1"]);
    expect(sdk.player.select).toHaveBeenCalledWith(["token-1"], true);
  });

  it("selects every linked minion and removes only the old extension highlight", async () => {
    sdk.scene.local.getItems.mockResolvedValueOnce([
      { id: "legacy-highlight", metadata: { [HIGHLIGHT_METADATA_KEY]: true } },
      { id: "other-local-item", metadata: {} },
    ]);
    await selectTokens(["minion-1", "minion-2", "minion-3", "minion-4"]);
    expect(sdk.scene.local.deleteItems).toHaveBeenCalledWith(["legacy-highlight"]);
    expect(sdk.player.select).toHaveBeenCalledWith(
      ["minion-1", "minion-2", "minion-3", "minion-4"],
      true,
    );
  });

  it("leaves the current selection alone when no linked tokens remain", async () => {
    await selectTokens([]);
    expect(sdk.player.select).not.toHaveBeenCalled();
  });

  it("still selects when legacy highlight cleanup is unavailable", async () => {
    sdk.scene.local.getItems.mockRejectedValueOnce(new Error("Scene local items unavailable"));
    await selectTokens(["token-1"]);
    expect(sdk.player.select).toHaveBeenCalledWith(["token-1"], true);
  });
});
