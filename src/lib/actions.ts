import type { Monster, MonsterFeature } from "../types.ts";

/**
 * Where a feature sits in a creature's round. SteelCompendium prints the
 * action type in `usage` ("Main action", "Triggered action", …) and a villain
 * action's place in `cost` ("Villain Action 2"); traits carry neither.
 */
export type ActionSlot = "main" | "maneuver" | "move" | "trigger" | "villain" | "other" | "trait";

export interface IndexedFeature {
  /** Position in `monster.features`, the key the statblock body prints under. */
  index: number;
  name: string;
  slot: ActionSlot;
  signature: boolean;
  /** Malice the ability costs to use; 0 when free. */
  malice: number;
  /** A villain action's place, 1–3. */
  villain: number | null;
  /** A free triggered action, which doesn't use the creature's triggered action. */
  free: boolean;
  trigger: string;
}

function slotOf(feature: MonsterFeature, villain: number | null): ActionSlot {
  if (String(feature.feature_type || "").toLowerCase() === "trait") return "trait";
  if (villain) return "villain";
  const usage = String(feature.usage || "").toLowerCase();
  if (usage.includes("trigger")) return "trigger";
  if (usage.includes("maneuver")) return "maneuver";
  if (usage.includes("main") || usage.includes("signature")) return "main";
  if (usage.includes("move")) return "move";
  return "other";
}

/** Whether an ability takes a main action, the only kind whose critical hit
    (a natural 19 or 20) grants another main action. */
export function isMainAction(feature: MonsterFeature | undefined): boolean {
  return feature ? indexFeature(feature, 0).slot === "main" : false;
}

export function indexFeature(feature: MonsterFeature, index: number): IndexedFeature {
  const cost = String(feature.cost ?? "").trim();
  const villainMatch = cost.match(/villain action\s*(\d)/i);
  const maliceMatch = cost.match(/^(\d+)\s*\+?\s*malice/i);
  const villain = villainMatch ? Number(villainMatch[1]) : null;
  return {
    index,
    name: feature.name || "Ability",
    slot: slotOf(feature, villain),
    signature: /signature/i.test(String(feature.ability_type || "")),
    malice: maliceMatch ? Number(maliceMatch[1]) : 0,
    villain,
    free: /free/i.test(String(feature.usage || "")),
    trigger: String(feature.trigger || "").trim(),
  };
}

const WORD_COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

/** Triggered actions a creature can use each round: one, unless a trait says
    otherwise (Ajax: "he can use three triggered actions in a round"). */
export function reactionsPerRound(monster: Monster): number {
  for (const feature of monster.features) {
    for (const effect of feature.effects || []) {
      const match = String(effect.effect || "").match(/can use (one|two|three|four|\d) \[?triggered actions/i);
      const word = match?.[1]?.toLowerCase();
      if (word) return WORD_COUNTS[word] ?? Number(word);
    }
  }
  return 1;
}

const indexCache = new WeakMap<Monster, IndexedFeature[]>();

/** Every feature of a statblock, classified once per loaded monster. */
export function indexFeatures(monster: Monster): IndexedFeature[] {
  let list = indexCache.get(monster);
  if (!list) {
    list = monster.features.map(indexFeature);
    indexCache.set(monster, list);
  }
  return list;
}
