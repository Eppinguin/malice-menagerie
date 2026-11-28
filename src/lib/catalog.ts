import { HERO_SIDE_FAMILY_RE, STATBLOCK_RE, sourceUrl } from "./repo.ts";
import { familyLabel, numberFrom, parseEv, slugToLabel, WORD_NUMBERS } from "./text.ts";
import { isRecord } from "../types.ts";
import type { CatalogEntry, Monster, MonsterFeature, RawStatblock } from "../types.ts";

function normalizeFeatures(value: unknown): MonsterFeature[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as MonsterFeature[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

/** "The lich can take two turns each round" / "Ajax takes up to three turns
    each round": every solo states its turns in this one sentence. */
const TURNS_RE = /\b(?:can take|takes?)(?: up to)? (\w+) turns each round\b/i;

export function turnsPerRound(features: readonly MonsterFeature[]): number {
  for (const feature of features) {
    for (const effect of feature.effects ?? []) {
      const word = TURNS_RE.exec(effect.effect ?? "")?.[1]?.toLowerCase();
      const turns = word ? Number(word) || WORD_NUMBERS[word] : 0;
      if (turns && turns > 1) return turns;
    }
  }
  return 1;
}

export function buildCatalogEntry(path: string): CatalogEntry | null {
  const match = path.match(STATBLOCK_RE);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  if (HERO_SIDE_FAMILY_RE.test(match[2])) return null;
  return {
    path,
    book: match[1],
    familyPath: match[2],
    slug: match[3],
    derivedName: slugToLabel(match[3]),
    monster: null,
    error: false,
  };
}

export function normalizeMonster(raw: RawStatblock, path: string): Monster {
  const match = path.match(STATBLOCK_RE);
  const organization = typeof raw.organization === "string" ? raw.organization : "";
  const ev = parseEv(raw.ev, organization);
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean).map(String) : [];
  const familyPath = match?.[2] || "";
  const features = normalizeFeatures(raw.features);
  return {
    id: path,
    path,
    book: match?.[1] || "",
    familyPath,
    slug: match?.[3] || "",
    name: raw.name || slugToLabel(match?.[3] || ""),
    level: numberFrom(raw.level, 0),
    organization: organization || "—",
    role: raw.role || "",
    ev: ev.unit,
    evLabel: ev.label,
    defaultQty: ev.suggestedQty,
    keywords,
    ancestry: keywords.join(", ") || familyLabel(familyPath),
    size: raw.size ?? "—",
    speed: raw.speed ?? "—",
    stamina: Math.max(0, numberFrom(raw.stamina, 0)),
    stability: raw.stability ?? "—",
    freeStrike: raw.free_strike ?? raw.freeStrike ?? "—",
    movement: raw.movement && raw.movement !== "—" ? raw.movement : "",
    immunities: stringList(raw.immunities),
    weaknesses: stringList(raw.weaknesses),
    withCaptain: raw.with_captain?.trim() || "",
    turnsPerRound: turnsPerRound(features),
    chars: {
      M: raw.might ?? 0,
      A: raw.agility ?? 0,
      R: raw.reason ?? 0,
      I: raw.intuition ?? 0,
      P: raw.presence ?? 0,
    },
    features,
    source: sourceUrl(path),
    raw,
  };
}
