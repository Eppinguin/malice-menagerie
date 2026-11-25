import { echelon } from "./levels.ts";
import { baselineMonsterStats, type BaselineMonsterStats } from "./homebrew.ts";

export interface RoleGuide {
  name: string;
  /** One line for the role picker. */
  brief: string;
  staminaMod: number;
  damageMod: number;
  typicalSpeed: string;
  typicalStability: string;
  primaryChars: string;
  job: string;
  tip: string;
}

export interface OrganizationGuide {
  name: string;
  /** One line for the organization picker. */
  brief: string;
  evMult: string;
  staminaMult: string;
  summary: string;
  tip: string;
}

export const ROLE_GUIDES: readonly RoleGuide[] = [
  {
    name: "Ambusher",
    brief: "Bursts from hiding, then slips away",
    staminaMod: 20,
    damageMod: 1,
    typicalSpeed: "6–7",
    typicalStability: "0–1",
    primaryChars: "Agility, Might / Intuition",
    job: "Strikes hard from hiding or flanking, then slips out of reach.",
    tip: "Pair high single-target burst with Hide, shift, or concealed-attack triggers.",
  },
  {
    name: "Artillery",
    brief: "Ranged or area damage; fragile up close",
    staminaMod: 10,
    damageMod: 1,
    typicalSpeed: "5",
    typicalStability: "0",
    primaryChars: "Agility / Reason, Intuition",
    job: "High ranged or area damage from the backline; fragile if pinned down.",
    tip: "Give long range (10–15) or small areas, and keep Stamina low so closing distance pays off.",
  },
  {
    name: "Brute",
    brief: "Heavy melee hitter with big pushes",
    staminaMod: 30,
    damageMod: 1,
    typicalSpeed: "5",
    typicalStability: "2",
    primaryChars: "Might, Agility / Presence",
    job: "Heavy melee hitter with high Stamina and forced movement (push/knockback).",
    tip: "Reward heroes for kiting or focusing fire; attach Might potencies like prone or big pushes.",
  },
  {
    name: "Controller",
    brief: "Terrain, slides, pulls and zones",
    staminaMod: 10,
    damageMod: 0,
    typicalSpeed: "5",
    typicalStability: "0–1",
    primaryChars: "Reason / Presence, Intuition",
    job: "Reshapes the battlefield with terrain hazards, slides, pulls, and zones.",
    tip: "Trade raw damage for forced movement, difficult terrain, or multi-target area pressure.",
  },
  {
    name: "Defender",
    brief: "Holds the line and taunts",
    staminaMod: 30,
    damageMod: 0,
    typicalSpeed: "5",
    typicalStability: "2–3",
    primaryChars: "Might, Intuition / Presence",
    job: "Holds the line, taunts heroes, and punishes enemies who ignore them.",
    tip: "Give high Stability, taunted/grabbed potencies, and a triggered action that protects allies.",
  },
  {
    name: "Harrier",
    brief: "Fast skirmisher that harasses the backline",
    staminaMod: 20,
    damageMod: 0,
    typicalSpeed: "7+",
    typicalStability: "0–1",
    primaryChars: "Agility, Might",
    job: "Fast skirmisher that darts across lanes, harasses backliners, and repositions.",
    tip: "Build shift/charge movement directly into the signature strike so turns stay kinetic.",
  },
  {
    name: "Hexer",
    brief: "Conditions and debuffs",
    staminaMod: 10,
    damageMod: 0,
    typicalSpeed: "5",
    typicalStability: "0",
    primaryChars: "Reason / Presence, Intuition",
    job: "Debuffs heroes with conditions (weakened, slowed, dazed, bleeding, frightened).",
    tip: "Anchor abilities around Average/Strong potencies and save-ends or EoT conditions.",
  },
  {
    name: "Mount",
    brief: "Carries a rider; tramples",
    staminaMod: 20,
    damageMod: 0,
    typicalSpeed: "7–8",
    typicalStability: "1–2",
    primaryChars: "Might, Agility",
    job: "Carries a rider, grants mobility, and tramples or knocks foes prone.",
    tip: "Usually Size 2+; include a trait explaining how rider and mount move or strike together.",
  },
  {
    name: "Support",
    brief: "Heals and boosts its allies",
    staminaMod: 20,
    damageMod: 0,
    typicalSpeed: "5–6",
    typicalStability: "0–1",
    primaryChars: "Intuition / Presence, Reason",
    job: "Heals, shields, repositions, or grants edges/free strikes to allied monsters.",
    tip: "Keep support abilities active on the board—healing Stamina, ending conditions, or boosting allies.",
  },
];

export const ORG_GUIDES: readonly OrganizationGuide[] = [
  {
    name: "Minion",
    brief: "Squads of four with shared Stamina",
    evMult: "× 0.5 (for 4)",
    staminaMult: "× 0.125 (each)",
    summary: "Four minions act as one squad with a shared Stamina pool and one signature strike.",
    tip: "Give 1 concise signature ability (no Malice cost), optional simple trait, and a With Captain bonus.",
  },
  {
    name: "Horde",
    brief: "Half a creature, fielded in packs",
    evMult: "× 0.5",
    staminaMult: "× 0.5",
    summary: "Half a standard creature—fielded in packs of 2–4 per activation group.",
    tip: "Keep statblocks crisp (signature + 1 maneuver/triggered or trait) so groups run briskly.",
  },
  {
    name: "Platoon",
    brief: "The standard rank and file",
    evMult: "× 1",
    staminaMult: "× 1",
    summary: "The standard rank-and-file monster; one roughly matches a single hero's share.",
    tip: "Signature ability, 1 Malice or triggered ability, and 1 memorable trait is the sweet spot.",
  },
  {
    name: "Elite",
    brief: "A tough lieutenant, worth two platoons",
    evMult: "× 2",
    staminaMult: "× 2",
    summary: "Tough lieutenant worth two platoons (+1 extra damage modifier over its role).",
    tip: "Great centerpiece for a group or squad captain; give 1 strong Malice spender and a reactive trigger.",
  },
  {
    name: "Leader",
    brief: "Commands allies; has Villain Actions",
    evMult: "× 2",
    staminaMult: "× 2 (+30 role)",
    summary: "Boss of a mixed encounter: commands allies and brings 3 Villain Actions.",
    tip: "Gets +1 higher top characteristic (max +5), +1 damage mod, and Villain Actions 1–3 (1 per round).",
  },
  {
    name: "Solo",
    brief: "A whole encounter: two turns a round",
    evMult: "× 6",
    staminaMult: "× 5 (+30 role)",
    summary: "A whole encounter in one monster: takes 2 turns per round and 3 Villain Actions.",
    tip: "Set Turns per round to 2, add Solo Turns + End Effect traits, and design escalating Villain Actions.",
  },
];

export function roleGuideFor(role: string): RoleGuide | undefined {
  const key = role.trim().toLowerCase();
  return ROLE_GUIDES.find((item) => item.name.toLowerCase() === key);
}

export function orgGuideFor(org: string): OrganizationGuide | undefined {
  const key = org.trim().toLowerCase();
  return ORG_GUIDES.find((item) => item.name.toLowerCase() === key);
}

export interface TargetSheet {
  echelon: number;
  baseline: BaselineMonsterStats;
  potency: { weak: number; average: number; strong: number };
  areaDamage: { tier1: number; tier2: number; tier3: number };
  roleGuide?: RoleGuide;
  orgGuide?: OrganizationGuide;
}

export function monsterTargetSheet(level: number, organization: string, role: string): TargetSheet {
  const baseline = baselineMonsterStats(level, organization, role);
  const top = baseline.topChar;
  const roleGuide = roleGuideFor(role);
  const orgGuide = orgGuideFor(organization);
  return {
    echelon: echelon(level),
    baseline,
    potency: {
      weak: Math.max(0, top - 2),
      average: Math.max(0, top - 1),
      strong: top,
    },
    areaDamage: {
      tier1: Math.max(1, Math.round(baseline.tier1 * 0.8)),
      tier2: Math.max(2, Math.round(baseline.tier2 * 0.8)),
      tier3: Math.max(3, Math.round(baseline.tier3 * 0.8)),
    },
    ...(roleGuide ? { roleGuide } : {}),
    ...(orgGuide ? { orgGuide } : {}),
  };
}
