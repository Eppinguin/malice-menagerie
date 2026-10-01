import type { CombatInstance } from "../types.ts";

/* What the app does for the Director once a condition is ringed on a
   creature. Only the parts that are the creature's own and certain; edges
   and banes depend on who the creature is fighting, so they stay with the
   Director's hold-to-roll menu. The rule text itself is a hover away on the
   condition's chip. */

const has = (instance: CombatInstance, name: string) =>
  instance.conditions.some((condition) => condition.toLowerCase() === name);

/** Dazed: no triggered actions, free triggered actions, or free maneuvers. */
export function isDazed(instance: CombatInstance): boolean {
  return has(instance, "dazed");
}
