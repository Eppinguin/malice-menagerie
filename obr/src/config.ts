/**
 * Extension-local constants. The wire contract lives in `shared/obr/protocol.ts`;
 * this file only covers the extension host.
 */
export const EXTENSION_VERSION = "0.1.0";
export const OFFICIAL_MALICE_URL = "https://malice-menagerie.pages.dev";

/**
 * When hosted over HTTPS alongside the app (production, Cloudflare Pages
 * previews, or self-hosting), default to the same origin so both stay paired
 * automatically. Over HTTP localhost dev, keep the official URL as the default
 * and use the Custom address setting for the separate app dev port.
 */
export function defaultMaliceUrl(): string {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    window.location.origin !== "null"
  ) {
    return window.location.origin;
  }
  return OFFICIAL_MALICE_URL;
}

export const DEFAULT_MALICE_URL = defaultMaliceUrl();
export const MALICE_URL_STORAGE_KEY = "malice-menagerie/url";

/**
 * The popover and the background page are same-origin but cannot reach each
 * other's window: the frame between them is Owlbear Rodeo. They coordinate
 * through:
 *
 * - a room-scoped `BroadcastChannel` for plain status/control messages, and
 * - a `SharedWorker` for the one thing `BroadcastChannel` cannot carry, a
 *   `MessagePort`. `BroadcastChannel.postMessage` has no transfer list, so
 *   handing the Malice port to the persistent background needs the worker.
 *
 * Scoping both by room id keeps two open Owlbear rooms on the same extension
 * origin from stealing each other's connections.
 */
export function bridgeChannelName(roomId: string): string {
  return `malice-menagerie/bridge/${roomId}`;
}

export const BRIDGE_WORKER_NAME = "malice-menagerie-bridge";

export function bridgeWorkerUrl(): string {
  return new URL("bridge-worker.js", window.location.href).href;
}

/** Marks the local-only highlight shape so it can be removed cleanly. */
export const HIGHLIGHT_METADATA_KEY = "com.malicemenagerie.owlbear/highlight";

/** Generic fallback from the supplied Too Many Tokens map (Human Guard).
 * Assigned monsters use their own image in tokenArtworkMap.json. Keep URLs
 * public and short: Owlbear cannot use inline data or extension-local blobs.
 */
export const TOKEN_IMAGE_URL =
  "https://raw.githubusercontent.com/IsThisMyRealName/too-many-tokens-dnd/main/Guard/GuardHumanFemale%20(6).webp";

export function tokenImageUrl(): string {
  return TOKEN_IMAGE_URL;
}
