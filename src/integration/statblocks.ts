import type { Monster } from "../types.ts";
import type { StatblockRef } from "../../shared/obr/protocol.ts";
import {
  STATBLOCK_INDEX,
  type IndexedStatblock,
} from "../../shared/obr/statblockIndex.generated.ts";

/**
 * Resolve a Malice/SteelCompendium monster to a Draw Steel Tools `resourceId`.
 *
 * The two applications read the same Draw Steel corpus through different
 * pipelines, so names usually agree but nothing guarantees it. This resolver
 * therefore never guesses silently:
 *
 * - an exact normalized name + printed level + compatible role is automatic;
 * - anything else is returned as `unresolved` with candidates for the GM;
 * - an explicit manual choice always wins and is cached.
 */

export interface StatblockResolution {
  ref: StatblockRef | null;
  /** A short human explanation, shown in diagnostics. */
  reason: string;
  confidence: number;
  candidates: IndexedStatblock[];
}

export type ManualStatblockMap = Readonly<Record<string, StatblockRef>>;

const ROLE_WORDS = new Set([
  "ambusher",
  "artillery",
  "brute",
  "controller",
  "defender",
  "harrier",
  "hexer",
  "leader",
  "minion",
  "mount",
  "solo",
  "elite",
  "horde",
  "platoon",
]);

/** NFKD, lowercase, punctuation-folded, whitespace-collapsed. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function statblockKey(name: string, level: number): string {
  return `${normalizeName(name)}|${level}`;
}

function roleTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => ROLE_WORDS.has(token));
}

function monsterRoles(m: Monster): string[] {
  return [
    ...new Set([
      ...roleTokens(m.organization),
      ...roleTokens(m.role),
      ...m.keywords.flatMap(roleTokens),
    ]),
  ];
}

interface PreindexedStatblock {
  raw: IndexedStatblock;
  normalizedName: string;
  roles: string[];
  normalizedRoles: Set<string>;
  normalizedAncestry: Set<string>;
}

const PREINDEXED: readonly PreindexedStatblock[] = STATBLOCK_INDEX.map((raw) => ({
  raw,
  normalizedName: normalizeName(raw.name),
  roles: [...new Set(raw.roles.flatMap(roleTokens))],
  normalizedRoles: new Set(raw.roles.map(normalizeName)),
  normalizedAncestry: new Set(raw.ancestry.map(normalizeName)),
}));

const BY_NORMALIZED_NAME = new Map<string, PreindexedStatblock[]>();
const BY_RESOURCE_ID = new Map<string, IndexedStatblock>();
for (const entry of PREINDEXED) {
  BY_RESOURCE_ID.set(entry.raw.id, entry.raw);
  const bucket = BY_NORMALIZED_NAME.get(entry.normalizedName) ?? [];
  bucket.push(entry);
  BY_NORMALIZED_NAME.set(entry.normalizedName, bucket);
}

function roleCompatibleIndexed(m: Monster, candidate: PreindexedStatblock): boolean {
  const wanted = monsterRoles(m);
  const offered = candidate.roles;
  if (!wanted.length || !offered.length) return true;
  return wanted.some((role) => offered.includes(role));
}

function ancestryCompatibleIndexed(m: Monster, candidate: PreindexedStatblock): boolean {
  if (!m.keywords.length || !candidate.normalizedAncestry.size) return true;
  for (const word of m.keywords) {
    if (candidate.normalizedAncestry.has(normalizeName(word))) return true;
  }
  return false;
}

/** Levenshtein distance, bounded enough for the small candidate set. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - editDistance(a, b) / longest;
}

function asRef(candidate: IndexedStatblock): StatblockRef {
  return { resourceId: candidate.id, name: candidate.name };
}

/** The printed level: a re-levelled Malice statblock still points at the book's page. */
export function printedLevel(m: Monster): number {
  return m.printed?.level ?? m.level;
}

export function candidatesFor(
  name: string,
  level: number,
  roles: string[] = [],
  ancestry: string[] = [],
  limit = 8,
): IndexedStatblock[] {
  const wanted = normalizeName(name);
  const wantedRoles = roles.map(normalizeName);
  const wantedAncestry = ancestry.map(normalizeName);
  const scored: { candidate: IndexedStatblock; score: number }[] = [];
  for (const entry of PREINDEXED) {
    const nameScore =
      entry.normalizedName === wanted ? 1 : similarity(entry.normalizedName, wanted);
    if (nameScore < 0.72) continue;
    const levelScore = entry.raw.level === level ? 0.2 : 0;
    const roleScore = wantedRoles.length
      ? wantedRoles.some((role) => entry.normalizedRoles.has(role))
        ? 0.1
        : -0.1
      : 0;
    const ancestryScore = wantedAncestry.length
      ? wantedAncestry.some((a) => entry.normalizedAncestry.has(a))
        ? 0.05
        : 0
      : 0;
    scored.push({
      candidate: entry.raw,
      score: nameScore + levelScore + roleScore + ancestryScore,
    });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.candidate.level - b.candidate.level,
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export interface ResolveOptions {
  manual?: ManualStatblockMap;
  /** Additional learned mappings from earlier successful imports. */
  learned?: ManualStatblockMap;
}

/** Fast hot-path lookup when only the resolved StatblockRef is needed (skips
 * fuzzy Levenshtein candidate ranking on unresolved monsters). */
export function resolveStatblockRef(m: Monster, options: ResolveOptions = {}): StatblockRef | null {
  const name = m.name;
  const level = printedLevel(m);
  const normalized = normalizeName(name);
  const key = `${normalized}|${level}`;
  const manual = options.manual?.[key] ?? options.manual?.[normalized];
  if (manual) return { ...manual };
  const learned = options.learned?.[key];
  if (learned) return { ...learned };

  const sameName = BY_NORMALIZED_NAME.get(normalized);
  if (!sameName) return null;
  const compatible = sameName.filter(
    (candidate) =>
      candidate.raw.level === level &&
      roleCompatibleIndexed(m, candidate) &&
      ancestryCompatibleIndexed(m, candidate),
  );
  return compatible.length === 1 ? asRef(compatible[0]!.raw) : null;
}

export function resolveStatblock(m: Monster, options: ResolveOptions = {}): StatblockResolution {
  const name = m.name;
  const level = printedLevel(m);
  const normalized = normalizeName(name);
  const key = `${normalized}|${level}`;
  const manual = options.manual?.[key] ?? options.manual?.[normalized];
  if (manual) {
    return {
      ref: { ...manual },
      reason: "Saved statblock mapping.",
      confidence: 1,
      candidates: [],
    };
  }
  const learned = options.learned?.[key];
  if (learned) {
    return {
      ref: { ...learned },
      reason: "Previously matched statblock.",
      confidence: 1,
      candidates: [],
    };
  }

  const sameName = BY_NORMALIZED_NAME.get(normalized) ?? [];
  const sameLevel = sameName.filter((candidate) => candidate.raw.level === level);
  const compatible = sameLevel.filter(
    (candidate) => roleCompatibleIndexed(m, candidate) && ancestryCompatibleIndexed(m, candidate),
  );

  if (compatible.length === 1) {
    return {
      ref: asRef(compatible[0]!.raw),
      reason: "Exact name and level.",
      confidence: 1,
      candidates: [],
    };
  }

  if (compatible.length > 1) {
    return {
      ref: null,
      reason: "Several statblocks share this name and level.",
      confidence: 0,
      candidates: compatible.map((entry) => entry.raw),
    };
  }

  // The right name at another level is almost always a re-levelled statblock,
  // but "almost always" is not enough to write a resource id into a token.
  const allCandidates = candidatesFor(name, level, monsterRoles(m), m.keywords);
  return {
    ref: null,
    reason: sameName.length
      ? "That name exists, but not at this level or with this role."
      : "No exact statblock match.",
    confidence: 0,
    candidates: allCandidates,
  };
}

/** Validate a manual/learned mapping against the bundled index. */
export function isKnownStatblock(ref: StatblockRef): boolean {
  return BY_RESOURCE_ID.has(ref.resourceId);
}

export function statblockIndexForResource(resourceId: string): IndexedStatblock | undefined {
  return BY_RESOURCE_ID.get(resourceId);
}
