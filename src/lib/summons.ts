import type { CatalogEntry, CombatInstance, FeatureEffect, Monster, MonsterFeature } from "../types.ts";
import { WORD_NUMBERS, plainText } from "./text.ts";

/** One creature an ability can bring onto the board: `count` of the statblock
    at `path`, paying `malice` when the price belongs to the creature itself
    (a rival summoner's minions each print their own). */
export interface SummonOption {
  path: string;
  name: string;
  count: number;
  malice: number;
}

/** One summoning line of an ability. Its options are alternatives ("four
    elemental motes or four soot crows"); `lead` names the tier it sits in,
    when it only happens on one. */
export interface SummonChoice {
  lead: string;
  options: SummonOption[];
}

/** Sentences that put creatures on the board, and ones that forbid it. */
const SUMMON_RE = /\b(appears?|summons?|summoned|burst forth)\b/i;
const NO_SUMMON_RE = /\b(can't|cannot|can not)\b[^.]*\bsummon/i;
/** A rival summoner's Call Forth: its minions are listed with their price. */
const PRICE_LIST_RE = /\blisted number of minions\b/i;
/** A minion's own price: "2 Malice for two minions", "1 Malice per minion
    summoned". */
const PRICE_RE = /^(\d+)\s*Malice (?:for (\w+) minions?|per minion\b)/i;
const MAX_NAME_WORDS = 5;

/** What may follow a creature's name in prose, so "zombie mines" is not a
    zombie: punctuation, or one of these. */
const AFTER_NAME = new Set(
  "appear appears or and into in at within anywhere burst that who each to from instead also on , ; . )".split(" "),
);

const COUNTS: Record<string, number> = { a: 1, an: 1, ...WORD_NUMBERS, eleven: 11, twelve: 12 };

function words(text: string): string[] {
  return plainText(text)
    .toLowerCase()
    .replace(/[,;.)]/g, " $& ")
    .replace(/[^a-z0-9\s,;.)]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The ways prose names a statblock: "goblin runner", "goblin runners",
    "harpies", "wolves". */
function nameForms(slug: string): string[] {
  const parts = slug.toLowerCase().split("-").filter(Boolean);
  const last = parts.pop();
  if (!last) return [];
  const stem = parts.length ? `${parts.join(" ")} ` : "";
  const plurals = [`${last}s`, `${last}es`];
  if (/[^aeiou]y$/.test(last)) plurals.push(`${last.slice(0, -1)}ies`);
  if (/fe?$/.test(last)) plurals.push(`${last.replace(/fe?$/, "")}ves`);
  return [last, ...plurals].map((form) => stem + form);
}

/** Catalog entries by every form of their name, built once per catalog. */
let indexed: readonly CatalogEntry[] | null = null;
let byForm = new Map<string, CatalogEntry[]>();

function nameIndex(entries: readonly CatalogEntry[]): Map<string, CatalogEntry[]> {
  if (indexed === entries) return byForm;
  byForm = new Map();
  for (const entry of entries) {
    for (const form of nameForms(entry.slug)) {
      const list = byForm.get(form);
      if (list) list.push(entry);
      else byForm.set(form, [entry]);
    }
  }
  indexed = entries;
  return byForm;
}

/** Of several statblocks by one name, the summoner's own: the one filed
    closest to it (a rival summoner's skeletons sit under its echelon), then
    the nearest in level. */
function closest(summoner: Monster, candidates: CatalogEntry[], level: (path: string) => number | undefined) {
  const home = summoner.familyPath.split("/");
  const shared = (entry: CatalogEntry) => {
    const parts = entry.familyPath.split("/");
    let n = 0;
    while (n < parts.length && parts[n] === home[n]) n += 1;
    return n;
  };
  const gap = (entry: CatalogEntry) => Math.abs((level(entry.path) ?? summoner.level) - summoner.level);
  return [...candidates].sort((a, b) => shared(b) - shared(a) || gap(a) - gap(b))[0];
}

interface Mention {
  entry: CatalogEntry;
  count: number;
}

/** Statblocks named in one sentence, each with the count printed before it:
    "one mummy or four ghoul cravers". A name without its own count takes the
    count before the first name ("four level 1 demon minions (most commonly
    ensnarers, frenzieds, and pitlings)"). A number after "level" is not a
    count. */
function mentions(sentence: string, summoner: Monster, entries: readonly CatalogEntry[], level: (path: string) => number | undefined): Mention[] {
  const index = nameIndex(entries);
  const tokens = words(sentence);
  const countAt = (i: number) => {
    const token = tokens[i] ?? "";
    if (tokens[i - 1] === "level") return 0;
    return Number(token) || COUNTS[token] || 0;
  };
  let first = 0;
  const found: Mention[] = [];
  let since = 0;
  for (let i = 0; i < tokens.length; ) {
    let hit: { entries: CatalogEntry[]; length: number } | null = null;
    for (let length = Math.min(MAX_NAME_WORDS, tokens.length - i); length > 0 && !hit; length -= 1) {
      const list = index.get(tokens.slice(i, i + length).join(" "));
      const others = list?.filter((entry) => entry.path !== summoner.path);
      const next = tokens[i + length];
      if (others?.length && (next === undefined || AFTER_NAME.has(next))) hit = { entries: others, length };
    }
    if (!hit) {
      i += 1;
      continue;
    }
    let count = 0;
    for (let j = i - 1; j >= since && !count; j -= 1) count = countAt(j);
    if (!found.length) first = count;
    const entry = closest(summoner, hit.entries, level);
    if (entry && !found.some((item) => item.entry.path === entry.path)) found.push({ entry, count: count || first || 1 });
    i += hit.length;
    since = i;
  }
  return found;
}

function effectTexts(effect: FeatureEffect): { lead: string; text: string }[] {
  return [
    { lead: "", text: effect.effect ?? "" },
    { lead: "≤11", text: effect.tier1 ?? "" },
    { lead: "12–16", text: effect.tier2 ?? "" },
    { lead: "17+", text: effect.tier3 ?? "" },
  ].filter((item) => item.text);
}

/** A minion's printed price, as the Malice it costs and the minions it buys. */
export function minionPrice(m: Monster | undefined): { malice: number; count: number } | null {
  const match = PRICE_RE.exec(String(m?.raw.cost ?? "").trim());
  if (!match?.[1]) return null;
  const count = match[2] ? Number(match[2]) || COUNTS[match[2].toLowerCase()] || 0 : 1;
  return count ? { malice: Number(match[1]), count } : null;
}

/**
 * The creatures an ability brings onto the board, read from its prose: every
 * sentence that makes something appear or summons it, matched against the
 * statblock names in the catalog. `statblock` reads a loaded statblock, for
 * a price list's prices and for telling apart same-named statblocks by level.
 */
export function featureSummons(
  summoner: Monster,
  feature: MonsterFeature,
  entries: readonly CatalogEntry[],
  statblock: (path: string) => Monster | undefined,
): SummonChoice[] {
  const level = (path: string) => statblock(path)?.level;
  const choices: SummonChoice[] = [];
  for (const effect of feature.effects ?? []) {
    for (const { lead, text } of effectTexts(effect)) {
      if (PRICE_LIST_RE.test(text)) {
        const home = `${summoner.familyPath}/`;
        const options = entries
          .filter((entry) => entry.familyPath.startsWith(home) && /\bminion\b/.test(entry.familyPath))
          .map((entry): SummonOption => {
            const m = statblock(entry.path);
            const price = minionPrice(m);
            return { path: entry.path, name: m?.name ?? entry.derivedName, count: price?.count ?? 1, malice: price?.malice ?? 0 };
          });
        if (options.length) choices.push({ lead, options });
        continue;
      }
      for (const sentence of text.split(/(?<=[.;])\s+/)) {
        if (!SUMMON_RE.test(sentence) || NO_SUMMON_RE.test(sentence)) continue;
        const options = mentions(sentence, summoner, entries, level).map(
          ({ entry, count }): SummonOption => ({
            path: entry.path,
            name: statblock(entry.path)?.name ?? entry.derivedName,
            count,
            malice: 0,
          }),
        );
        if (options.length) choices.push({ lead, options });
      }
    }
  }
  return choices;
}

/** A summoner's own command limits: how many squads of minions they command
    at once, how many minions each holds, and which minions are their
    signature ones, of which only one squad may stand at a time. */
export interface SquadRules {
  squads: number;
  perSquad: number;
  signature: string[];
}

/** "The summoner can command up to two squads of minions with a maximum of 6
    minions per squad." */
const COMMAND_RE = /\bcommand up to (\w+) squads? of minions with a maximum of (\w+) minions? per squad/i;
/** "They can only have one squad of signature minions active at any time." */
const SIGNATURE_RE = /\bone squad of signature minions\b/i;

function countWord(word: string | undefined): number {
  return Number(word) || COUNTS[String(word).toLowerCase()] || 0;
}

/**
 * The squad limits a summoner prints, or null when it prints none (and the
 * book's squads of eight apply, as many as it likes). Its signature minions
 * are the ones its trait makes appear beside that rule ("up to three
 * skeletons appear").
 */
export function squadRules(
  summoner: Monster,
  entries: readonly CatalogEntry[],
  statblock: (path: string) => Monster | undefined,
): SquadRules | null {
  const level = (path: string) => statblock(path)?.level;
  for (const feature of summoner.features) {
    const texts = (feature.effects ?? []).flatMap(effectTexts).map(({ text }) => plainText(text));
    const rule = texts.map((text) => COMMAND_RE.exec(text)).find(Boolean);
    if (!rule) continue;
    const squads = countWord(rule[1]);
    const perSquad = countWord(rule[2]);
    if (!squads || !perSquad) continue;
    const signature = texts.some((text) => SIGNATURE_RE.test(text))
      ? texts
          .filter((text) => !COMMAND_RE.test(text))
          .flatMap((text) => text.split(/(?<=[.;])\s+/))
          .filter((sentence) => SUMMON_RE.test(sentence) && !NO_SUMMON_RE.test(sentence))
          .flatMap((sentence) => mentions(sentence, summoner, entries, level).map(({ entry }) => entry.path))
      : [];
    return { squads, perSquad, signature: [...new Set(signature)] };
  }
  return null;
}

/** Where summoned minions go: `top` grows a standing squad to `size`
    minions, each `fresh` entry is a new squad of that many, and `dropped`
    ones find no room under the summoner's limits. */
export interface SummonPlan {
  top: { id: string; size: number }[];
  fresh: number[];
  dropped: number;
}

/**
 * Deal `count` minions of the statblock at `path` into the squads of the
 * summoner `summonerId`: first into their standing squads of that statblock
 * with room, then into new squads while the summoner may command more. With
 * no `rules`, squads hold `fallback` and there is no limit on how many.
 * `living` reads how many of a squad's minions still stand.
 */
export function planSummon(
  instances: readonly CombatInstance[],
  summonerId: string,
  path: string,
  count: number,
  rules: SquadRules | null,
  fallback: number,
  living: (squad: CombatInstance) => number,
): SummonPlan {
  const cap = rules?.perSquad ?? fallback;
  const own = instances.filter(
    (item) => item.kind === "minion-squad" && item.summonedBy === summonerId && item.currentStamina > 0,
  );
  const plan: SummonPlan = { top: [], fresh: [], dropped: 0 };
  let left = count;
  for (const squad of own) {
    if (!left || squad.sourcePath !== path) continue;
    const alive = living(squad);
    const add = Math.min(left, cap - alive);
    if (add <= 0) continue;
    plan.top.push({ id: squad.id, size: alive + add });
    left -= add;
  }
  let room = rules ? Math.max(0, rules.squads - own.length) : Infinity;
  if (rules?.signature.includes(path)) {
    room = own.some((squad) => rules.signature.includes(squad.sourcePath)) ? 0 : Math.min(room, 1);
  }
  for (; left > 0 && room > 0; room -= 1) {
    const size = Math.min(left, cap);
    plan.fresh.push(size);
    left -= size;
  }
  plan.dropped = left;
  return plan;
}
