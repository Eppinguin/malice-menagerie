import type { MonsterFeature } from "../../types.ts";

/** Whether an ability is printed as a trait (no action, no roll). */
export function isTraitFeature(feature: MonsterFeature): boolean {
  return String(feature.feature_type || "").toLowerCase() === "trait";
}

/** What the bold right-hand label of an ability's first line reads: "Trait",
    its cost ("3 Malice", "Villain Action 1") or its ability type. */
export function typeCostLabel(feature: MonsterFeature): string {
  return isTraitFeature(feature) ? "Trait" : String(feature.cost ?? feature.ability_type ?? "");
}

/**
 * Rewrites an ability's type/cost label the way the book uses it: "Trait"
 * makes a trait, a villain action or Malice cost becomes the cost, anything
 * else is the ability type. Usage follows so the ability stays playable.
 */
export function applyTypeCost(feature: MonsterFeature, val: string): MonsterFeature {
  const trimmed = val.trim();
  const isTrait = isTraitFeature(feature);
  const next: MonsterFeature = { ...feature };
  if (/^trait$/i.test(trimmed)) {
    next.feature_type = "trait";
    delete next.cost;
    delete next.ability_type;
    if (!next.icon) next.icon = "⭐";
  } else if (/villain/i.test(trimmed)) {
    delete next.feature_type;
    delete next.ability_type;
    next.cost = val;
    next.usage = "Villain Action";
  } else if (/malice/i.test(trimmed)) {
    delete next.feature_type;
    delete next.ability_type;
    next.cost = val;
    if (isTrait && !next.usage) next.usage = "Main action";
  } else {
    delete next.feature_type;
    delete next.cost;
    if (val) {
      next.ability_type = val;
      if (isTrait && !next.usage) next.usage = "Main action";
    } else {
      delete next.ability_type;
      if (isTrait && !next.usage) next.usage = "Maneuver";
    }
    if (/villain/i.test(String(next.usage ?? ""))) {
      next.usage = "Main action";
    }
  }
  return next;
}
