import { atLevel } from "./levels.ts";
import { plainText } from "./text.ts";
import type { CatalogEntry, Monster, MonsterFeature } from "../types.ts";

export type AbilityCategory =
  | "all"
  | "signature"
  | "malice"
  | "maneuver"
  | "triggered"
  | "villain"
  | "trait";

export const ABILITY_CATEGORIES: readonly { id: AbilityCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "signature", label: "Signature" },
  { id: "malice", label: "Malice" },
  { id: "maneuver", label: "Maneuver" },
  { id: "triggered", label: "Triggered" },
  { id: "villain", label: "Villain Action" },
  { id: "trait", label: "Trait" },
];

/**
 * Determine all matching Draw Steel categories for a monster feature.
 * A feature can belong to more than one (e.g. a "3 Malice" Maneuver matches
 * both "malice" and "maneuver").
 */
export function featureCategories(feature: MonsterFeature): AbilityCategory[] {
  const cats: AbilityCategory[] = [];
  const cost = String(feature.cost ?? "");
  const abilityType = String(feature.ability_type ?? "");
  const usage = String(feature.usage ?? "");
  const featureType = String(feature.feature_type ?? "").toLowerCase();

  const isVillain = /villain\s*action/i.test(`${cost} ${abilityType} ${usage}`);
  const isMalice = /malice/i.test(cost);
  const isSignature = /signature/i.test(abilityType);
  const isTriggered = /triggered/i.test(usage) || Boolean(feature.trigger?.trim());
  const isManeuver = /maneuver/i.test(usage);
  const isTrait =
    featureType === "trait" ||
    (!usage && !abilityType && !cost && !feature.trigger && !isVillain && !isMalice);

  if (isSignature) cats.push("signature");
  if (isMalice) cats.push("malice");
  if (isManeuver) cats.push("maneuver");
  if (isTriggered) cats.push("triggered");
  if (isVillain) cats.push("villain");
  if (isTrait) cats.push("trait");

  return cats;
}

export function featureKindLabel(feature: MonsterFeature): string {
  const cost = feature.cost == null ? "" : String(feature.cost).trim();
  if (cost) return cost;
  if (feature.ability_type?.trim()) return feature.ability_type.trim();
  if (String(feature.feature_type ?? "").toLowerCase() === "trait") return "Trait";
  if (feature.usage?.trim()) return feature.usage.trim();
  return "Trait";
}

export interface IndexedAbility {
  key: string;
  feature: MonsterFeature;
  featureIndex: number;
  monster: Monster;
  categories: readonly AbilityCategory[];
  kindLabel: string;
  nameLower: string;
  /** The source monster's name, so a search can find abilities by monster. */
  monsterNameLower: string;
  searchText: string;
}

export function buildAbilityIndex(
  entries: readonly CatalogEntry[],
  excludeHomebrewId?: string,
): IndexedAbility[] {
  const out: IndexedAbility[] = [];
  for (const entry of entries) {
    const monster = entry.monster;
    if (!monster || !monster.features.length) continue;
    if (excludeHomebrewId && monster.homebrewId === excludeHomebrewId) continue;

    monster.features.forEach((feature, featureIndex) => {
      const name = (feature.name || "").trim();
      if (!name) return;
      const categories = featureCategories(feature);
      const kindLabel = featureKindLabel(feature);
      const effectText = (feature.effects ?? [])
        .map((eff) =>
          [eff.name, eff.cost, eff.roll, eff.tier1, eff.tier2, eff.tier3, eff.effect]
            .filter(Boolean)
            .join(" "),
        )
        .join(" ");
      const searchText = plainText(
        [
          name,
          kindLabel,
          feature.usage,
          feature.distance,
          feature.target,
          feature.trigger,
          ...(feature.keywords ?? []),
          effectText,
          monster.name,
          monster.role,
          monster.organization,
          ...monster.keywords,
        ]
          .filter(Boolean)
          .join(" "),
      ).toLowerCase();

      out.push({
        key: `${monster.path}#${featureIndex}`,
        feature,
        featureIndex,
        monster,
        categories,
        kindLabel,
        nameLower: name.toLowerCase(),
        monsterNameLower: monster.name.toLowerCase(),
        searchText,
      });
    });
  }
  out.sort(
    (a, b) =>
      (a.monster.isHomebrew === b.monster.isHomebrew ? 0 : a.monster.isHomebrew ? -1 : 1) ||
      a.nameLower.localeCompare(b.nameLower) ||
      a.monster.name.localeCompare(b.monster.name),
  );
  return out;
}

export function filterAbilityIndex(
  index: readonly IndexedAbility[],
  opts: {
    query: string;
    category: AbilityCategory;
    onlyHomebrew: boolean;
    roleFilter?: string;
  },
): IndexedAbility[] {
  const words = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const roleLower = (opts.roleFilter ?? "").trim().toLowerCase();

  // Fast path: index is already pre-sorted by homebrew + name + monster.
  if (words.length === 0) {
    const filtered: IndexedAbility[] = [];
    for (const item of index) {
      if (opts.onlyHomebrew && !item.monster.isHomebrew) continue;
      if (opts.category !== "all" && !item.categories.includes(opts.category)) continue;
      if (roleLower && item.monster.role.toLowerCase() !== roleLower) continue;
      filtered.push(item);
    }
    return filtered;
  }

  const scored: { item: IndexedAbility; score: number }[] = [];
  for (const item of index) {
    if (opts.onlyHomebrew && !item.monster.isHomebrew) continue;
    if (opts.category !== "all" && !item.categories.includes(opts.category)) continue;
    if (roleLower && item.monster.role.toLowerCase() !== roleLower) continue;

    let score = 0;
    let allMatch = true;
    for (const word of words) {
      if (!item.searchText.includes(word)) {
        allMatch = false;
        break;
      }
      if (item.nameLower === word) score += 100;
      else if (item.nameLower.startsWith(word)) score += 50;
      // A monster's name finds all of its abilities, ahead of passing
      // mentions in other abilities' rules text.
      else if (item.monsterNameLower.startsWith(word)) score += 40;
      else if (item.nameLower.includes(word)) score += 25;
      else if (item.monsterNameLower.includes(word)) score += 20;
      else score += 5;
    }
    if (!allMatch) continue;
    if (item.monster.isHomebrew) score += 3;
    scored.push({ item, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      // One monster's abilities stay in the order its statblock prints them.
      (a.item.monster === b.item.monster ? a.item.featureIndex - b.item.featureIndex : 0) ||
      a.item.nameLower.localeCompare(b.item.nameLower) ||
      a.item.monster.name.localeCompare(b.item.monster.name),
  );
  return scored.map((entry) => entry.item);
}

/**
 * Return a deep-cloned feature from `item`, optionally rescaled to `targetLevel`
 * via the book's `atLevel()` formulas when the monster's printed level differs.
 */
export function cloneAbilityForLevel(
  item: IndexedAbility,
  targetLevel: number,
  scaleToLevel: boolean,
): MonsterFeature {
  if (!scaleToLevel || item.monster.level === targetLevel) {
    return structuredClone(item.feature);
  }
  const scaled = atLevel(item.monster, targetLevel);
  const matched = scaled.features[item.featureIndex] ?? item.feature;
  return structuredClone(matched);
}
