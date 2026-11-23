/** Shared by the popover and persistent background on this extension's origin. */
export const TOKEN_ARTWORK_STORAGE_KEY = "malice-menagerie/token-artwork";
export const RINGS_SYNC_STORAGE_KEY = "malice-menagerie/rings-sync";
export const CONDITION_SYNC_STORAGE_KEY = "malice-menagerie/condition-sync";

export type ConditionSyncMode = "auto" | "marked" | "token-labels" | "off";

const CONDITION_SYNC_MODES: readonly ConditionSyncMode[] = [
  "auto",
  "marked",
  "token-labels",
  "off",
];

export function usesTokenArtwork(): boolean {
  try {
    return localStorage.getItem(TOKEN_ARTWORK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveTokenArtwork(enabled: boolean): boolean {
  try {
    localStorage.setItem(TOKEN_ARTWORK_STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function usesRingsSync(): boolean {
  try {
    return localStorage.getItem(RINGS_SYNC_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveRingsSync(enabled: boolean): boolean {
  try {
    localStorage.setItem(RINGS_SYNC_STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function conditionSyncMode(): ConditionSyncMode {
  try {
    const raw = localStorage.getItem(CONDITION_SYNC_STORAGE_KEY);
    if (raw && CONDITION_SYNC_MODES.includes(raw as ConditionSyncMode))
      return raw as ConditionSyncMode;
    return "auto";
  } catch {
    return "auto";
  }
}

export function saveConditionSyncMode(mode: ConditionSyncMode): boolean {
  try {
    localStorage.setItem(CONDITION_SYNC_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function tokenInitials(name: string, index?: number): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (index !== undefined && Number.isInteger(index) && index > 0) {
    const first = words[0] ? Array.from(words[0])[0]?.toLocaleUpperCase() : "?";
    return `${first ?? "?"}${index}`;
  }
  return words.length
    ? words
        .slice(0, 2)
        .map((word) => Array.from(word)[0])
        .join("")
        .toLocaleUpperCase()
    : "?";
}
