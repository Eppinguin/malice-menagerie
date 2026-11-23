import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneSummary } from "../../../shared/obr/protocol.ts";

const sdk = vi.hoisted(() => ({
  ready: false,
  onReady: null as ((ready: boolean) => void) | null,
  getItems: vi.fn(async () => []),
  getMetadata: vi.fn(async () => ({})),
  sceneSummary: vi.fn(async () => ({ sceneId: "scene", sceneReady: true })),
}));
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    scene: {
      isReady: async () => sdk.ready,
      items: { getItems: sdk.getItems, onChange: () => () => {} },
      getMetadata: sdk.getMetadata,
      onMetadataChange: () => () => {},
      onReadyChange: (callback: (ready: boolean) => void) => {
        sdk.onReady = callback;
        return () => {};
      },
    },
    player: { onChange: () => () => {} },
  },
}));
vi.mock("../../../obr/src/scene.ts", () => ({
  sceneSummary: sdk.sceneSummary,
  forgetSceneIdentity: vi.fn(),
  getSceneIdentity: async () => ({ sceneId: "scene", roomId: "room" }),
  readIntegrationToken: () => null,
  tokenStamina: vi.fn(),
}));
import { SceneObserver } from "../../../obr/src/observers.ts";

let observer: SceneObserver;
let changed = vi.fn<(scene: SceneSummary) => void>();
beforeEach(() => {
  sdk.ready = false;
  vi.clearAllMocks();
  changed = vi.fn();
  observer = new SceneObserver({ emit: vi.fn(), onSceneChanged: changed, onSceneLost: vi.fn() });
});
afterEach(() => observer.stop());

describe("scene observer startup", () => {
  it("waits for the scene before reading items and metadata or announcing a scene", async () => {
    observer.start();
    observer.setEncounter("encounter");
    await vi.waitFor(() => expect(sdk.onReady).not.toBeNull());
    expect(sdk.getItems).not.toHaveBeenCalled();
    expect(sdk.getMetadata).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    sdk.ready = true;
    sdk.onReady?.(true);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(sdk.getItems).toHaveBeenCalledOnce();
    expect(sdk.getMetadata).toHaveBeenCalledOnce();
  });

  it("announces an already-ready scene on initial startup", async () => {
    sdk.ready = true;
    observer.start();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(sdk.sceneSummary).toHaveBeenCalledOnce();
  });
});
