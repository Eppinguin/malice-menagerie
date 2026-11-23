import { beforeEach, describe, expect, it, vi } from "vitest";

const camera = vi.hoisted(() => ({ position: { x: 0, y: 0 }, scale: 1, width: 1200, height: 800 }));
const target = vi.hoisted(() => ({ x: 1575, y: -825 }));
const sdk = vi.hoisted(() => ({
  scene: { items: { getItemBounds: vi.fn(async (_ids: string[]) => ({ center: { ...target } })) } },
  viewport: {
    getPosition: vi.fn(async () => ({ ...camera.position })),
    getScale: vi.fn(async () => camera.scale),
    getWidth: vi.fn(async () => camera.width),
    getHeight: vi.fn(async () => camera.height),
    transformPoint: vi.fn(async (p: { x: number; y: number }) => ({
      x: p.x * camera.scale + camera.position.x,
      y: p.y * camera.scale + camera.position.y,
    })),
    animateTo: vi.fn(async (transform: { position: { x: number; y: number }; scale: number }) => {
      camera.position = { ...transform.position };
      camera.scale = transform.scale;
    }),
  },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk, buildImage: vi.fn(), isImage: vi.fn() }));
import { focusTokens } from "../../../obr/src/scene.ts";

beforeEach(() => {
  vi.clearAllMocks();
  camera.position = { x: -450, y: 300 };
  camera.scale = 1;
  camera.width = 1200;
  camera.height = 800;
});

describe("locating Owlbear tokens", () => {
  it.each([0.25, 1, 2.5])(
    "centres the target after panning at zoom %s without changing zoom",
    async (scale) => {
      camera.scale = scale;
      await focusTokens(["token-1"]);
      const screen = await sdk.viewport.transformPoint(target);
      expect(screen.x).toBeCloseTo(camera.width / 2);
      expect(screen.y).toBeCloseTo(camera.height / 2);
      expect(camera.scale).toBe(scale);
    },
  );

  it("does not drift when Locate is pressed repeatedly", async () => {
    camera.scale = 1.75;
    await focusTokens(["token-1"]);
    const firstPosition = { ...camera.position };
    await focusTokens(["token-1"]);
    expect(camera.position).toEqual(firstPosition);
  });

  it("centres the combined bounds of all linked minions in a narrow viewport", async () => {
    camera.width = 390;
    camera.height = 844;
    camera.scale = 0.5;
    const ids = ["minion-1", "minion-2", "minion-3", "minion-4"];
    await focusTokens(ids);
    expect(sdk.scene.items.getItemBounds).toHaveBeenCalledWith(ids);
    expect(await sdk.viewport.transformPoint(target)).toEqual({ x: 195, y: 422 });
    expect(camera.scale).toBe(0.5);
  });

  it("leaves the camera alone if there are no linked tokens", async () => {
    await focusTokens([]);
    expect(sdk.scene.items.getItemBounds).not.toHaveBeenCalled();
    expect(sdk.viewport.animateTo).not.toHaveBeenCalled();
  });
});
