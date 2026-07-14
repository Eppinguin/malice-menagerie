import { numberFrom, signed } from "./text.ts";
import type { ActiveEffect, Difficulty, Monster, Party, PowerRollResult } from "../types.ts";

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

export function makePowerRoll(
  rollText = "Power Roll",
  actor: Monster | null = null,
): PowerRollResult {
  const bonus = resolvePowerRollBonus(rollText, actor);
  const d1 = 1 + Math.floor(Math.random() * 10);
  const d2 = 1 + Math.floor(Math.random() * 10);
  const total = d1 + d2 + bonus;
  const tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
  return {
    total,
    tier,
    bonus,
    label: `${d1}+${d2}${bonus ? signed(bonus) : ""} = ${total} · T${tier}`,
  };
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
