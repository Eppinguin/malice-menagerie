/**
 * Isolation layer for Seamus Finlayson's Draw Steel Tools extension.
 *
 * These formats are an external, undocumented contract. Nothing else in this
 * extension writes these keys, so a change to the format has one place to
 * land. The extension is deliberately not forked or modified.
 */
import OBR, { type Item, type Metadata } from "@owlbear-rodeo/sdk";
import { SEAMUS_MINION_GROUPS_KEY, SEAMUS_TOKEN_METADATA_KEY } from "../../shared/obr/protocol.ts";

export interface SeamusMonsterData {
  type: "MONSTER";
  name: string;
  gmOnly: boolean;
  stamina: number;
  staminaMaximum: number;
  temporaryStamina: number;
  statblockName: string;
  resourceId: string;
}

export interface SeamusMinionTokenData {
  type: "MINION";
  groupId: string;
}

export interface SeamusMinionGroup {
  type: "MINION";
  id: string;
  name: string;
  nameTagsEnabled: boolean;
  currentStamina: number;
  individualStamina: number;
  statblock?: string;
  resourceId?: string;
  gmOnly?: boolean;
  /** Preserve any fields a newer Draw Steel Tools build adds. */
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readSeamusToken(item: Item): Record<string, unknown> | null {
  const value = item.metadata[SEAMUS_TOKEN_METADATA_KEY];
  return isRecord(value) ? value : null;
}

export function readSeamusMonster(item: Item): SeamusMonsterData | null {
  const value = readSeamusToken(item);
  if (!value || value["type"] !== "MONSTER") return null;
  return {
    type: "MONSTER",
    name: typeof value["name"] === "string" ? value["name"] : item.name,
    gmOnly: value["gmOnly"] !== false,
    stamina: numberOr(value["stamina"], 0),
    staminaMaximum: numberOr(value["staminaMaximum"], 0),
    temporaryStamina: numberOr(value["temporaryStamina"], 0),
    statblockName: typeof value["statblockName"] === "string" ? value["statblockName"] : "",
    resourceId: typeof value["resourceId"] === "string" ? value["resourceId"] : "",
  };
}

export function readSeamusMinionGroupId(item: Item): string | null {
  const value = readSeamusToken(item);
  if (!value || value["type"] !== "MINION") return null;
  return typeof value["groupId"] === "string" ? value["groupId"] : null;
}

export function readMinionGroups(metadata: Metadata): SeamusMinionGroup[] {
  const value = metadata[SEAMUS_MINION_GROUPS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SeamusMinionGroup => {
    if (!isRecord(entry) || entry["type"] !== "MINION") return false;
    return (
      typeof entry["id"] === "string" &&
      entry["id"].length > 0 &&
      typeof entry["name"] === "string" &&
      typeof entry["currentStamina"] === "number" &&
      Number.isFinite(entry["currentStamina"]) &&
      typeof entry["individualStamina"] === "number" &&
      Number.isFinite(entry["individualStamina"])
    );
  });
}

/** Build a defined MONSTER payload while preserving temporary Stamina and any
    other keys a newer Seamus build may have added. */
export function monsterData(
  previous: Record<string, unknown> | null,
  next: {
    name: string;
    stamina: number;
    staminaMaximum: number;
    statblockName: string;
    resourceId: string;
  },
): SeamusMonsterData {
  return {
    ...previous,
    type: "MONSTER",
    name: next.name,
    gmOnly: previous?.["gmOnly"] !== false,
    stamina: Math.max(0, Math.round(next.stamina)),
    staminaMaximum: Math.max(0, Math.round(next.staminaMaximum)),
    temporaryStamina: numberOr(previous?.["temporaryStamina"], 0),
    statblockName: next.statblockName,
    resourceId: next.resourceId,
  } as SeamusMonsterData;
}

export function minionTokenData(groupId: string): SeamusMinionTokenData {
  return { type: "MINION", groupId };
}

export function upsertMinionGroup(
  groups: readonly SeamusMinionGroup[],
  next: SeamusMinionGroup,
): SeamusMinionGroup[] {
  const existing = groups.find((group) => group.id === next.id);
  if (!existing) return [...groups, next];
  return groups.map((group) =>
    group.id === next.id
      ? {
          ...group,
          ...next,
          // Keep an explicit gmOnly choice the GM already made in Seamus.
          gmOnly: group.gmOnly ?? next.gmOnly ?? true,
        }
      : group,
  );
}

export function removeMinionGroups(
  groups: readonly SeamusMinionGroup[],
  ids: readonly string[],
): SeamusMinionGroup[] {
  if (!ids.length) return [...groups];
  return groups.filter((group) => !ids.includes(group.id));
}

/**
 * Patch only targeted MINION entries inside Seamus's `monsterGroups` array,
 * preserving any non-MINION, draft, or newer-schema objects untouched.
 */
export function mergeRawMinionGroups(
  metadata: Metadata,
  nextMinionGroups: readonly SeamusMinionGroup[],
): unknown[] {
  const raw = metadata[SEAMUS_MINION_GROUPS_KEY];
  const existingRaw = Array.isArray(raw) ? raw : [];
  const nextById = new Map(nextMinionGroups.map((group) => [group.id, group]));
  const placed = new Set<string>();
  const merged: unknown[] = [];
  for (const entry of existingRaw) {
    if (
      isRecord(entry) &&
      entry["type"] === "MINION" &&
      typeof entry["id"] === "string" &&
      entry["id"].length > 0 &&
      typeof entry["name"] === "string" &&
      typeof entry["currentStamina"] === "number" &&
      Number.isFinite(entry["currentStamina"]) &&
      typeof entry["individualStamina"] === "number" &&
      Number.isFinite(entry["individualStamina"])
    ) {
      const replacement = nextById.get(entry["id"]);
      if (replacement) {
        merged.push(replacement);
        placed.add(entry["id"]);
      }
      continue;
    }
    // Preserve non-MINION or unrecognized Seamus entries intact.
    merged.push(entry);
  }
  for (const group of nextMinionGroups) {
    if (!placed.has(group.id)) merged.push(group);
  }
  return merged;
}

export async function writeMinionGroups(groups: readonly unknown[]): Promise<void> {
  await OBR.scene.setMetadata({ [SEAMUS_MINION_GROUPS_KEY]: groups });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
