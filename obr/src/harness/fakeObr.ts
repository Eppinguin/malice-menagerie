import { ImageBuilder } from "@owlbear-rodeo/sdk/lib/builders/ImageBuilder.js";
import { LabelBuilder } from "@owlbear-rodeo/sdk/lib/builders/LabelBuilder.js";
import { PathBuilder } from "@owlbear-rodeo/sdk/lib/builders/PathBuilder.js";
import { TextBuilder } from "@owlbear-rodeo/sdk/lib/builders/TextBuilder.js";

/**
 * A small in-memory stand-in for `@owlbear-rodeo/sdk`, used only by the
 * browser harness (`vite.harness.config.ts`). It lets the real popover and
 * background pages run outside Owlbear Rodeo so the pairing bridge can be
 * exercised in an actual browser.
 *
 * It is not a substitute for the live-room checklist: it models only what the
 * extension touches, and no OBR behaviour beyond that.
 */
export interface FakeItem {
  id: string;
  name: string;
  type: "IMAGE" | "SHAPE" | "LABEL" | "PATH" | "TEXT";
  layer: string;
  position: { x: number; y: number };
  visible: boolean;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

type Style = Partial<FakeItem> & { metadata?: Record<string, unknown> };

let sequence = 0;
const items: FakeItem[] = [];
const localItems: FakeItem[] = [];
const metadata: Record<string, unknown> = {};
const selection: string[] = [];
const requests = { getItems: 0, addBatches: [] as number[], updateBatches: [] as number[] };
const rateLimit = { addItems: 0, updateItems: 0 };
const viewport = { position: { x: 0, y: 0 }, scale: 1, width: 1200, height: 800 };

function builder(item: FakeItem) {
  const chain = {
    name(value: string) {
      item.name = value;
      return chain;
    },
    position(value: { x: number; y: number }) {
      item.position = value;
      return chain;
    },
    layer(value: string) {
      item.layer = value;
      return chain;
    },
    visible(value: boolean) {
      item.visible = value;
      return chain;
    },
    metadata(value: Record<string, unknown>) {
      item.metadata = { ...value };
      return chain;
    },
    width(value: number) {
      item.width = value;
      return chain;
    },
    height(value: number) {
      item.height = value;
      return chain;
    },
    shapeType(value: string) {
      item.shapeType = value;
      return chain;
    },
    fillColor(value: string) {
      item.fillColor = value;
      return chain;
    },
    fillOpacity(value: number) {
      item.fillOpacity = value;
      return chain;
    },
    strokeColor(value: string) {
      item.strokeColor = value;
      return chain;
    },
    strokeOpacity(value: number) {
      item.strokeOpacity = value;
      return chain;
    },
    strokeWidth(value: number) {
      item.strokeWidth = value;
      return chain;
    },
    locked(value: boolean) {
      item.locked = value;
      return chain;
    },
    disableHit(value: boolean) {
      item.disableHit = value;
      return chain;
    },
    build: () => item,
  };
  return chain;
}

export function buildImage(
  image: ConstructorParameters<typeof ImageBuilder>[1],
  grid: ConstructorParameters<typeof ImageBuilder>[2],
): ImageBuilder {
  return new ImageBuilder(builderPlayer, image, grid);
}

// SDK builders are local object constructors; they do not contact Owlbear.
const builderPlayer = { id: "harness-player" } as ConstructorParameters<typeof LabelBuilder>[0];
export const buildLabel = () => new LabelBuilder(builderPlayer);
export const buildPath = () => new PathBuilder(builderPlayer);
export const buildText = () => new TextBuilder(builderPlayer);

/** Mirrors the SDK's type guard; image items carry their descriptor under `image`. */
export function isImage(item: FakeItem): boolean {
  return item.type === "IMAGE";
}

/** Owlbear's own limit for an image item's `url`. */
const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * Owlbear validates item image URLs on add and update. It rejects an over-long
 * URL with a plain string (not an `Error`), which is exactly the shape that
 * used to collapse into "Token creation failed.":
 *
 *   "items[0].image.url" length must be less than or equal to 2048
 *
 * `data:` and `blob:` URLs are accepted but never render, because item images
 * are fetched under Owlbear's `connect-src` policy. The harness cannot load
 * images either, so it only warns about those.
 */
function assertImageUrls(items: readonly FakeItem[]): void {
  items.forEach((item, index) => {
    const image = item.image as { url?: unknown } | undefined;
    const url = image?.url;
    if (typeof url !== "string") return;
    if (url.length > MAX_IMAGE_URL_LENGTH) {
      throw `"items[${index}].image.url" length must be less than or equal to ${MAX_IMAGE_URL_LENGTH}`;
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      console.warn(
        `Harness: items[${index}].image.url is a ${url.slice(0, 5)} URL; Owlbear never renders those.`,
      );
    }
  });
}

export function buildShape(style: Style = {}): ReturnType<typeof builder> {
  return builder({
    id: `shape-${++sequence}`,
    name: "",
    type: "SHAPE",
    layer: "POPOVER",
    position: { x: 0, y: 0 },
    visible: true,
    metadata: {},
    ...style,
  });
}

const unsubscribe = () => {};

const diceBus = new BroadcastChannel("harness-obr-broadcast");
const broadcastListeners = new Map<
  string,
  Set<(event: { data: unknown; connectionId: string }) => void>
>();
function receiveBroadcast(message: { channel: string; data: unknown }): void {
  for (const listener of broadcastListeners.get(message.channel) ?? [])
    listener({ data: message.data, connectionId: "harness" });
}
diceBus.onmessage = ({ data }) => receiveBroadcast(data);

const OBR = {
  broadcast: {
    onMessage(channel: string, listener: (event: { data: unknown; connectionId: string }) => void) {
      const listeners = broadcastListeners.get(channel) ?? new Set();
      listeners.add(listener);
      broadcastListeners.set(channel, listeners);
      return () => {
        listeners.delete(listener);
      };
    },
    async sendMessage(channel: string, data: unknown) {
      diceBus.postMessage({ channel, data });
      receiveBroadcast({ channel, data });
    },
  },
  onReady(callback: () => void): () => void {
    setTimeout(callback, 0);
    return unsubscribe;
  },
  theme: {
    getTheme: async () => ({
      mode: "LIGHT",
      primary: { main: "#673ab7", light: "#9a67ea", dark: "#320b86", contrastText: "#ffffff" },
      secondary: { main: "#009688", light: "#52c7b8", dark: "#00675b", contrastText: "#ffffff" },
      background: { default: "#ffffff", paper: "#f5f5f5" },
      text: { primary: "#212121", secondary: "#616161", disabled: "#9e9e9e" },
    }),
    onChange: unsubscribe,
  },
  room: {
    id: "harness-room",
    getMetadata: async () => ({ ...metadata }),
    setMetadata: async (update: Record<string, unknown>) => {
      Object.assign(metadata, update);
    },
    onMetadataChange: unsubscribe,
  },
  player: {
    id: "harness-player",
    getRole: async () => "GM" as const,
    getColor: async () => "#00aaff",
    selection,
    getSelection: async () => [...selection],
    select: async (ids: string[], replace = true) => {
      if (replace) selection.length = 0;
      for (const id of ids) if (!selection.includes(id)) selection.push(id);
    },
    onChange: unsubscribe,
  },
  scene: {
    isReady: async () => true,
    getMetadata: async () => ({ ...metadata }),
    setMetadata: async (update: Record<string, unknown>) => {
      Object.assign(metadata, update);
    },
    onMetadataChange: unsubscribe,
    onReadyChange: unsubscribe,
    grid: { getDpi: async () => 150 },
    items: {
      getItems: async () => {
        requests.getItems += 1;
        return [...items];
      },
      addItems: async (next: FakeItem[]) => {
        requests.addBatches.push(next.length);
        if (rateLimit.addItems > 0) {
          rateLimit.addItems -= 1;
          throw "Too many requests";
        }
        assertImageUrls(next);
        items.push(...next);
      },
      updateItems: async (targets: (FakeItem | string)[], update: (drafts: FakeItem[]) => void) => {
        requests.updateBatches.push(targets.length);
        if (rateLimit.updateItems > 0) {
          rateLimit.updateItems -= 1;
          throw "Too many requests";
        }
        const drafts = targets
          .map((target) =>
            typeof target === "string"
              ? items.find((item) => item.id === target)
              : (items.find((item) => item.id === target.id) ?? target),
          )
          .filter((item): item is FakeItem => item !== undefined);
        update(drafts);
        assertImageUrls(drafts);
      },
      deleteItems: async (ids: string[]) => {
        for (const id of ids) {
          const index = items.findIndex((item) => item.id === id);
          if (index !== -1) items.splice(index, 1);
        }
      },
      getItemBounds: async (ids: string[]) => {
        const targets = items.filter((item) => ids.includes(item.id));
        if (!targets.length) throw new Error("No tokens remain to locate.");
        const edges = targets.map((item) => {
          const image = item.image as { width: number; height: number } | undefined;
          const grid = item.grid as { dpi: number; offset: { x: number; y: number } } | undefined;
          const factor = 150 / (grid?.dpi ?? 150);
          const x = item.position.x - (grid?.offset.x ?? 0) * factor;
          const y = item.position.y - (grid?.offset.y ?? 0) * factor;
          return {
            x,
            y,
            right: x + (image?.width ?? Number(item.width ?? 150)) * factor,
            bottom: y + (image?.height ?? Number(item.height ?? 150)) * factor,
          };
        });
        const min = {
          x: Math.min(...edges.map((e) => e.x)),
          y: Math.min(...edges.map((e) => e.y)),
        };
        const max = {
          x: Math.max(...edges.map((e) => e.right)),
          y: Math.max(...edges.map((e) => e.bottom)),
        };
        return {
          min,
          max,
          center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
          width: max.x - min.x,
          height: max.y - min.y,
        };
      },
      onChange: unsubscribe,
    },
    local: {
      getItems: async () => [...localItems],
      addItems: async (next: FakeItem[]) => {
        localItems.push(...next);
      },
      deleteItems: async (ids: string[]) => {
        for (const id of ids) {
          const index = localItems.findIndex((item) => item.id === id);
          if (index !== -1) localItems.splice(index, 1);
        }
      },
    },
  },
  viewport: {
    getPosition: async () => ({ ...viewport.position }),
    getScale: async () => viewport.scale,
    getWidth: async () => viewport.width,
    getHeight: async () => viewport.height,
    transformPoint: async (point: { x: number; y: number }) => ({
      x: point.x * viewport.scale + viewport.position.x,
      y: point.y * viewport.scale + viewport.position.y,
    }),
    inverseTransformPoint: async (point: { x: number; y: number }) => ({
      x: (point.x - viewport.position.x) / viewport.scale,
      y: (point.y - viewport.position.y) / viewport.scale,
    }),
    animateTo: async (transform: { position: { x: number; y: number }; scale: number }) => {
      viewport.position = { ...transform.position };
      viewport.scale = transform.scale;
    },
  },
};

/** Read-only view for the harness driver. */
export const fakeScene = { items, localItems, metadata, selection, viewport, requests, rateLimit };

declare global {
  interface Window {
    __fakeScene: typeof fakeScene;
  }
}

window.__fakeScene = fakeScene;

export default OBR;
