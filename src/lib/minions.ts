import type { CombatInstance, EncounterItem, Monster } from "../types.ts";

/** The Monsters book: minions are bought four at a time, and a squad holds
    at most eight. */
export const MINION_SET = 4;
export const SQUAD_MAX = 8;

export function isMinion(m: Monster): boolean {
  return m.organization.toLowerCase() === "minion";
}

/** How many squads `count` minions can form: at least enough to keep every
    squad at eight or fewer, at most one minion each. */
export function squadRange(count: number): [min: number, max: number] {
  return [Math.max(1, Math.ceil(count / SQUAD_MAX)), Math.max(1, count)];
}

/** `count` minions dealt into `squads` squads as evenly as possible, the
    larger squads first: 10 in 3 is 4 + 3 + 3. */
export function evenSquads(count: number, squads: number): number[] {
  const [min, max] = squadRange(count);
  const n = Math.max(min, Math.min(max, Math.round(squads)));
  const base = Math.floor(count / n);
  const extra = count % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The book's default: squads of four, evened out when the count isn't a
    multiple of four. */
export function defaultSquads(count: number): number[] {
  return evenSquads(count, Math.ceil(count / MINION_SET));
}

/** The squad sizes an older, whole-roster minion entry was dealt into: its
    saved split when it still adds up, otherwise the default. */
export function squadSizes(item: Pick<EncounterItem, "count" | "squads">): number[] {
  const own = item.squads;
  if (own?.length && own.every((size) => size >= 1 && size <= SQUAD_MAX)) {
    if (own.reduce((sum, size) => sum + size, 0) === item.count) return own;
  }
  return defaultSquads(item.count);
}

/** The per-minion Stamina bonus in a "With Captain" entry, e.g.
    "+2 bonus to Stamina", or 0. */
export function captainStaminaBonus(m: Monster): number {
  const match = m.withCaptain.match(/^\+(\d+) bonus to Stamina$/i);
  return match?.[1] ? Number(match[1]) : 0;
}

/** Whether a creature can lead a squad: any creature that isn't a minion or
    a mount (the language requirement is the Director's call). */
export function canCaptain(m: Monster): boolean {
  return !isMinion(m) && m.role.toLowerCase() !== "mount";
}

/** One minion's Stamina in this squad, counting a captain's Stamina bonus. */
export function minionStamina(squad: CombatInstance, m: Monster): number {
  return m.stamina + (squad.captainId ? captainStaminaBonus(m) : 0);
}

/** Minions still standing: one falls each time the pool drops by a minion's
    Stamina, so a pool of 36 in fives still has 8. */
export function standing(current: number, perMinion: number): number {
  return perMinion > 0 ? Math.max(0, Math.ceil(current / perMinion)) : 0;
}

/**
 * Resize a squad in place to `size` minions. New minions arrive at full
 * Stamina; removed minions are the dead ones first, then the living, each
 * taking a whole minion's Stamina with them.
 */
export function resizeSquad(squad: CombatInstance, size: number, perMinion: number): void {
  const delta = size - squad.count;
  if (delta > 0) {
    squad.currentStamina += perMinion * delta;
  } else if (delta < 0) {
    const dead = squad.count - standing(squad.currentStamina, perMinion);
    const living = Math.max(0, -delta - dead);
    squad.currentStamina = Math.max(0, squad.currentStamina - perMinion * living);
  }
  squad.count = size;
  squad.maxStamina = perMinion * size;
  squad.currentStamina = Math.min(squad.currentStamina, squad.maxStamina);
}

/** The flat damage a tier line opens with ("4 poison damage; push 3"), as the
    number and its damage type, or null when the tier deals no set damage. */
export function tierDamage(text: string): { amount: number; type: string } | null {
  const match = text.match(/^(\d+)\s+(?:([a-z]+)\s+)?\[?damage\b/i);
  if (!match?.[1]) return null;
  return { amount: Number(match[1]), type: match[2] ?? "" };
}
