import type { EdgeState } from "../types.ts";

export interface SharedDiceResult {
  dice: [number, number] | null;
  /** Runs after the store applies the result; diagnostics must never delay it. */
  onApplied?: () => void;
}

// Registered by the optional Owlbear controller, so the store has no dependency on it.
type DiceTransport = (bonus: number, edge: EdgeState) => Promise<SharedDiceResult> | null;
let transport: DiceTransport | null = null;
let resetPendingRoll: (() => void) | null = null;
export function setDiceTransport(next: DiceTransport): void {
  transport = next;
}
export function requestSharedDice(bonus: number, edge: EdgeState): ReturnType<DiceTransport> {
  return transport?.(bonus, edge) ?? null;
}
export function setSharedRollReset(reset: () => void): void {
  resetPendingRoll = reset;
}
export function resetPendingSharedRoll(): void {
  resetPendingRoll?.();
}
