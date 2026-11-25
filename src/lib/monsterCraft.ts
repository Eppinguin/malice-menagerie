import {
  autoLinkFeature,
  BUILTIN_COMPENDIUM_TERMS,
  type CompendiumTerm,
} from "./compendiumLinks.ts";
import { blankHomebrewMonster, homebrewToMonster, makeAbilityTemplate } from "./homebrew.ts";
import { monsterTargetSheet } from "./monsterGuide.ts";
import { uuidv7 } from "./id.ts";
import { numberFrom } from "./text.ts";
import type { Characteristics, FeatureEffect, HomebrewMonster, MonsterFeature } from "../types.ts";

// ---------- 1. Role-Smart Starter Kits ----------

function topChar(chars: Characteristics): number {
  return Math.max(chars.M, chars.A, chars.R, chars.I, chars.P);
}

function rollStr(bonus: number): string {
  return bonus >= 0 ? `Power Roll + ${bonus}` : `Power Roll − ${Math.abs(bonus)}`;
}

function villainActionsFor(
  level: number,
  org: string,
  role: string,
  chars: Characteristics,
): MonsterFeature[] {
  const sheet = monsterTargetSheet(level, org, role);
  const roll = rollStr(topChar(chars));
  const avg = sheet.potency.average;
  const strong = sheet.potency.strong;
  return [
    {
      name: "Opening Command",
      icon: "☠",
      cost: "Villain Action 1",
      usage: "Villain Action",
      keywords: ["Area"],
      distance: "5 burst",
      target: "Each ally in the area",
      effects: [
        {
          name: "Effect",
          effect: "Each target shifts up to their speed and can make a free strike.",
        },
      ],
    },
    {
      name: "Turn the Tide",
      icon: "❇",
      cost: "Villain Action 2",
      usage: "Villain Action",
      keywords: ["Area", "Magic"],
      distance: "3 burst",
      target: "Each enemy in the area",
      effects: [
        {
          roll,
          tier1: `${sheet.areaDamage.tier1} damage; push 2`,
          tier2: `${sheet.areaDamage.tier2} damage; push 3; M < ${avg}, prone`,
          tier3: `${sheet.areaDamage.tier3} damage; push 5; M < ${strong}, prone`,
        },
      ],
    },
    {
      name: "Desperate Crescendo",
      icon: "☠",
      cost: "Villain Action 3",
      usage: "Villain Action",
      keywords: ["Area"],
      distance: "10 burst",
      target: "Self and each ally in the area",
      effects: [
        {
          name: "Effect",
          effect:
            "Each target ends one condition affecting them, gains an edge on their next power roll, and deals extra damage equal to this creature's highest characteristic until the end of the round.",
        },
      ],
    },
  ];
}

/**
 * Build an authentic Draw Steel starter kit of abilities & traits tailored to
 * the chosen Level, Organization, and Role so new monsters start playable.
 */
export function buildRoleStarterFeatures(
  level: number,
  organization: string,
  role: string,
  chars: Characteristics,
  glossary: readonly CompendiumTerm[] = BUILTIN_COMPENDIUM_TERMS,
): MonsterFeature[] {
  const orgKey = organization.trim().toLowerCase();
  const roleKey = role.trim().toLowerCase();
  const sheet = monsterTargetSheet(level, organization, role);
  const { baseline, areaDamage, potency } = sheet;
  const roll = rollStr(topChar(chars));

  const features: MonsterFeature[] = [];

  if (orgKey === "solo") {
    features.push({
      name: "Solo Monster",
      icon: "⭐",
      feature_type: "trait",
      effects: [
        {
          name: "Solo Turns",
          effect:
            "This creature can take two turns each round. They can't take turns consecutively.",
        },
        {
          name: "End Effect",
          effect:
            "At the end of each of their turns, this creature can take 5 damage to end one effect on them that can be ended by a saving throw. This damage can't be reduced in any way.",
        },
      ],
    });
  }

  // Primary signature tailored to role
  switch (roleKey) {
    case "artillery":
      features.push({
        name: "Longshot Volley",
        icon: "🏹",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Ranged", "Strike", "Weapon"],
        distance: "Ranged 12",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage`,
            tier3: `${baseline.tier3} damage; A < ${potency.strong}, slowed (EoT)`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Fallback Step",
          icon: "👤",
          usage: "Maneuver",
          keywords: ["—"],
          distance: "Self",
          target: "Self",
          effects: [{ name: "Effect", effect: "This creature shifts up to 3 squares." }],
        });
      }
      break;

    case "ambusher":
      features.push({
        name: "Backstab",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage`,
            tier3: `${baseline.tier3} damage; A < ${potency.strong}, bleeding (save ends)`,
          },
          {
            name: "Effect",
            effect:
              "This ability deals 3 extra damage if this creature has an edge on the power roll.",
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Slip into Shadow",
          icon: "👤",
          usage: "Maneuver",
          keywords: ["—"],
          distance: "Self",
          target: "Self",
          effects: [
            {
              name: "Effect",
              effect: "This creature shifts up to 3 squares and can attempt to hide.",
            },
          ],
        });
      }
      break;

    case "controller":
      features.push({
        name: "Warping Pulse",
        icon: "🔳",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Area", "Magic"],
        distance: "3 cube within 10",
        target: "Each enemy in the area",
        effects: [
          {
            roll,
            tier1: `${areaDamage.tier1} damage; slide 1`,
            tier2: `${areaDamage.tier2} damage; slide 2`,
            tier3: `${areaDamage.tier3} damage; slide 3; M < ${potency.average}, prone`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Snaring Terrain",
          icon: "❇",
          cost: "3 Malice",
          usage: "Maneuver",
          keywords: ["Area", "Magic"],
          distance: "3 cube within 10",
          target: "Special",
          effects: [
            {
              name: "Effect",
              effect:
                "Until the end of the encounter, the area is difficult terrain for enemies, and any enemy who starts their turn there takes 3 damage.",
            },
          ],
        });
      }
      break;

    case "defender":
      features.push({
        name: "Shield Bash",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage; taunted (EoT)`,
            tier3: `${baseline.tier3} damage; taunted (EoT); M < ${potency.strong}, prone`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Stand Fast",
          icon: "❗",
          usage: "Triggered",
          keywords: ["Melee"],
          distance: "Melee 1",
          target: "The triggering enemy",
          trigger: "An enemy within distance targets an ally with a strike.",
          effects: [
            {
              name: "Effect",
              effect:
                "This creature makes a free strike against the target, and the target's strike takes a bane.",
            },
          ],
        });
      }
      break;

    case "harrier":
      features.push({
        name: "Darting Slash",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage; shift 2`,
            tier3: `${baseline.tier3} damage; shift 3`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Skirmisher",
          icon: "⭐",
          feature_type: "trait",
          effects: [
            {
              effect:
                "This creature doesn't provoke opportunity attacks when moving away from enemies.",
            },
          ],
        });
      }
      break;

    case "hexer":
      features.push({
        name: "Withering Hex",
        icon: "🌀",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Magic", "Ranged", "Strike"],
        distance: "Ranged 10",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage; R < ${potency.weak}, weakened (save ends)`,
            tier2: `${baseline.tier2} damage; R < ${potency.average}, weakened (save ends)`,
            tier3: `${baseline.tier3} damage; R < ${potency.strong}, dazed (save ends)`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Twist Fate",
          icon: "❗",
          cost: "2 Malice",
          usage: "Triggered",
          keywords: ["Magic", "Ranged"],
          distance: "Ranged 10",
          target: "The triggering creature",
          trigger: "An enemy within distance gets a tier 3 outcome on a power roll.",
          effects: [
            {
              name: "Effect",
              effect: "The triggering roll becomes a tier 2 outcome instead.",
            },
          ],
        });
      }
      break;

    case "mount":
      features.push({
        name: "Trampling Charge",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage; push 2`,
            tier3: `${baseline.tier3} damage; push 3; M < ${potency.strong}, prone`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "War Steed",
          icon: "⭐",
          feature_type: "trait",
          effects: [
            {
              effect:
                "While ridden, the rider moves with this creature and gains an edge on melee strikes against smaller targets.",
            },
          ],
        });
      }
      break;

    case "support":
      features.push({
        name: "Guiding Bolt",
        icon: "🌀",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Magic", "Ranged", "Strike"],
        distance: "Ranged 10",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage`,
            tier3: `${baseline.tier3} damage`,
          },
          {
            name: "Effect",
            effect: "One ally within 5 squares of the target gains an edge on their next strike.",
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Bolster Ally",
          icon: "👤",
          cost: "2 Malice",
          usage: "Maneuver",
          keywords: ["Magic", "Ranged"],
          distance: "Ranged 10",
          target: "Two allies",
          effects: [
            {
              name: "Effect",
              effect: `Each target regains ${Math.max(5, Math.round(baseline.stamina * 0.25))} Stamina and can shift 2 squares.`,
            },
          ],
        });
      }
      break;

    case "brute":
    default:
      features.push({
        name: "Crushing Blow",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll,
            tier1: `${baseline.tier1} damage`,
            tier2: `${baseline.tier2} damage; push 2`,
            tier3: `${baseline.tier3} damage; push 4; M < ${potency.strong}, prone`,
          },
        ],
      });
      if (orgKey !== "minion") {
        features.push({
          name: "Sweeping Smash",
          icon: "❇",
          cost: "3 Malice",
          usage: "Main action",
          keywords: ["Area", "Melee", "Weapon"],
          distance: "1 burst",
          target: "Each enemy in the area",
          effects: [
            {
              roll,
              tier1: `${areaDamage.tier1} damage`,
              tier2: `${areaDamage.tier2} damage; push 2`,
              tier3: `${areaDamage.tier3} damage; push 3; M < ${potency.average}, prone`,
            },
          ],
        });
      }
      break;
  }

  if (orgKey === "leader" || orgKey === "solo") {
    features.push(...villainActionsFor(level, organization, role, chars));
  }

  return features.map((f) => autoLinkFeature(f, glossary).feature);
}

// ---------- 2. Tier Building Blocks & One-Tap Ability Rescaler ----------

export type TierKey = "tier1" | "tier2" | "tier3";
export const TIER_KEYS: readonly TierKey[] = ["tier1", "tier2", "tier3"];

/**
 * A building block for Power Roll tiers. Each chip carries the clause it writes
 * into every tier, scaled the way official statblocks escalate: potency steps
 * weak → average → strong and forced movement grows by one square per tier.
 */
export interface TierInsertChip {
  id: string;
  group: "condition" | "move";
  clauses: Record<TierKey, string>;
  /** Compact label for the "all tiers" scope, e.g. "M < 0/1/2, prone". */
  rangeLabel: string;
}

const POTENCY_CONDITIONS: ReadonlyArray<{ id: string; char: string; tail: string }> = [
  { id: "prone", char: "M", tail: "prone" },
  { id: "grabbed", char: "M", tail: "grabbed" },
  { id: "slowed", char: "A", tail: "slowed (EoT)" },
  { id: "bleeding", char: "A", tail: "bleeding (save ends)" },
  { id: "dazed", char: "R", tail: "dazed (save ends)" },
  { id: "frightened", char: "P", tail: "frightened (EoT)" },
];

const FORCED_MOVES = ["push", "pull", "slide"] as const;

export function tierInsertChips(
  monster: Pick<HomebrewMonster, "level" | "organization" | "role">,
  _glossary: readonly CompendiumTerm[] = BUILTIN_COMPENDIUM_TERMS,
): TierInsertChip[] {
  const { potency } = monsterTargetSheet(monster.level, monster.organization, monster.role);
  const pots = [potency.weak, potency.average, potency.strong] as const;
  const perTier = (fn: (idx: number) => string): Record<TierKey, string> => ({
    tier1: fn(0),
    tier2: fn(1),
    tier3: fn(2),
  });

  const conditions: TierInsertChip[] = POTENCY_CONDITIONS.map(({ id, char, tail }) => ({
    id,
    group: "condition",
    clauses: perTier((i) => `${char} < ${pots[i]}, ${tail}`),
    rangeLabel: `${char} < ${pots.join("/")}, ${tail}`,
  }));
  conditions.push({
    id: "taunted",
    group: "condition",
    clauses: perTier(() => "taunted (EoT)"),
    rangeLabel: "taunted (EoT)",
  });

  const moves: TierInsertChip[] = FORCED_MOVES.map((verb) => ({
    id: verb,
    group: "move",
    clauses: perTier((i) => `${verb} ${i + 1}`),
    rangeLabel: `${verb} 1/2/3`,
  }));

  return [...conditions, ...moves];
}

export function appendTierClause(current: string, clause: string): string {
  const trimmed = current.trim();
  if (!trimmed) return clause;
  const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  const existing = trimmed.split(";").map(norm);
  if (existing.includes(norm(clause))) return trimmed;
  const sep = trimmed.endsWith(";") || trimmed.endsWith(",") ? " " : "; ";
  return `${trimmed}${sep}${clause}`;
}

/**
 * Rescale an ability's Power Roll bonus, tier damage numbers, and potencies to
 * match the monster's current Level, Organization, Role, and Characteristics
 * while preserving damage types, forced movement, and conditions.
 */
export function rescaleAbilityToMonster(
  feature: MonsterFeature,
  monster: Pick<HomebrewMonster, "level" | "organization" | "role" | "chars">,
  mode: "single" | "area",
): MonsterFeature {
  const sheet = monsterTargetSheet(monster.level, monster.organization, monster.role);
  const targets =
    mode === "area"
      ? [sheet.areaDamage.tier1, sheet.areaDamage.tier2, sheet.areaDamage.tier3]
      : [sheet.baseline.tier1, sheet.baseline.tier2, sheet.baseline.tier3];
  const roll = rollStr(topChar(monster.chars));
  const potTargets = [sheet.potency.weak, sheet.potency.average, sheet.potency.strong];

  const effects = (feature.effects ?? []).map((effect): FeatureEffect => {
    const next: FeatureEffect = { ...effect };
    if (next.roll || next.tier1 || next.tier2 || next.tier3) {
      next.roll = roll;
    }
    const keys = ["tier1", "tier2", "tier3"] as const;
    keys.forEach((key, idx) => {
      const val = next[key];
      const dmg = targets[idx]!;
      const pot = potTargets[idx]!;
      if (!val) {
        if (next.roll) next[key] = `${dmg} damage`;
        return;
      }
      let updated = val;
      const damagePattern =
        /\b\d+((?:\s+(?:acid|cold|corruption|fire|holy|lightning|poison|psychic|sonic))?\s+(?:\[damage\]\([^)]+\)|damage))\b/i;
      if (damagePattern.test(updated)) {
        updated = updated.replace(damagePattern, `${dmg}$1`);
      } else {
        updated = `${dmg} damage; ${updated}`;
      }
      updated = updated.replace(
        /\b([MARIP])\s*<\s*(-?\d+)\b/g,
        (_m, ch: string) => `${ch} < ${pot}`,
      );
      next[key] = updated;
    });
    return next;
  });

  return { ...feature, effects };
}

// ---------- 3. Live Director's Margin Notes (Non-Blocking Sanity Checks) ----------

export type SanityFixKind =
  | "sync-rolls"
  | "set-solo-turns"
  | "add-villain-actions"
  | "add-with-captain"
  | "add-signature";

export interface SanityNote {
  id: string;
  message: string;
  fixLabel?: string;
  fixKind?: SanityFixKind;
}

const POWER_ROLL_BONUS_RE = /^Power Roll\s*([+−-])\s*(\d+)/i;

export function analyzeMonsterSanity(monster: HomebrewMonster): SanityNote[] {
  const notes: SanityNote[] = [];
  const sheet = monsterTargetSheet(monster.level, monster.organization, monster.role);
  const orgKey = monster.organization.trim().toLowerCase();
  const top = topChar(monster.chars);

  // 1. Missing signature ability
  const hasSignature = monster.features.some((f) =>
    /signature/i.test(String(f.ability_type ?? "")),
  );
  if (!hasSignature && monster.features.length > 0) {
    notes.push({
      id: "missing-signature",
      message: "No Signature Ability yet.",
      fixLabel: "Add Signature",
      fixKind: "add-signature",
    });
  }

  // 2. Power Roll bonus vs highest characteristic
  let hasRollMismatch = false;
  let badTierOrder = false;
  for (const feature of monster.features) {
    for (const eff of feature.effects ?? []) {
      if (eff.roll) {
        const m = POWER_ROLL_BONUS_RE.exec(eff.roll.trim());
        if (m?.[1] && m[2]) {
          const val = (m[1] === "+" ? 1 : -1) * Number(m[2]);
          if (val !== top) hasRollMismatch = true;
        }
      }
      const d1 = eff.tier1
        ? numberFrom(eff.tier1.match(/\b(\d+)(?:\s+\w+)?\s+damage\b/i)?.[1], -1)
        : -1;
      const d2 = eff.tier2
        ? numberFrom(eff.tier2.match(/\b(\d+)(?:\s+\w+)?\s+damage\b/i)?.[1], -1)
        : -1;
      const d3 = eff.tier3
        ? numberFrom(eff.tier3.match(/\b(\d+)(?:\s+\w+)?\s+damage\b/i)?.[1], -1)
        : -1;
      if ((d1 >= 0 && d2 >= 0 && d2 < d1) || (d2 >= 0 && d3 >= 0 && d3 < d2)) {
        badTierOrder = true;
      }
    }
  }
  if (hasRollMismatch) {
    const sign = top >= 0 ? `+${top}` : `−${Math.abs(top)}`;
    notes.push({
      id: "roll-mismatch",
      message: `A Power Roll bonus doesn't match the highest characteristic (${sign}).`,
      fixLabel: `Sync rolls to ${sign}`,
      fixKind: "sync-rolls",
    });
  }
  if (badTierOrder) {
    notes.push({
      id: "tier-order",
      message: "A higher tier deals less damage than a lower tier.",
    });
  }

  // 3. Organization-specific Draw Steel conventions
  const villainCount = monster.features.filter((f) =>
    /villain\s*action/i.test(`${f.cost ?? ""} ${f.usage ?? ""}`),
  ).length;

  if (orgKey === "solo") {
    const runtime = homebrewToMonster(monster);
    if (runtime.turnsPerRound < 2) {
      notes.push({
        id: "solo-turns",
        message: "Solos normally take 2 turns per round.",
        fixLabel: "Set 2 turns",
        fixKind: "set-solo-turns",
      });
    }
    if (villainCount === 0) {
      notes.push({
        id: "solo-villain",
        message: "Solos usually have Villain Actions 1–3.",
        fixLabel: "Add Villain Actions",
        fixKind: "add-villain-actions",
      });
    }
  } else if (orgKey === "leader" && villainCount === 0) {
    notes.push({
      id: "leader-villain",
      message: "Leaders usually have Villain Actions 1–3.",
      fixLabel: "Add Villain Actions",
      fixKind: "add-villain-actions",
    });
  } else if (orgKey === "minion") {
    if (!monster.withCaptain.trim()) {
      notes.push({
        id: "minion-captain",
        message: "Minions usually have a With Captain bonus.",
        fixLabel: "Add With Captain",
        fixKind: "add-with-captain",
      });
    }
    const hasMaliceAbility = monster.features.some((f) => /malice/i.test(String(f.cost ?? "")));
    if (hasMaliceAbility) {
      notes.push({
        id: "minion-malice",
        message:
          "Minions rarely spend Malice on individual abilities (use Encounter Malice instead).",
      });
    }
  }

  // 4. Stamina sanity check (only when noticeably off)
  const expectedStamina = sheet.baseline.stamina;
  if (expectedStamina >= 10) {
    if (monster.stamina < expectedStamina * 0.55) {
      notes.push({
        id: "stamina-low",
        message: `Stamina (${monster.stamina}) is well below baseline (${expectedStamina}).`,
      });
    } else if (monster.stamina > expectedStamina * 1.75) {
      notes.push({
        id: "stamina-high",
        message: `Stamina (${monster.stamina}) is well above baseline (${expectedStamina}).`,
      });
    }
  }

  return notes;
}

export function applySanityFix(
  monster: HomebrewMonster,
  fixKind: SanityFixKind,
  glossary: readonly CompendiumTerm[] = BUILTIN_COMPENDIUM_TERMS,
): HomebrewMonster {
  const top = topChar(monster.chars);
  const roll = rollStr(top);
  switch (fixKind) {
    case "sync-rolls":
      return {
        ...monster,
        features: monster.features.map((f) => ({
          ...f,
          effects: (f.effects ?? []).map((eff) =>
            eff.roll && POWER_ROLL_BONUS_RE.test(eff.roll.trim()) ? { ...eff, roll } : eff,
          ),
        })),
      };
    case "set-solo-turns":
      return { ...monster, turnsPerRound: 2 };
    case "add-villain-actions":
      return {
        ...monster,
        features: [
          ...monster.features,
          ...villainActionsFor(
            monster.level,
            monster.organization,
            monster.role,
            monster.chars,
          ).map((f) => autoLinkFeature(f, glossary).feature),
        ],
      };
    case "add-with-captain":
      return { ...monster, withCaptain: "+2 damage bonus to strikes" };
    case "add-signature":
      return {
        ...monster,
        features: [
          autoLinkFeature(makeAbilityTemplate("signature", monster), glossary).feature,
          ...monster.features,
        ],
      };
  }
}

// ---------- 4. "New Monster in This Family" Faction Builder ----------

const NEXT_ORG_SUGGESTION: Record<string, { organization: string; role: string }> = {
  solo: { organization: "Minion", role: "Harrier" },
  leader: { organization: "Minion", role: "Brute" },
  elite: { organization: "Minion", role: "Harrier" },
  platoon: { organization: "Horde", role: "Artillery" },
  horde: { organization: "Elite", role: "Brute" },
  minion: { organization: "Platoon", role: "Defender" },
};

/**
 * Create a fresh sibling monster in the same custom faction: inherits family,
 * keywords, elemental defenses, author, and attached Custom Malice while
 * picking a complementary Organization + Role with ready-to-edit role abilities.
 */
export function newSiblingInFamily(
  source: HomebrewMonster,
  glossary: readonly CompendiumTerm[] = BUILTIN_COMPENDIUM_TERMS,
): HomebrewMonster {
  const suggestion = NEXT_ORG_SUGGESTION[source.organization.toLowerCase()] ?? {
    organization: "Platoon",
    role: "Artillery",
  };
  const fresh = blankHomebrewMonster(source.level, suggestion.organization, suggestion.role);
  fresh.id = uuidv7();
  fresh.familyPath = source.familyPath;
  fresh.keywords = [...source.keywords];
  fresh.immunities = [...source.immunities];
  fresh.weaknesses = [...source.weaknesses];
  if (source.maliceIds?.length) fresh.maliceIds = [...source.maliceIds];
  if (source.origin?.author) {
    fresh.origin = { kind: "local", author: source.origin.author };
  }
  fresh.features = buildRoleStarterFeatures(
    fresh.level,
    fresh.organization,
    fresh.role,
    fresh.chars,
    glossary,
  );
  return fresh;
}
