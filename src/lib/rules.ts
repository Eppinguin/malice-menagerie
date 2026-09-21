import { numberFrom, signed } from "./text.ts";
import type { ActiveEffect, Difficulty, EdgeState, Monster, Party, PowerRollResult } from "../types.ts";

export interface PartyMathResult {
  oneHeroES: number;
  partyES: number;
  roundOne: number;
}

export function partyMath(party: Party): PartyMathResult {
  const oneHeroES = party.level * 6;
  const partyES = oneHeroES * party.heroes;
  const roundOne = party.victories + party.heroes + 1 + party.bonusMalice;
  return { oneHeroES, partyES, roundOne };
}

export function difficultyFor(ev: number, partyES: number): Difficulty {
  if (!ev)
    return { label: "Trivial", tier: "trivial", help: "Add monsters to build the encounter." };
  const ratio = partyES ? ev / partyES : 0;
  if (ratio < 0.5)
    return { label: "Easy", tier: "easy", help: "Well below the party encounter strength." };
  if (ratio < 0.85)
    return { label: "Standard", tier: "standard", help: "A moderate encounter for this party." };
  if (ratio < 1.15)
    return { label: "Hard", tier: "hard", help: "Near the party encounter strength." };
  if (ratio < 1.5)
    return { label: "Extreme", tier: "extreme", help: "Above the party encounter strength." };
  return { label: "Deadly", tier: "deadly", help: "Far above the party encounter strength." };
}

const CHARACTERISTIC_NAMES = {
  might: "M",
  agility: "A",
  reason: "R",
  intuition: "I",
  presence: "P",
} as const;

export function resolvePowerRollBonus(rollText: string, actor: Monster | null): number {
  const text = String(rollText || "");
  const numeric = text.match(/([+-]\s*\d+)\s*$/);
  if (numeric?.[1]) return Number(numeric[1].replace(/\s/g, ""));
  if (!actor?.chars) return 0;

  if (/\+\s*(?:the\s+)?highest\s+characteristic(?:\s+score)?/i.test(text)) {
    return Math.max(...Object.values(actor.chars).map((value) => numberFrom(value, 0)));
  }

  for (const [name, key] of Object.entries(CHARACTERISTIC_NAMES) as [
    string,
    keyof Monster["chars"],
  ][]) {
    if (new RegExp(`\\+\\s*(?:the\\s+)?${name}(?:\\s+score)?\\b`, "i").test(text))
      return numberFrom(actor.chars[key], 0);
  }
  return 0;
}

// ---------- Edges and banes ----------
// Single edge/bane: +2/-2 to the roll. Double edge/bane: no modifier,
// tier shifts +1/-1 (clamped to 1..3). Counts cancel: edge+banes resolve
// per the rulebook (double+double => normal, double+single => single).

export const EDGE_ORDER: EdgeState[] = ["double-bane", "bane", "normal", "edge", "double-edge"];

export function resolveEdgeBane(edges: number, banes: number): EdgeState {
  const e = Math.max(0, Math.floor(edges));
  const b = Math.max(0, Math.floor(banes));
  if (e >= 2 && b >= 2) return "normal";
  if (e >= 2 && b === 1) return "edge";
  if (b >= 2 && e === 1) return "bane";
  if (e >= 2) return "double-edge";
  if (b >= 2) return "double-bane";
  if (e === 1 && b === 0) return "edge";
  if (b === 1 && e === 0) return "bane";
  return "normal";
}

export function edgeModifier(edge: EdgeState): number {
  return edge === "edge" ? 2 : edge === "bane" ? -2 : 0;
}

export function edgeTierShift(edge: EdgeState): number {
  return edge === "double-edge" ? 1 : edge === "double-bane" ? -1 : 0;
}

export function edgeTag(edge: EdgeState): string {
  switch (edge) {
    case "edge":
      return "E";
    case "double-edge":
      return "2E";
    case "bane":
      return "B";
    case "double-bane":
      return "2B";
    default:
      return "";
  }
}

function baseTierForTotal(total: number): 1 | 2 | 3 {
  return total <= 11 ? 1 : total <= 16 ? 2 : 3;
}

function rollDiceWithBonus(statBonus: number, edge: EdgeState = "normal"): PowerRollResult {
  const modifier = edgeModifier(edge);
  const d1 = 1 + Math.floor(Math.random() * 10);
  const d2 = 1 + Math.floor(Math.random() * 10);
  const bonus = statBonus + modifier;
  const total = d1 + d2 + bonus;
  const base = baseTierForTotal(total);
  const tier = Math.max(1, Math.min(3, base + edgeTierShift(edge))) as 1 | 2 | 3;
  const tag = edgeTag(edge);
  return {
    total,
    tier,
    bonus,
    edge,
    dice: [d1, d2],
    label: `${d1}+${d2}${bonus ? signed(bonus) : ""} = ${total} · T${tier}` + (tag ? ` · ${tag}` : ""),
  };
}

export function makePowerRoll(
  rollText = "Power Roll",
  actor: Monster | null = null,
  edge: EdgeState = "normal",
): PowerRollResult {
  const bonus = resolvePowerRollBonus(rollText, actor);
  return rollDiceWithBonus(bonus, edge);
}

export type CharacteristicKey = keyof Monster["chars"];

const CHAR_LABEL: Record<CharacteristicKey, string> = {
  M: "Might",
  A: "Agility",
  R: "Reason",
  I: "Intuition",
  P: "Presence",
};

export function characteristicLabel(key: CharacteristicKey): string {
  return CHAR_LABEL[key];
}

/** One-off edge override from click modifiers. Null = use the sticky modifier.
 *  Cross-platform: Cmd (mac) / Ctrl (Win/Linux) = edge, Alt/Option = bane
 *  (Ctrl+click is right-click on macOS, so mac users use Cmd). Shift upgrades
 *  either to its double; Shift alone forces a normal roll; both bases cancel. */
export function clickEdgeOverride(event: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): EdgeState | null {
  const cmd = Boolean(event.ctrlKey || event.metaKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  if (cmd && alt) return "normal";
  if (cmd && shift) return "double-edge";
  if (alt && shift) return "double-bane";
  if (cmd) return "edge";
  if (alt) return "bane";
  if (shift) return "normal";
  return null;
}

/** A raw characteristic check: 2d10 + characteristic score, edge/bane aware. */
export function makeCharacteristicRoll(
  actor: Monster,
  key: CharacteristicKey,
  edge: EdgeState = "normal",
): PowerRollResult {
  const bonus = numberFrom(actor.chars[key], 0);
  return rollDiceWithBonus(bonus, edge);
}

export interface SpeedInfo {
  value: string | number;
  note: string;
}

export function effectiveSpeed(
  monster: Monster,
  activeEffects: readonly ActiveEffect[],
): SpeedInfo {
  const goblinMode = activeEffects.some((effect) => effect.name.toLowerCase() === "goblin mode");
  if (goblinMode && monster.keywords.some((keyword) => keyword.toLowerCase() === "goblin")) {
    const base = numberFrom(monster.speed, NaN);
    if (Number.isFinite(base)) return { value: base + 2, note: "+2" };
  }
  return { value: monster.speed, note: "" };
}
