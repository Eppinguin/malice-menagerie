import { basePath } from "./levels.ts";

export const HOMEBREW_MONSTER_PREFIX = "homebrew:monster:";
export const HOMEBREW_MALICE_PREFIX = "homebrew:malice:";

let lastTimestamp = 0;
let lastSeq = 0;

/**
 * Generate an RFC 9562 UUIDv7 string (time-ordered, globally unique, native
 * Postgres `uuid` compatible). Uses `crypto.getRandomValues` with a monotonic
 * 12-bit sequence counter for same-millisecond ordering.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  let now = Date.now();
  if (now <= lastTimestamp) {
    lastSeq = (lastSeq + 1) & 0x0fff;
    if (lastSeq === 0) {
      now = lastTimestamp + 1;
    } else {
      now = lastTimestamp;
    }
  } else {
    lastSeq = ((bytes[6]! & 0x0f) << 8) | bytes[7]!;
  }
  lastTimestamp = now;

  // 48-bit big-endian Unix ms timestamp
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 (0111) + 12-bit monotonic sequence
  bytes[6] = 0x70 | ((lastSeq >> 8) & 0x0f);
  bytes[7] = lastSeq & 0xff;

  // Variant 10xx (RFC 9562)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function homebrewMonsterPath(id: string): string {
  return `${HOMEBREW_MONSTER_PREFIX}${id}`;
}

export function isHomebrewMonsterPath(path: string): boolean {
  return basePath(path).startsWith(HOMEBREW_MONSTER_PREFIX);
}

export function homebrewMonsterIdFromPath(path: string): string | null {
  const base = basePath(path);
  if (!base.startsWith(HOMEBREW_MONSTER_PREFIX)) return null;
  const id = base.slice(HOMEBREW_MONSTER_PREFIX.length).trim();
  return id || null;
}

export function homebrewMaliceId(id: string): string {
  return `${HOMEBREW_MALICE_PREFIX}${id}`;
}

export function isHomebrewMaliceId(id: string): boolean {
  return id.startsWith(HOMEBREW_MALICE_PREFIX);
}

export function homebrewMaliceUuidFromId(id: string): string | null {
  if (!id.startsWith(HOMEBREW_MALICE_PREFIX)) return null;
  const uuid = id.slice(HOMEBREW_MALICE_PREFIX.length).trim();
  return uuid || null;
}
