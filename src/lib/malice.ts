import { numberFrom, slugToLabel } from "./text.ts";
import { pathTokens, sourceUrl } from "./repo.ts";
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

function normalizeMaliceItems(items: unknown): RawMaliceItem[] {
  const merged: RawMaliceItem[] = [];
  for (const rawItem of Array.isArray(items) ? items : []) {
    if (!isRecord(rawItem)) continue;
    const item = { ...rawItem } as RawMaliceItem;
    const costText = String(item.cost || item.malice || "").trim();
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
    if (!costText && hasContinuationContent && previous) {
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

function maliceEffectsFromItem(item: RawMaliceItem): FeatureEffect[] {
  const effects: FeatureEffect[] = Array.isArray(item.effects)
    ? item.effects.map((effect) => ({ ...effect }))
    : [];
  const sections = Array.isArray(item.sections)
    ? item.sections.map(labelledSection).filter(Boolean)
    : [];
  const introText = [item.intro, item.body].filter((text): text is string => Boolean(text));

  const tiers = item.power_roll?.tiers;
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

export function flattenMalicePayload(raw: RawMaliceRecord, path: string): MaliceFeature[] {
  const values: MaliceFeature[] = [];
  const scope = maliceScope(path, raw);
  const addFeature = (item: RawMaliceItem, costText: string, effects: FeatureEffect[]): void => {
    const cost = numberFrom(costText, 0);
    values.push({
      id: `${path}#${values.length}`,
      path,
      name: item.name || "",
      cost,
      costText: costText || (cost ? `${cost} Malice` : ""),
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
    const pattern =
      />\s*\*\*([^*\n]+?)\s+\((\d+\+?)\s+Malice\)\*\*\s*\n>\s*\n>\s*([\s\S]*?)(?=\n>\s*\*\*[^*\n]+?\s+\(\d+\+?\s+Malice\)\*\*|\n#{3,6}\s+|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const [, name, cost, rawBody] = match;
      if (!name || !cost || rawBody === undefined) continue;
      const body = rawBody.replace(/^>\s?/gm, "").trim();
      addFeature({ name: name.trim() }, `${cost} Malice`, [{ effect: body }]);
    }
  };

  if (Array.isArray(raw.features)) {
    normalizeMaliceItems(raw.features).forEach((item) => {
      const costText = String(item.cost || item.malice || "");
      if (!item.name || !costText) return;
      addFeature(item, costText, maliceEffectsFromItem(item));
    });
  }
  if (typeof raw.content === "string") parseMaliceMarkdown(raw.content);
  return values;
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
