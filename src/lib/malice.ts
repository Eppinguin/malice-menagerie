import { numberFrom, slugToLabel } from "./text.ts";
import { pathTokens, sourceUrl, STATBLOCK_RE } from "./repo.ts";
import { isRecord } from "../types.ts";
import type {
  FeatureEffect,
  MaliceFeature,
  MaliceScope,
  RawMaliceItem,
  RawMaliceRecord,
  RawMaliceSection,
} from "../types.ts";

interface MaliceScopeInfo {
  scope: MaliceScope;
  family: string;
  familyLabel: string;
  minLevel: number;
  blockName: string;
}

export function isMaliceCandidatePath(path: string): boolean {
  if (STATBLOCK_RE.test(path)) return false;
  const lower = path.toLowerCase();
  if (lower === "en/unified/json/rule/monster/malice.json") return true;
  return /^en\/unified\/json\/monster\/.+malice[^/]*\.json$/i.test(path);
}

function maliceScope(path: string, raw: RawMaliceRecord): MaliceScopeInfo {
  const basic = /\/rule\/monster\/malice\.json$/i.test(path);
  if (basic) {
    return {
      scope: "basic",
      family: "basic",
      familyLabel: "Basic Malice",
      minLevel: 0,
      blockName: raw.name || "Basic Malice",
    };
  }
  const match = path.match(/^en\/unified\/json\/monster\/([^/]+)/i);
  const family = match?.[1] || "other";
  return {
    scope: "family",
    family,
    familyLabel: slugToLabel(family),
    minLevel: Math.max(0, numberFrom(raw.level, 0)),
    blockName: raw.name || `${slugToLabel(family)} Malice`,
  };
}

interface DecoratedMeta {
  distance?: string;
  target?: string;
}

function maliceMetaFromDecoratedName(value: string | undefined): DecoratedMeta {
  const raw = String(value || "");
  if (!raw.includes("📏") && !raw.includes("🎯")) return {};
  const cleaned = raw.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const parts = cleaned.split("|").map((part) => part.trim());
  const distancePart = parts.find((part) => part.includes("📏")) || "";
  const targetPart = parts.find((part) => part.includes("🎯")) || "";
  return {
    distance: distancePart.replace(/^.*?📏\s*/, "").trim(),
    target: targetPart.replace(/^.*?🎯\s*/, "").trim(),
  };
}

function fillMissingScalar<K extends "body" | "intro" | "distance" | "target" | "usage">(
  target: RawMaliceItem,
  source: RawMaliceItem,
  keys: readonly K[],
): void {
  for (const key of keys) {
    const current = target[key];
    const next = source[key];
    if ((current === undefined || current === null || current === "") && next != null)
      target[key] = next;
  }
}

function mergeMaliceContinuation(
  previous: RawMaliceItem,
  continuation: RawMaliceItem,
): RawMaliceItem {
  const merged: RawMaliceItem = { ...previous };
  const decorated = maliceMetaFromDecoratedName(continuation.name);
  fillMissingScalar(merged, continuation, ["body", "intro", "distance", "target", "usage"]);
  if (merged.power_roll == null && continuation.power_roll != null)
    merged.power_roll = continuation.power_roll;
  if (!merged.distance && decorated.distance) merged.distance = decorated.distance;
  if (!merged.target && decorated.target) merged.target = decorated.target;

  const effects = [...(merged.effects ?? []), ...(continuation.effects ?? [])];
  if (effects.length) merged.effects = effects;
  const sections = [...(merged.sections ?? []), ...(continuation.sections ?? [])];
  if (sections.length) merged.sections = sections;
  const keywords = [...(merged.keywords ?? []), ...(continuation.keywords ?? [])];
  if (keywords.length) merged.keywords = keywords;
  return merged;
}

type MaliceIssueReporter = (issue: string) => void;

function maliceCostValue(item: RawMaliceItem): string | number | undefined {
  return item.cost === "" ? item.malice : (item.cost ?? item.malice);
}

function parseMaliceCost(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (/^Signature$/i.test(text)) return 0;

  const match = /^(\d+)(?:\s*-\s*(\d+))?\+?(?:\s+Malice)?$/i.exec(text);
  if (!match) return undefined;
  const minimum = Number(match[1]);
  const maximum = match[2] === undefined ? minimum : Number(match[2]);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum)
    return undefined;
  return minimum;
}

function normalizeMaliceItems(
  items: unknown[],
  reportIssue?: MaliceIssueReporter,
): RawMaliceItem[] {
  const merged: RawMaliceItem[] = [];
  for (const [index, rawItem] of items.entries()) {
    if (!isRecord(rawItem)) {
      reportIssue?.(`features[${index}] is not a JSON object`);
      continue;
    }
    const item = { ...rawItem } as RawMaliceItem;
    const cost = maliceCostValue(item);
    const hasContinuationContent = Boolean(
      item.power_roll ||
      item.body ||
      item.intro ||
      (Array.isArray(item.sections) && item.sections.length) ||
      (Array.isArray(item.effects) && item.effects.length),
    );
    // SteelCompendium occasionally emits the visual second row of a Malice feature
    // as a separate no-cost record. Treat it as continuation data for the priced row.
    const previous = merged[merged.length - 1];
    if (
      (cost == null || (typeof cost === "string" && !cost.trim())) &&
      hasContinuationContent &&
      previous
    ) {
      if (reportIssue && item.name) {
        const { distance, target } = maliceMetaFromDecoratedName(item.name);
        if (!distance && !target) reportIssue(`"${item.name}" has no Malice cost`);
      }
      merged[merged.length - 1] = mergeMaliceContinuation(previous, item);
    } else {
      merged.push(item);
    }
  }
  return merged;
}

function labelledSection(section: RawMaliceSection | undefined): string {
  if (!section) return "";
  const text = section.text || section.body || section.effect || "";
  if (!text) return "";
  return section.label ? `**${section.label}:** ${text}` : text;
}

function inferMaliceRollLabel(item: RawMaliceItem): string {
  const searchable = [item.intro, item.body, ...(item.sections || []).map(labelledSection)]
    .filter(Boolean)
    .join(" ");
  const test = searchable.match(/\*\*(Might|Agility|Reason|Intuition|Presence) test\*\*/i);
  return test?.[1] ? `${test[1]} test` : item.power_roll?.roll || "Power Roll";
}

/** Comparison key for "is this the same rules text", ignoring spacing, case
    and a printed lead-in label such as "**Effect:**". */
function sameText(text: string | undefined): string {
  return (text ?? "")
    .replace(/^\s*\*\*[^*]+:\*\*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function maliceEffectsFromItem(item: RawMaliceItem): FeatureEffect[] {
  const effects: FeatureEffect[] = Array.isArray(item.effects)
    ? item.effects.map((effect) => ({ ...effect }))
    : [];
  const sections = Array.isArray(item.sections)
    ? item.sections.map(labelledSection).filter(Boolean)
    : [];
  const introText = [item.intro, item.body].filter((text): text is string => Boolean(text));

  const tiers = item.power_roll?.tiers;
  // Unified records repeat themselves: `body`/`intro` and `power_roll` restate
  // what `effects` already holds. When structured effects exist they are the
  // source of truth; only text they don't already carry is appended.
  if (effects.length) {
    const known = new Set<string>();
    const deduped = effects.filter((effect) => {
      const tiered = Boolean(effect.tier1 || effect.tier2 || effect.tier3);
      const key = sameText(effect.effect);
      if (!tiered && key && known.has(key)) return false;
      [effect.effect, effect.tier1, effect.tier2, effect.tier3].forEach((text) => {
        const textKey = sameText(text);
        if (textKey) known.add(textKey);
      });
      if (tiered && !effect.roll) effect.roll = inferMaliceRollLabel(item);
      return true;
    });
    // `body` is often every effect paragraph joined with blank lines, so it is
    // compared paragraph by paragraph and only paragraphs not yet carried are kept.
    [...introText, ...sections].forEach((text) => {
      const fresh = text
        .split(/\n\s*\n/)
        .filter((paragraph) => {
          const key = sameText(paragraph);
          return key && !known.has(key);
        })
        .join("\n\n");
      const key = sameText(fresh);
      if (!key) return;
      known.add(key);
      deduped.push({ effect: fresh });
    });
    const hasTiers = deduped.some((effect) => effect.tier1 || effect.tier2 || effect.tier3);
    if (tiers && !hasTiers) {
      const tierEffect: FeatureEffect = { roll: inferMaliceRollLabel(item) };
      if (tiers.low != null) tierEffect.tier1 = tiers.low;
      if (tiers.mid != null) tierEffect.tier2 = tiers.mid;
      if (tiers.high != null) tierEffect.tier3 = tiers.high;
      deduped.push(tierEffect);
    }
    return deduped;
  }
  if (tiers) {
    // A first section often contains the trigger/setup for the test and belongs before the tiers.
    if (sections.length && !introText.length) {
      const first = sections.shift();
      if (first) introText.push(first);
    }
    introText.forEach((text) => effects.push({ effect: text }));
    const tierEffect: FeatureEffect = { roll: inferMaliceRollLabel(item) };
    if (tiers.low != null) tierEffect.tier1 = tiers.low;
    if (tiers.mid != null) tierEffect.tier2 = tiers.mid;
    if (tiers.high != null) tierEffect.tier3 = tiers.high;
    effects.push(tierEffect);
    sections.forEach((text) => effects.push({ effect: text }));
  } else {
    [...introText, ...sections].forEach((text) => effects.push({ effect: text }));
  }
  return effects;
}

export function flattenMalicePayload(
  raw: RawMaliceRecord,
  path: string,
  reportIssue?: MaliceIssueReporter,
): MaliceFeature[] {
  const values: MaliceFeature[] = [];
  const scope = maliceScope(path, raw);
  const addFeature = (
    item: RawMaliceItem,
    cost: number,
    costText: string,
    effects: FeatureEffect[],
    index = values.length,
  ): void => {
    values.push({
      id: `${path}#${index}`,
      path,
      name: item.name || "",
      cost,
      costText,
      icon: item.icon || "",
      effects,
      distance: item.distance || "",
      target: item.target || "",
      keywords: Array.isArray(item.keywords) ? item.keywords : [],
      source: sourceUrl(path),
      tokens: pathTokens(path),
      scope: scope.scope,
      family: scope.family,
      familyLabel: scope.familyLabel,
      minLevel: scope.minLevel,
      blockName: scope.blockName,
    });
  };

  const parseMaliceMarkdown = (content: string): void => {
    const headings = [...content.matchAll(/^>[ \t]*\*\*([^*\r\n]+)\*\*[ \t]*$/gm)];
    let nextIndex = values.length;
    for (const [position, match] of headings.entries()) {
      const [heading, title = ""] = match;
      // The Basic Malice rule uses the same markup for its advice sidebar.
      if (scope.scope === "basic" && title.trim() === "That's So Much Malice!") continue;
      const index = nextIndex++;
      const pricedTitle = /^(.+?)[ \t]+\(([^()]*)\)$/.exec(title.trim());
      if (!pricedTitle) {
        reportIssue?.(`feature "${title.trim()}" has no Malice cost`);
        continue;
      }
      const [, name = "", costText = ""] = pricedTitle;
      const cost = /(?:^Signature$|\s+Malice$)/i.test(costText.trim())
        ? parseMaliceCost(costText)
        : undefined;
      if (cost === undefined) {
        reportIssue?.(`feature "${name.trim()}" has unsupported Malice cost "${costText}"`);
        continue;
      }
      const section = content.slice(match.index + heading.length, headings[position + 1]?.index);
      const [effectBlock] = section.split(/\n#{3,6}\s+/, 1);
      const body = effectBlock
        ?.match(/^\s*\n>\s*\n>([\s\S]*)/)?.[1]
        ?.replace(/^>\s?/gm, "")
        .trim();
      if (!body) {
        reportIssue?.(`feature "${name.trim()}" has no displayable effect`);
        continue;
      }
      addFeature({ name: name.trim() }, cost, costText, [{ effect: body }], index);
    }
  };

  if (Array.isArray(raw.features)) {
    normalizeMaliceItems(raw.features, reportIssue).forEach((item) => {
      const costValue = maliceCostValue(item);
      if (
        typeof item.name !== "string" ||
        !item.name.trim() ||
        costValue == null ||
        (typeof costValue === "string" && !costValue.trim())
      ) {
        reportIssue?.(`feature "${item.name || "(unnamed)"}" is missing a name or Malice cost`);
        return;
      }
      const cost = parseMaliceCost(costValue);
      if (cost === undefined) {
        const label = typeof costValue === "string" ? ` "${costValue.trim()}"` : "";
        reportIssue?.(`feature "${item.name}" has unsupported Malice cost${label}`);
        return;
      }
      addFeature(item, cost, String(costValue).trim(), maliceEffectsFromItem(item));
    });
  } else if (raw.features !== undefined) {
    reportIssue?.("features is not an array");
  }
  if (typeof raw.content === "string") parseMaliceMarkdown(raw.content);
  return values;
}

/** Read the displayable features from one official document, preserving their source IDs. */
export function displayableMaliceFeatures(
  raw: RawMaliceRecord,
  path: string,
  reportIssue?: MaliceIssueReporter,
): MaliceFeature[] {
  const seen = new Set<string>();
  return flattenMalicePayload(raw, path, reportIssue).filter((feature) => {
    if (!feature.name || !featureText(feature).trim()) {
      reportIssue?.(`feature "${feature.name}" has no displayable effect`);
      return false;
    }
    const key = `${feature.name}|${feature.cost}`;
    if (seen.has(key)) {
      reportIssue?.(`duplicate feature "${feature.name}" at Malice cost ${feature.cost}`);
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function featureText(feature: MaliceFeature): string {
  return feature.effects
    .map(
      (effect) =>
        effect.effect ||
        [effect.roll, effect.tier1, effect.tier2, effect.tier3].filter(Boolean).join(" · "),
    )
    .filter(Boolean)
    .join(" ");
}

export function isPriorMaliceGateway(feature: MaliceFeature): boolean {
  return feature.name.trim().toLowerCase() === "prior malice features";
}

export function dedupeMaliceFeatures(features: readonly MaliceFeature[]): MaliceFeature[] {
  const seen = new Set<string>();
  return features.filter((feature) => {
    const key = `${feature.name.toLowerCase()}|${feature.costText || feature.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
