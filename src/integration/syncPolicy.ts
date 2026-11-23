import { sameConditions } from "../../shared/obr/conditionLabels.ts";
import type { CombatInstance } from "../types.ts";

/**
 * Decide what an Owlbear-originated Stamina update may change in Malice.
 *
 * The rules are deliberately local-first while an edit is pending, and
 * forgiving afterwards: Owlbear can raise a creature's maximum, but a minion
 * squad's maximum belongs to the roster that Malice dealt.
 */
export interface ExternalUpdateInput {
  kind: CombatInstance["kind"];
  /** Current values in the Malice encounter. */
  currentStamina: number;
  maxStamina: number;
  /** Values observed in Owlbear. */
  updateCurrentStamina: number;
  updateMaxStamina: number;
  /** A local edit is queued and has not been acknowledged yet. */
  dirty: boolean;
}

export type ExternalUpdateReason = "dirty" | "unchanged" | "apply";

export interface ExternalUpdateDecision {
  apply: boolean;
  reason: ExternalUpdateReason;
  currentStamina: number;
  maxStamina: number;
}

export function clampStamina(value: number, max: number, kind: CombatInstance["kind"]): number {
  if (!Number.isFinite(value)) return 0;
  const ceiling = kind === "minion-squad" ? max : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(Math.round(value), ceiling));
}

/** The app's diff is debounced, so a local edit can exist for a moment before
    its outbound stamp is marked dirty. Treat any disagreement with the last
    acknowledged stamp as pending, so an incoming update cannot erase it. */
export function hasPendingLocalChange(
  instance: Pick<CombatInstance, "currentStamina" | "maxStamina" | "name"> & {
    groupId?: string;
    conditions?: string[];
  },
  stamp:
    | {
        stamina: number;
        maxStamina: number;
        name: string;
        groupId?: string;
        conditions?: string[];
        individualStamina?: number | null;
        statblock?: { resourceId: string } | null;
      }
    | null
    | undefined,
  extra?: {
    individualStamina?: number | null;
    statblockResourceId?: string | null;
  },
): boolean {
  if (!stamp) return false;
  return (
    (stamp.conditions !== undefined &&
      instance.conditions !== undefined &&
      !sameConditions(stamp.conditions, instance.conditions)) ||
    stamp.stamina !== instance.currentStamina ||
    stamp.maxStamina !== instance.maxStamina ||
    stamp.name !== instance.name ||
    (extra?.individualStamina !== undefined &&
      (stamp.individualStamina ?? null) !== extra.individualStamina) ||
    (extra?.statblockResourceId !== undefined &&
      (stamp.statblock?.resourceId ?? null) !== extra.statblockResourceId)
  );
}

export function decideExternalUpdate(input: ExternalUpdateInput): ExternalUpdateDecision {
  if (input.dirty) {
    return {
      apply: false,
      reason: "dirty",
      currentStamina: input.currentStamina,
      maxStamina: input.maxStamina,
    };
  }
  const currentStamina = clampStamina(input.updateCurrentStamina, input.maxStamina, input.kind);
  const maxStamina =
    input.kind === "creature"
      ? Math.max(input.maxStamina, input.updateMaxStamina, currentStamina)
      : input.maxStamina;
  if (input.currentStamina === currentStamina && input.maxStamina === maxStamina) {
    return { apply: false, reason: "unchanged", currentStamina, maxStamina };
  }
  return { apply: true, reason: "apply", currentStamina, maxStamina };
}
