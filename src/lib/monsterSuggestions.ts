import { echelon } from "./levels.ts";
import { signed } from "./text.ts";
import type { Characteristics } from "../types.ts";

export interface SuggestOption {
  value: string;
  label?: string;
  hint?: string;
}

export const SIZE_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "1T", hint: "Tiny" },
  { value: "1S", hint: "Small" },
  { value: "1M", hint: "Medium" },
  { value: "1L", hint: "Large" },
  { value: "2", hint: "Huge (2×2)" },
  { value: "3", hint: "Gargantuan (3×3)" },
  { value: "4", hint: "Colossal (4×4)" },
  { value: "5", hint: "Titanic (5×5)" },
];

export const MOVEMENT_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Fly" },
  { value: "Hover" },
  { value: "Climb" },
  { value: "Burrow" },
  { value: "Swim" },
  { value: "Teleport" },
  { value: "Phasing" },
  { value: "Earth Glide" },
];

export const WITH_CAPTAIN_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "+2 damage bonus to strikes", hint: "Standard strike boost" },
  { value: "+3 damage bonus to strikes", hint: "Higher-echelon boost" },
  { value: "+1 edge on strikes", hint: "Accuracy boost" },
  { value: "+2 speed", hint: "Mobility boost" },
  { value: "+1 to forced movement distance", hint: "Push / pull / slide" },
  { value: "Can shift 1 square before or after striking", hint: "Skirmish" },
];

export const MONSTER_KEYWORD_BASE: readonly string[] = [
  "Abyssal",
  "Animal",
  "Beast",
  "Celestial",
  "Construct",
  "Demon",
  "Devil",
  "Dragon",
  "Dwarf",
  "Elemental",
  "Elf",
  "Fey",
  "Giant",
  "Goblin",
  "Horror",
  "Human",
  "Humanoid",
  "Infernal",
  "Kobold",
  "Lizardfolk",
  "Minotaur",
  "Monstrosity",
  "Ogre",
  "Orc",
  "Overmind",
  "Plant",
  "Psionic",
  "Radenwight",
  "Soulless",
  "Swarm",
  "Troll",
  "Undead",
  "Void",
];

const DAMAGE_TYPES = [
  "fire",
  "cold",
  "corruption",
  "poison",
  "acid",
  "lightning",
  "psychic",
  "sonic",
  "holy",
] as const;

export function defenseSuggestions(level: number): SuggestOption[] {
  const ech = echelon(level);
  const std = ech * 3;
  const heavy = ech * 5;
  return [
    ...DAMAGE_TYPES.map((type) => ({ value: `${type} ${std}`, hint: `Echelon ${ech} standard` })),
    { value: `damage ${Math.max(2, ech * 2)}`, hint: "All damage" },
    ...DAMAGE_TYPES.slice(0, 4).map((type) => ({
      value: `${type} ${heavy}`,
      hint: `Echelon ${ech} strong`,
    })),
  ];
}

export const ABILITY_TYPE_COST_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Signature Ability", hint: "Main strike · no Malice" },
  { value: "2 Malice", hint: "Minor Malice ability" },
  { value: "3 Malice", hint: "Standard Malice ability" },
  { value: "5 Malice", hint: "Major Malice ability" },
  { value: "7 Malice", hint: "Boss Malice ability" },
  { value: "Villain Action 1", hint: "Round 1 opener" },
  { value: "Villain Action 2", hint: "Mid-fight shift" },
  { value: "Villain Action 3", hint: "Climax / finale" },
  { value: "Trait", hint: "Passive feature" },
];

export const ABILITY_USAGE_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Main action" },
  { value: "Maneuver" },
  { value: "Triggered" },
  { value: "Free triggered" },
  { value: "Free maneuver" },
  { value: "Move action" },
];

export const EFFECT_LABEL_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Effect", hint: "Standard effect" },
  { value: "2 Malice", hint: "Minor Malice effect" },
  { value: "3 Malice", hint: "Standard Malice effect" },
  { value: "5 Malice", hint: "Major Malice effect" },
  { value: "Special", hint: "Special rule or restriction" },
];

export const ABILITY_KEYWORD_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Melee" },
  { value: "Ranged" },
  { value: "Strike" },
  { value: "Weapon" },
  { value: "Magic" },
  { value: "Psionic" },
  { value: "Area" },
  { value: "Charge" },
  { value: "Void" },
  { value: "Fire" },
  { value: "Cold" },
  { value: "Lightning" },
  { value: "Poison" },
  { value: "Acid" },
  { value: "Corruption" },
  { value: "Holy" },
  { value: "Sonic" },
  { value: "Psychic" },
];

export const ABILITY_DISTANCE_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "Melee 1", hint: "Adjacent" },
  { value: "Melee 2", hint: "Reach" },
  { value: "Melee 3", hint: "Long reach" },
  { value: "Ranged 5" },
  { value: "Ranged 10" },
  { value: "Ranged 15" },
  { value: "Ranged 20" },
  { value: "Self" },
  { value: "1 burst", hint: "Adjacent aura" },
  { value: "2 burst" },
  { value: "3 burst" },
  { value: "5 burst" },
  { value: "10 burst" },
  { value: "3 cube within 10" },
  { value: "4 cube within 10" },
  { value: "5 × 1 line within 1" },
  { value: "8 × 1 line within 1" },
  { value: "3 wall within 10" },
  { value: "Special" },
];

export const ABILITY_TARGET_SUGGESTIONS: readonly SuggestOption[] = [
  { value: "One creature or object" },
  { value: "One creature" },
  { value: "Two creatures or objects" },
  { value: "Each enemy in the area" },
  { value: "Each creature in the area" },
  { value: "Each ally in the area" },
  { value: "Self" },
  { value: "Self and each ally in the area" },
  { value: "One ally" },
  { value: "Two allies" },
  { value: "The triggering creature" },
  { value: "The triggering enemy" },
  { value: "Special" },
];

export function powerRollSuggestions(chars: Characteristics): SuggestOption[] {
  const top = Math.max(chars.M, chars.A, chars.R, chars.I, chars.P);
  const topStr = top >= 0 ? `Power Roll + ${top}` : `Power Roll − ${Math.abs(top)}`;
  return [
    { value: topStr, hint: "Highest characteristic" },
    { value: "Power Roll + M", hint: `Might (${signed(chars.M)})` },
    { value: "Power Roll + A", hint: `Agility (${signed(chars.A)})` },
    { value: "Power Roll + R", hint: `Reason (${signed(chars.R)})` },
    { value: "Power Roll + I", hint: `Intuition (${signed(chars.I)})` },
    { value: "Power Roll + P", hint: `Presence (${signed(chars.P)})` },
  ];
}

export function maliceCostLabelSuggestions(cost: number): SuggestOption[] {
  return [
    { value: `${cost} Malice`, hint: "Standard cost" },
    { value: `${cost}+ Malice`, hint: "Variable / escalating" },
    { value: `${cost} Malice (Special)`, hint: "Special condition" },
  ];
}

export function mergeKeywordSuggestions(
  catalogKeywords: readonly (readonly [string, string])[],
): SuggestOption[] {
  const map = new Map<string, string>();
  for (const kw of MONSTER_KEYWORD_BASE) {
    map.set(kw.toLowerCase(), kw);
  }
  for (const [, label] of catalogKeywords) {
    if (label) map.set(label.toLowerCase(), label);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b)).map((value) => ({ value }));
}
