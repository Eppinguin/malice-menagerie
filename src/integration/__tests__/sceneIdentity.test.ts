import { beforeEach, expect, it, vi } from "vitest";
import { SCENE_METADATA_KEY } from "../../../shared/obr/protocol.ts";

const sdk = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
}));
vi.mock("@owlbear-rodeo/sdk", () => ({
  buildImage: vi.fn(),
  isImage: vi.fn(),
  default: {
    room: { id: "room" },
    scene: { getMetadata: sdk.getMetadata, setMetadata: sdk.setMetadata },
  },
}));
import { forgetSceneIdentity, getSceneIdentity } from "../../../obr/src/scene.ts";

beforeEach(() => {
  forgetSceneIdentity();
  vi.resetAllMocks();
});

it("reads back the persisted winner after competing scene initialization", async () => {
  sdk.getMetadata.mockResolvedValueOnce({}).mockResolvedValue({
    [SCENE_METADATA_KEY]: { sceneId: "competing-winner" },
  });
  await expect(getSceneIdentity()).resolves.toEqual({
    sceneId: "competing-winner",
    roomId: "room",
  });
  expect(sdk.setMetadata).toHaveBeenCalledOnce();
  expect(sdk.setMetadata.mock.calls[0]![0][SCENE_METADATA_KEY].sceneId).not.toBe(
    "competing-winner",
  );
});

it("converges after a later competing write even without a metadata event", async () => {
  sdk.getMetadata.mockResolvedValue({ [SCENE_METADATA_KEY]: { sceneId: "first" } });
  await expect(getSceneIdentity()).resolves.toMatchObject({ sceneId: "first" });
  sdk.getMetadata.mockResolvedValue({ [SCENE_METADATA_KEY]: { sceneId: "winner" } });
  await expect(getSceneIdentity()).resolves.toMatchObject({ sceneId: "winner" });
});

it("shares concurrent initialization and retries after a failed read", async () => {
  sdk.getMetadata.mockRejectedValueOnce(new Error("loading"));
  const first = getSceneIdentity();
  expect(getSceneIdentity()).toBe(first);
  await expect(first).rejects.toThrow("loading");
  sdk.getMetadata.mockResolvedValue({ [SCENE_METADATA_KEY]: { sceneId: "ready" } });
  await expect(getSceneIdentity()).resolves.toMatchObject({ sceneId: "ready" });
});
