import { sourceRef } from "./repo.ts";
import type {
  CatalogEntry,
  ConditionEntry,
  FeatureEffect,
  MaliceFeature,
  MonsterFeature,
} from "../types.ts";

export interface CompendiumTerm {
  label: string;
  href: string;
  category: string;
  count: number;
}

const MARKDOWN_LINK_GLOBAL_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SCC_LINK_RE = /\[([^\]]+)\]\((scc\.v\d+:[^)\s]+)\)/gi;

/**
 * Strip raw `[label](scc.v1:...)` internal compendium URIs back to readable
 * Draw Steel prose for user-facing editor inputs, leaving non-scc markdown intact.
 */
export function stripCompendiumLinks(text: string): string {
  if (!text || !text.includes("scc.v")) return text;
  return text.replace(SCC_LINK_RE, "$1");
}

export function stripCompendiumLinksFromEffects(
  effects: readonly FeatureEffect[] | undefined,
): FeatureEffect[] {
  if (!effects?.length) return [];
  return effects.map((eff): FeatureEffect => {
    const copy: FeatureEffect = { ...eff };
    for (const key of ["tier1", "tier2", "tier3", "effect"] as const) {
      const val = copy[key];
      if (val) copy[key] = stripCompendiumLinks(val);
    }
    return copy;
  });
}

export function stripCompendiumLinksFromFeature(feature: MonsterFeature): MonsterFeature {
  const next: MonsterFeature = { ...feature };
  if (next.trigger) next.trigger = stripCompendiumLinks(next.trigger);
  if (next.effects?.length) {
    next.effects = stripCompendiumLinksFromEffects(next.effects);
  }
  return next;
}

export function termCategoryFromHref(href: string): string {
  const body = /^scc\.v\d+:(.+)$/i.exec(href)?.[1] ?? "";
  const ns = (body.split("/")[1] ?? "").toLowerCase();
  if (ns === "condition" || ns.startsWith("condition.")) return "Condition";
  if (ns === "movement" || ns.startsWith("movement.")) return "Movement";
  if (ns.includes("combat")) return "Combat";
  if (ns.includes("damage")) return "Damage";
  if (ns.includes("ability") || ns.includes("action")) return "Action";
  return "Rule";
}

export const BUILTIN_COMPENDIUM_TERMS: readonly CompendiumTerm[] = [
  {
    label: "bleeding",
    href: "scc.v1:mcdm.heroes.v1/condition/bleeding",
    category: "Condition",
    count: 50,
  },
  {
    label: "dazed",
    href: "scc.v1:mcdm.heroes.v1/condition/dazed",
    category: "Condition",
    count: 50,
  },
  {
    label: "frightened",
    href: "scc.v1:mcdm.heroes.v1/condition/frightened",
    category: "Condition",
    count: 50,
  },
  {
    label: "grabbed",
    href: "scc.v1:mcdm.heroes.v1/condition/grabbed",
    category: "Condition",
    count: 50,
  },
  {
    label: "prone",
    href: "scc.v1:mcdm.heroes.v1/condition/prone",
    category: "Condition",
    count: 50,
  },
  {
    label: "restrained",
    href: "scc.v1:mcdm.heroes.v1/condition/restrained",
    category: "Condition",
    count: 50,
  },
  {
    label: "slowed",
    href: "scc.v1:mcdm.heroes.v1/condition/slowed",
    category: "Condition",
    count: 50,
  },
  {
    label: "taunted",
    href: "scc.v1:mcdm.heroes.v1/condition/taunted",
    category: "Condition",
    count: 50,
  },
  {
    label: "weakened",
    href: "scc.v1:mcdm.heroes.v1/condition/weakened",
    category: "Condition",
    count: 50,
  },
  {
    label: "forced movement",
    href: "scc.v1:mcdm.heroes.v1/movement/forced-movement",
    category: "Movement",
    count: 40,
  },
  {
    label: "push",
    href: "scc.v1:mcdm.heroes.v1/movement/forced-movement",
    category: "Movement",
    count: 40,
  },
  {
    label: "pull",
    href: "scc.v1:mcdm.heroes.v1/movement/forced-movement",
    category: "Movement",
    count: 40,
  },
  {
    label: "slide",
    href: "scc.v1:mcdm.heroes.v1/movement/forced-movement",
    category: "Movement",
    count: 40,
  },
  {
    label: "adjacent",
    href: "scc.v1:mcdm.heroes.v1/rule.combat/adjacent",
    category: "Combat",
    count: 40,
  },
];

/**
 * Words too generic to wrap blindly during 1-tap Auto-link (users can still
 * link them manually via inline `[` autocomplete or the Link rule picker).
 */
const AUTO_LINK_SKIP = new Set([
  "damage",
  "turn",
  "turns",
  "round",
  "rounds",
  "target",
  "targets",
  "enemy",
  "enemies",
  "ally",
  "allies",
  "creature",
  "creatures",
  "object",
  "objects",
  "square",
  "squares",
  "area",
  "size",
  "speed",
  "level",
  "power",
  "roll",
  "action",
  "actions",
  "effect",
  "effects",
  "move",
  "moves",
  "moved",
  "moving",
  "attack",
  "strike",
  "strikes",
  "distance",
  "range",
  "ranged",
  "melee",
  "line",
  "burst",
  "cube",
  "wall",
  "self",
  "special",
  "might",
  "agility",
  "reason",
  "intuition",
  "presence",
  "stamina",
  "malice",
  "weapon",
  "magic",
  "fire",
  "cold",
  "acid",
  "poison",
  "holy",
  "sonic",
  "psychic",
  "lightning",
  "corruption",
]);

function harvestFromText(
  text: string | undefined,
  counts: Map<string, Map<string, { label: string; count: number }>>,
): void {
  if (!text || !text.includes("scc.v")) return;
  SCC_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCC_LINK_RE.exec(text)) !== null) {
    const label = (match[1] ?? "").trim();
    const href = (match[2] ?? "").trim();
    if (!label || label.length < 3 || label.length > 38) continue;
    const ref = sourceRef(href);
    if (!ref) continue;
    // Skip monster cross-references so monster names are not harvested into rule auto-linking.
    if (ref.path.includes("/monster/")) continue;
    const key = label.toLowerCase();
    let byHref = counts.get(key);
    if (!byHref) {
      byHref = new Map();
      counts.set(key, byHref);
    }
    const existing = byHref.get(href);
    if (existing) {
      existing.count += 1;
    } else {
      byHref.set(href, { label, count: 1 });
    }
  }
}

/**
 * Build a verified Compendium glossary by combining built-in core Draw Steel
 * links, loaded Condition entries, and every real `[label](scc.v1:...)` link
 * harvested from hydrated official SteelCompendium statblocks & Malice.
 */
export function buildCompendiumGlossary(
  entries: readonly CatalogEntry[],
  malice: readonly MaliceFeature[],
  conditions: readonly ConditionEntry[] = [],
): CompendiumTerm[] {
  const counts = new Map<string, Map<string, { label: string; count: number }>>();

  for (const entry of entries) {
    const m = entry.monster;
    if (!m || m.isHomebrew) continue;
    for (const f of m.features) {
      harvestFromText(f.trigger, counts);
      for (const eff of f.effects ?? []) {
        harvestFromText(eff.tier1, counts);
        harvestFromText(eff.tier2, counts);
        harvestFromText(eff.tier3, counts);
        harvestFromText(eff.effect, counts);
      }
    }
  }

  for (const feature of malice) {
    if (feature.isHomebrew) continue;
    for (const eff of feature.effects ?? []) {
      harvestFromText(eff.tier1, counts);
      harvestFromText(eff.tier2, counts);
      harvestFromText(eff.tier3, counts);
      harvestFromText(eff.effect, counts);
    }
  }

  const byKey = new Map<string, CompendiumTerm>();

  // Harvested official links first (exact live-verified URIs)
  for (const [key, byHref] of counts.entries()) {
    let bestHref = "";
    let bestLabel = "";
    let bestCount = -1;
    for (const [href, info] of byHref.entries()) {
      if (info.count > bestCount) {
        bestHref = href;
        bestLabel = info.label;
        bestCount = info.count;
      }
    }
    if (bestHref) {
      byKey.set(key, {
        label: bestLabel,
        href: bestHref,
        category: termCategoryFromHref(bestHref),
        count: bestCount,
      });
    }
  }

  // Condition catalog entries
  for (const cond of conditions) {
    const key = cond.name.trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    const slug = cond.slug || key.replace(/\s+/g, "-");
    const href = `scc.v1:mcdm.heroes.v1/condition/${slug}`;
    if (sourceRef(href)) {
      byKey.set(key, {
        label: cond.name.toLowerCase(),
        href,
        category: "Condition",
        count: 45,
      });
    }
  }

  // Built-in core offline fallbacks
  for (const term of BUILTIN_COMPENDIUM_TERMS) {
    const key = term.label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, term);
  }

  return [...byKey.values()].sort((a, b) => {
    const aCond = a.category === "Condition" ? 0 : 1;
    const bCond = b.category === "Condition" ? 0 : 1;
    return aCond - bCond || b.count - a.count || a.label.localeCompare(b.label);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAutoLinkableTerm(term: CompendiumTerm): boolean {
  const low = term.label.toLowerCase();
  if (low.length < 4) return false;
  if (AUTO_LINK_SKIP.has(low)) return false;
  return term.category === "Condition" || term.category === "Movement" || term.count >= 2;
}

export interface InlineRuleTrigger {
  kind: "explicit" | "word";
  start: number;
  end: number;
  query: string;
}

function isInsideCompletedLink(value: string, cursor: number): boolean {
  MARKDOWN_LINK_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK_GLOBAL_RE.exec(value)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (cursor > start && cursor <= end) return true;
    if (start > cursor) break;
  }
  return false;
}

/**
 * Detect either an explicit Notion-style rule trigger (`@query`, `[query`,
 * `[[query`) OR a passive Draw Steel rule/condition prefix being typed naturally
 * at the caret (e.g. "frig" -> frightened, "forced mov" -> forced movement).
 */
export function detectRuleTrigger(
  value: string,
  cursor: number,
  glossary: readonly CompendiumTerm[],
): InlineRuleTrigger | null {
  if (cursor < 0 || cursor > value.length) return null;
  if (isInsideCompletedLink(value, cursor)) return null;

  const before = value.slice(0, cursor);

  // 1. Explicit triggers: @query, [[query, or [query
  const explicitMatch = /(?:^|[\s(,;:])(@|\[{1,2})([^[\]()\n]{0,28})$/.exec(before);
  if (explicitMatch?.[1] !== undefined && explicitMatch[2] !== undefined) {
    const marker = explicitMatch[1];
    const query = explicitMatch[2];
    const start = cursor - marker.length - query.length;
    return { kind: "explicit", start, end: cursor, query };
  }

  // 2. Smart passive word trigger (check 2-word phrase first, then single active word)
  const twoWordMatch = /(?:^|[\s(,;:"'])([A-Za-z][A-Za-z-]{2,}\s+[A-Za-z][A-Za-z-]{1,})$/.exec(
    before,
  );
  if (twoWordMatch?.[1]) {
    const phrase = twoWordMatch[1];
    const low = phrase.toLowerCase();
    const hasPrefix = glossary.some(
      (term) => isAutoLinkableTerm(term) && term.label.toLowerCase().startsWith(low),
    );
    if (hasPrefix) {
      return { kind: "word", start: cursor - phrase.length, end: cursor, query: phrase };
    }
  }

  const wordMatch = /(?:^|[\s(,;:"'])([A-Za-z][A-Za-z-]{2,})$/.exec(before);
  if (wordMatch?.[1]) {
    const word = wordMatch[1];
    const low = word.toLowerCase();
    const hasPrefix = glossary.some(
      (term) => isAutoLinkableTerm(term) && term.label.toLowerCase().startsWith(low),
    );
    if (hasPrefix) {
      return { kind: "word", start: cursor - word.length, end: cursor, query: word };
    }
  }

  return null;
}

export function matchGlossaryTerms(
  glossary: readonly CompendiumTerm[],
  query: string,
  kind: "explicit" | "word" = "explicit",
  limit = 12,
): CompendiumTerm[] {
  const q = query.trim().toLowerCase();
  const pool = kind === "word" ? glossary.filter(isAutoLinkableTerm) : glossary;
  if (!q) return pool.slice(0, limit);

  const exact: CompendiumTerm[] = [];
  const prefix: CompendiumTerm[] = [];
  const sub: CompendiumTerm[] = [];
  for (const term of pool) {
    const low = term.label.toLowerCase();
    const cat = term.category.toLowerCase();
    if (low === q) exact.push(term);
    else if (low.startsWith(q)) prefix.push(term);
    else if (kind === "explicit" && (low.includes(q) || cat.includes(q))) sub.push(term);
  }
  return [...exact, ...prefix, ...sub].slice(0, limit);
}

export interface CompendiumTextSegment {
  text: string;
  term?: CompendiumTerm;
}

interface CompiledGlossaryMatcher {
  patternSource: string;
  byLower: Map<string, CompendiumTerm>;
}

const compiledGlossaryCache = new WeakMap<
  readonly CompendiumTerm[],
  CompiledGlossaryMatcher | null
>();

function getCompiledMatcher(glossary: readonly CompendiumTerm[]): CompiledGlossaryMatcher | null {
  if (compiledGlossaryCache.has(glossary)) {
    return compiledGlossaryCache.get(glossary) ?? null;
  }
  const candidates = glossary
    .filter(isAutoLinkableTerm)
    .sort((a, b) => b.label.length - a.label.length);
  if (!candidates.length) {
    compiledGlossaryCache.set(glossary, null);
    return null;
  }
  const byLower = new Map<string, CompendiumTerm>();
  for (const term of candidates) {
    const low = term.label.toLowerCase();
    if (!byLower.has(low)) byLower.set(low, term);
  }
  const matcher: CompiledGlossaryMatcher = {
    patternSource: `(?<![A-Za-z0-9_-])(${[...byLower.keys()].map(escapeRegExp).join("|")})(?![A-Za-z0-9_-])`,
    byLower,
  };
  compiledGlossaryCache.set(glossary, matcher);
  return matcher;
}

/**
 * Split plain editor text into alternating plain and auto-linkable rule term
 * segments using the exact same matching rules as `autoLinkCompendiumText`.
 * Existing markdown links are left unhighlighted; concatenating every
 * segment's `.text` reproduces `text` character-for-character.
 */
export function segmentCompendiumTerms(
  text: string,
  glossary: readonly CompendiumTerm[],
): CompendiumTextSegment[] {
  if (!text || !glossary.length) return text ? [{ text }] : [];
  const compiled = getCompiledMatcher(glossary);
  if (!compiled) return [{ text }];

  const { byLower, patternSource } = compiled;
  const pattern = new RegExp(patternSource, "gi");
  const segments: CompendiumTextSegment[] = [];

  const pushPlain = (segment: string) => {
    pattern.lastIndex = 0;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(segment)) !== null) {
      if (match.index > last) {
        segments.push({ text: segment.slice(last, match.index) });
      }
      const matchedText = match[0];
      const term = byLower.get(matchedText.toLowerCase());
      if (term) segments.push({ text: matchedText, term });
      else segments.push({ text: matchedText });
      last = match.index + matchedText.length;
    }
    if (last < segment.length) {
      segments.push({ text: segment.slice(last) });
    }
  };

  let lastLinkEnd = 0;
  MARKDOWN_LINK_GLOBAL_RE.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = MARKDOWN_LINK_GLOBAL_RE.exec(text)) !== null) {
    if (linkMatch.index > lastLinkEnd) {
      pushPlain(text.slice(lastLinkEnd, linkMatch.index));
    }
    segments.push({ text: linkMatch[0] });
    lastLinkEnd = linkMatch.index + linkMatch[0].length;
  }
  if (lastLinkEnd < text.length) {
    pushPlain(text.slice(lastLinkEnd));
  }
  return segments;
}

/**
 * Automatically wrap plain, unlinked occurrences of known Draw Steel
 * conditions and rules in `[label](scc.v1:...)` links while leaving existing
 * markdown links untouched and preserving original capitalization.
 */
export function autoLinkCompendiumText(
  text: string,
  glossary: readonly CompendiumTerm[],
): { text: string; count: number } {
  if (!text.trim() || !glossary.length) return { text, count: 0 };
  const compiled = getCompiledMatcher(glossary);
  if (!compiled) return { text, count: 0 };

  const { byLower, patternSource } = compiled;
  const pattern = new RegExp(patternSource, "gi");

  // Split into alternating plain text and existing [label](url) segments so we never double-link
  let count = 0;
  let result = "";
  let lastIndex = 0;
  MARKDOWN_LINK_GLOBAL_RE.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;

  const linkPlainSegment = (segment: string): string =>
    segment.replace(pattern, (matched) => {
      const term = byLower.get(matched.toLowerCase());
      if (!term) return matched;
      count += 1;
      return `[${matched}](${term.href})`;
    });

  while ((linkMatch = MARKDOWN_LINK_GLOBAL_RE.exec(text)) !== null) {
    if (linkMatch.index > lastIndex) {
      result += linkPlainSegment(text.slice(lastIndex, linkMatch.index));
    }
    result += linkMatch[0];
    lastIndex = linkMatch.index + linkMatch[0].length;
  }
  if (lastIndex < text.length) {
    result += linkPlainSegment(text.slice(lastIndex));
  }

  return { text: result, count };
}

export function autoLinkFeature(
  feature: MonsterFeature,
  glossary: readonly CompendiumTerm[],
): { feature: MonsterFeature; count: number } {
  let total = 0;
  const next: MonsterFeature = { ...feature };
  if (next.trigger) {
    const res = autoLinkCompendiumText(next.trigger, glossary);
    next.trigger = res.text;
    total += res.count;
  }
  if (next.effects?.length) {
    next.effects = next.effects.map((eff): FeatureEffect => {
      const copy: FeatureEffect = { ...eff };
      for (const key of ["tier1", "tier2", "tier3", "effect"] as const) {
        const val = copy[key];
        if (!val) continue;
        const res = autoLinkCompendiumText(val, glossary);
        copy[key] = res.text;
        total += res.count;
      }
      return copy;
    });
  }
  return { feature: next, count: total };
}

// ---------- Source Monster Name Adjustment ----------

const TITLE_WORDS = new Set([
  "arch",
  "baron",
  "baroness",
  "boss",
  "captain",
  "chief",
  "commander",
  "count",
  "countess",
  "dame",
  "duchess",
  "duke",
  "elder",
  "emperor",
  "empress",
  "general",
  "grand",
  "high",
  "king",
  "lady",
  "lord",
  "master",
  "overlord",
  "prince",
  "princess",
  "queen",
  "saint",
  "sir",
  "warlord",
]);

function namePattern(sourceName: string): RegExp | null {
  const clean = sourceName.trim();
  if (clean.length < 3) return null;

  const phrases = new Set<string>();
  const add = (p: string | undefined) => {
    const trimmed = (p ?? "").trim();
    if (trimmed.length >= 3) phrases.add(trimmed);
  };

  // 1. Full name (with optional leading "the ")
  add(`the ${clean}`);
  add(clean);

  // 2. Named boss epithets: "Xorannox the Tyract" -> "Xorannox", "the Tyract"
  //    "Keth, Scourge of the Deep" -> "Keth"
  const commaParts = clean.split(/,\s*/);
  if (commaParts.length >= 2) {
    add(commaParts[0]);
  }
  const theSplit = /^(.+?)\s+the\s+(.+)$/i.exec(clean);
  if (theSplit?.[1] && theSplit[2]) {
    const head = theSplit[1].trim();
    const tail = theSplit[2].trim();
    add(head);
    add(`the ${tail}`);
    const headWords = head.split(/\s+/).filter(Boolean);
    if (headWords.length >= 2 && TITLE_WORDS.has(headWords[0]!.toLowerCase())) {
      add(headWords[1]);
    }
  }
  const ofSplit = /^(.+?)\s+of\s+.+$/i.exec(clean);
  if (ofSplit?.[1]) {
    add(ofSplit[1].trim());
  }

  // 3. Titled proper names: "Count Rhodar von Glauer" -> "Count Rhodar", "Rhodar"
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && TITLE_WORDS.has(words[0]!.toLowerCase())) {
    const second = words[1]!.replace(/,$/, "");
    add(`${words[0]} ${second}`);
    if (second.length >= 4) add(second);
  }

  // 4. Troop / monster-type self-reference: "the <lastWord>" & "the <lastTwoWords>"
  //    e.g. "Goblin Redeye" -> "the redeye", "Meteor Dragon" -> "the dragon"
  const last = words[words.length - 1]?.replace(/,$/, "");
  if (words.length >= 2 && last && last.length >= 4) {
    add(`the ${last}`);
  }
  if (words.length >= 3) {
    const prev = words[words.length - 2];
    if (prev && last && prev.toLowerCase() !== "the" && prev.toLowerCase() !== "of") {
      add(`the ${prev} ${last}`);
    }
  }

  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;
  return new RegExp(
    `(?<![A-Za-z0-9_-])(?:${sorted.map(escapeRegExp).join("|")})(?![A-Za-z0-9_-])`,
    "gi",
  );
}

/**
 * Replace references to `sourceName` (including boss epithets like "Xorannox"
 * from "Xorannox the Tyract", titled names, and "the <shortName>") with
 * `targetName` in ability prose while leaving markdown URLs `(scc.v1:...)`
 * untouched.
 */
export function replaceMonsterNameInText(
  text: string,
  sourceName: string,
  targetName: string,
): { text: string; count: number } {
  const target = targetName.trim();
  const pattern = namePattern(sourceName);
  if (!text || !target || !pattern) return { text, count: 0 };
  if (sourceName.trim().toLowerCase() === target.toLowerCase()) return { text, count: 0 };

  let count = 0;
  const replacePlain = (segment: string): string =>
    segment.replace(pattern, () => {
      count += 1;
      return target;
    });

  // Preserve URLs inside [label](url) while still replacing inside label or plain text
  let result = "";
  let lastIndex = 0;
  MARKDOWN_LINK_GLOBAL_RE.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = MARKDOWN_LINK_GLOBAL_RE.exec(text)) !== null) {
    if (linkMatch.index > lastIndex) {
      result += replacePlain(text.slice(lastIndex, linkMatch.index));
    }
    const label = replacePlain(linkMatch[1] ?? "");
    result += `[${label}](${linkMatch[2] ?? ""})`;
    lastIndex = linkMatch.index + linkMatch[0].length;
  }
  if (lastIndex < text.length) {
    result += replacePlain(text.slice(lastIndex));
  }
  return { text: result, count };
}

export function replaceMonsterNameInFeature(
  feature: MonsterFeature,
  sourceName: string,
  targetName: string,
): { feature: MonsterFeature; count: number } {
  let total = 0;
  const next: MonsterFeature = { ...feature };
  if (next.name) {
    const res = replaceMonsterNameInText(next.name, sourceName, targetName);
    next.name = res.text;
    total += res.count;
  }
  if (next.trigger) {
    const res = replaceMonsterNameInText(next.trigger, sourceName, targetName);
    next.trigger = res.text;
    total += res.count;
  }
  if (next.effects?.length) {
    next.effects = next.effects.map((eff): FeatureEffect => {
      const copy: FeatureEffect = { ...eff };
      for (const key of ["tier1", "tier2", "tier3", "effect"] as const) {
        const val = copy[key];
        if (!val) continue;
        const res = replaceMonsterNameInText(val, sourceName, targetName);
        copy[key] = res.text;
        total += res.count;
      }
      return copy;
    });
  }
  return { feature: next, count: total };
}

export function featureListMentionsName(
  features: readonly MonsterFeature[],
  sourceName: string,
): boolean {
  const pattern = namePattern(sourceName);
  if (!pattern) return false;
  for (const f of features) {
    const texts = [
      f.name,
      f.trigger,
      ...(f.effects ?? []).flatMap((e) => [e.tier1, e.tier2, e.tier3, e.effect]),
    ];
    for (const t of texts) {
      if (!t) continue;
      const stripped = t.replace(MARKDOWN_LINK_GLOBAL_RE, "$1");
      pattern.lastIndex = 0;
      if (pattern.test(stripped)) {
        return true;
      }
    }
  }
  return false;
}
