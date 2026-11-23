import type { CatalogEntry, Monster } from "../types.ts";
import { familyLabel, fmt } from "./text.ts";

export interface NumberRange {
  min: number;
  max: number;
}

export interface ParsedQuery {
  words: string[];
  level: NumberRange | null;
  ev: NumberRange | null;
}

export interface CatalogMatch {
  entry: CatalogEntry;
  score: number;
  nameHits: string[];
  /** When the match landed on an ability rather than the monster's name. */
  hit?: string;
}

const NUM = String.raw`(\d+)`;

function parseRangeToken(raw: string): NumberRange | null {
  let m: RegExpMatchArray | null;
  if ((m = raw.match(new RegExp(`^${NUM}$`)))) {
    const v = Number(m[1]);
    return { min: v, max: v };
  }
  if ((m = raw.match(new RegExp(`^${NUM}[-–]${NUM}$`)))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  if ((m = raw.match(new RegExp(`^(<=|≤|<)${NUM}$`)))) {
    const v = Number(m[2]);
    return { min: 0, max: m[1] === "<" ? v - 1 : v };
  }
  if ((m = raw.match(new RegExp(`^(>=|≥|>)${NUM}$`)))) {
    const v = Number(m[2]);
    return { min: m[1] === ">" ? v + 1 : v, max: Infinity };
  }
  if ((m = raw.match(new RegExp(`^${NUM}\\+$`)))) {
    return { min: Number(m[1]), max: Infinity };
  }
  return null;
}

/**
 * Pulls inline level and EV constraints out of the search query:
 * - Level: `3`, `lv 3`, `lv3`, `level 2-4`, `<=2`, `5+`
 * - EV: `ev 8`, `ev8`, `ev<=12`, `ev 4-16`, `ev>=20`, `ev 12+`
 * Everything else stays as required search words.
 */
export function parseQuery(query: string): ParsedQuery {
  const normalized = query
    .toLowerCase()
    .replace(/\b(?:level|lvl|lv)\s+(?=[\d<>≤≥])/g, "lv")
    .replace(/\bev\s+(?=[\d<>≤≥])/g, "ev");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  let level: NumberRange | null = null;
  let ev: NumberRange | null = null;
  const words: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("ev") && token.length > 2) {
      const parsed = parseRangeToken(token.slice(2));
      if (parsed) {
        ev = parsed;
        continue;
      }
    }
    const strippedLevel = token.replace(/^(?:level|lvl|lv|l)(?=[\d<>≤≥])/, "");
    const parsedLevel = parseRangeToken(strippedLevel);
    if (parsedLevel && (strippedLevel !== token || /^[\d<>≤≥]/.test(token))) {
      level = parsedLevel;
      continue;
    }
    words.push(token);
  }
  return { words, level, ev };
}

export function describeRange(label: string, range: NumberRange): string {
  if (range.max === Infinity) return `${label} ${fmt(range.min)}+`;
  if (range.min <= 0 && range.max >= 0) return `${label} ≤ ${fmt(range.max)}`;
  if (range.min === range.max) return `${label} ${fmt(range.min)}`;
  return `${label} ${fmt(range.min)}–${fmt(range.max)}`;
}

export function inRange(value: number, range: NumberRange | null): boolean {
  if (!range) return true;
  return value >= range.min && value <= range.max;
}

/** Whether adding one default unit (one creature, or one default minion set)
    keeps total encounter EV within `remainingEv`. */
export function fitsEvBudget(monster: Monster, remainingEv: number): boolean {
  const unitEv = monster.ev * Math.max(1, monster.defaultQty);
  return unitEv <= remainingEv + 1e-6;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreWord(
  entry: CatalogEntry,
  word: string,
): { score: number; name: boolean; hit?: string } | null {
  const m = entry.monster;
  const name = (m?.name || entry.derivedName).toLowerCase();
  if (name.startsWith(word)) return { score: 100, name: true };
  const start = new RegExp(`\\b${escapeRegExp(word)}`);
  if (start.test(name)) return { score: 80, name: true };
  if (name.includes(word)) return { score: 60, name: true };

  const family = familyLabel(m?.familyPath || entry.familyPath).toLowerCase();
  if (family.includes(word) || entry.familyPath.toLowerCase().includes(word)) {
    return { score: 40, name: false };
  }

  if (m) {
    const meta = [m.organization, m.role, String(m.size), ...m.keywords].join(" ").toLowerCase();
    if (meta.includes(word)) return { score: 30, name: false };

    for (const feature of m.features) {
      const featureName = (feature.name || "").trim();
      if (featureName && featureName.toLowerCase().includes(word)) {
        return { score: 25, name: false, hit: featureName };
      }
    }

    // Prose matches only at word starts so "or" doesn't hit "for".
    for (const feature of m.features) {
      const featureName = (feature.name || "").trim() || "Ability";
      const trigger = feature.trigger || "";
      if (trigger && start.test(trigger.toLowerCase())) {
        return { score: 10, name: false, hit: featureName };
      }
      for (const effect of feature.effects ?? []) {
        const prose = [effect.effect, effect.tier1, effect.tier2, effect.tier3]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (prose && start.test(prose)) {
          return { score: 10, name: false, hit: featureName };
        }
      }
    }
  } else if (entry.slug.toLowerCase().includes(word)) {
    return { score: 35, name: false };
  }

  return null;
}

/**
 * Matches a catalog entry against a parsed query.
 * Every word must land somewhere; inline level/EV ranges require the hydrated monster.
 */
export function matchCatalogEntry(entry: CatalogEntry, query: ParsedQuery): CatalogMatch | null {
  if (query.level || query.ev) {
    if (!entry.monster) return null;
    if (!inRange(entry.monster.level, query.level)) return null;
    if (!inRange(entry.monster.ev, query.ev)) return null;
  }
  if (!query.words.length) {
    return { entry, score: 0, nameHits: [] };
  }
  let score = 0;
  const nameHits: string[] = [];
  let hit: string | undefined;
  for (const word of query.words) {
    const found = scoreWord(entry, word);
    if (!found) return null;
    score += found.score;
    if (found.name) nameHits.push(word);
    else if (found.hit && !hit) hit = found.hit;
  }
  return {
    entry,
    score,
    nameHits,
    ...(nameHits.length === query.words.length ? {} : hit ? { hit } : {}),
  };
}

/** Splits a monster name into plain and matched character runs for highlighting. */
export function highlightName(name: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length) return [{ text: name, hit: false }];
  const lower = name.toLowerCase();
  const marks = Array.from({ length: name.length }, () => false);
  for (const word of words) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(word, from);
      if (at < 0) break;
      marks.fill(true, at, at + word.length);
      from = at + word.length;
    }
  }
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < name.length; i += 1) {
    const prev = runs[runs.length - 1];
    if (prev && prev.hit === marks[i]) prev.text += name[i];
    else runs.push({ text: name[i]!, hit: Boolean(marks[i]) });
  }
  return runs;
}
