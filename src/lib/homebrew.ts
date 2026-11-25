import { basePath, echelon, LEVEL_MAX } from "./levels.ts";
import { homebrewMaliceId, homebrewMonsterPath, uuidv7 } from "./id.ts";
import { clampInt, numberFrom, parseEv, slugToLabel, WORD_NUMBERS } from "./text.ts";
import { isRecord } from "../types.ts";
import type {
  CatalogEntry,
  Characteristics,
  FeatureEffect,
  HomebrewMalice,
  HomebrewMonster,
  HomebrewOrigin,
  MaliceFeature,
  Monster,
  MonsterFeature,
  RawStatblock,
} from "../types.ts";

/** Homebrew monsters can start at Level 0 (e.g. Level 0 minions/creatures). */
export const HOMEBREW_LEVEL_MIN = 0;

/** Generous integer bounds for custom homebrew characteristics (book rules cap at −5..+5). */
export const HOMEBREW_CHAR_MIN = -99;
export const HOMEBREW_CHAR_MAX = 99;

export const ORGANIZATIONS = ["Minion", "Horde", "Platoon", "Elite", "Leader", "Solo"] as const;

export const ROLES = [
  "Ambusher",
  "Artillery",
  "Brute",
  "Controller",
  "Defender",
  "Harrier",
  "Hexer",
  "Mount",
  "Support",
] as const;

export const ABILITY_ICONS: readonly { emoji: string; label: string }[] = [
  { emoji: "🗡", label: "Melee strike" },
  { emoji: "🏹", label: "Ranged strike" },
  { emoji: "⚔", label: "Melee & ranged" },
  { emoji: "❇", label: "Area / burst" },
  { emoji: "🔳", label: "Area / cube" },
  { emoji: "🌀", label: "Magic / psionic" },
  { emoji: "❗", label: "Triggered" },
  { emoji: "👤", label: "Maneuver / self" },
  { emoji: "⭐", label: "Trait" },
  { emoji: "☠", label: "Villain / Malice" },
];

const ROLE_STAMINA_MOD: Record<string, number> = {
  ambusher: 20,
  artillery: 10,
  brute: 30,
  controller: 10,
  defender: 30,
  harrier: 20,
  hexer: 10,
  mount: 20,
  support: 20,
};

const ROLE_DAMAGE_MOD: Record<string, number> = {
  ambusher: 1,
  artillery: 1,
  brute: 1,
};

const EV_ORG_MOD: Record<string, number> = {
  minion: 0.5,
  horde: 0.5,
  platoon: 1,
  elite: 2,
  leader: 2,
  solo: 6,
};

const STAMINA_ORG_MOD: Record<string, number> = {
  minion: 0.125,
  horde: 0.5,
  platoon: 1,
  elite: 2,
  leader: 2,
  solo: 5,
};

const ROLE_CHARS: Record<string, (top: number) => Characteristics> = {
  ambusher: (t) => ({ M: t - 1, A: t, R: 0, I: t - 1, P: -1 }),
  artillery: (t) => ({ M: -1, A: t, R: t - 1, I: t - 1, P: 0 }),
  brute: (t) => ({ M: t, A: t - 1, R: -1, I: 0, P: 0 }),
  controller: (t) => ({ M: 0, A: t - 1, R: t, I: t - 1, P: t - 1 }),
  defender: (t) => ({ M: t, A: 0, R: -1, I: t - 1, P: 0 }),
  harrier: (t) => ({ M: t - 1, A: t, R: -1, I: 0, P: 0 }),
  hexer: (t) => ({ M: -1, A: 0, R: t, I: t - 1, P: t - 1 }),
  mount: (t) => ({ M: t, A: t - 1, R: -2, I: 0, P: -1 }),
  support: (t) => ({ M: 0, A: 0, R: t - 1, I: t, P: t - 1 }),
};

export interface BaselineMonsterStats {
  ev: string;
  stamina: number;
  freeStrike: string;
  speed: string;
  stability: string;
  size: string;
  topChar: number;
  chars: Characteristics;
  tier1: number;
  tier2: number;
  tier3: number;
  turnsPerRound: number;
}

function clampBookChar(value: number): number {
  return Math.max(-5, Math.min(5, Math.round(value)));
}

function sanitizeChar(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n === 0) return 0;
  return Math.max(HOMEBREW_CHAR_MIN, Math.min(HOMEBREW_CHAR_MAX, n));
}

function roundUp(value: number): number {
  return Math.ceil(value - 1e-9);
}

/**
 * Draw Steel Monsters book baseline math for a given level, organization, and
 * role. Used to auto-fill new homebrew monsters and suggest rescaled numbers.
 */
export function baselineMonsterStats(
  levelInput: number,
  organization: string,
  role: string,
): BaselineMonsterStats {
  const level = clampInt(levelInput, HOMEBREW_LEVEL_MIN, LEVEL_MAX);
  const org = organization.trim().toLowerCase();
  const roleKey = role.trim().toLowerCase();
  const isBoss = org === "leader" || org === "solo";
  const isMinionOrg = org === "minion";

  const evOrg = EV_ORG_MOD[org] ?? 1;
  const evNum = Math.max(1, roundUp((2 * level + 4) * evOrg));
  const ev = isMinionOrg ? `${evNum} for four minions` : String(evNum);

  const roleMod = isBoss ? 30 : (ROLE_STAMINA_MOD[roleKey] ?? 20);
  const staminaOrg = STAMINA_ORG_MOD[org] ?? 1;
  const stamina = Math.max(1, roundUp((10 * level + roleMod) * staminaOrg));

  const dmgMod =
    org === "leader"
      ? 1
      : org === "solo"
        ? 2
        : (ROLE_DAMAGE_MOD[roleKey] ?? 0) + (org === "elite" ? 1 : 0);

  const topChar = Math.min(5, 1 + echelon(level) + (isBoss ? 1 : 0));
  const rawChars = (ROLE_CHARS[roleKey] ?? ROLE_CHARS["harrier"]!)(topChar);
  const chars: Characteristics = {
    M: clampBookChar(rawChars.M),
    A: clampBookChar(rawChars.A),
    R: clampBookChar(rawChars.R),
    I: clampBookChar(rawChars.I),
    P: clampBookChar(rawChars.P),
  };

  const baseDamage = 4 + level + dmgMod;
  const freeStrikeNum = isMinionOrg
    ? Math.max(1, roundUp(baseDamage * 0.35))
    : Math.max(2, roundUp(baseDamage * 0.65));

  const tier2 = isMinionOrg
    ? Math.max(2, roundUp(baseDamage * 0.45))
    : Math.max(3, baseDamage + topChar);
  const tier1 = isMinionOrg
    ? Math.max(1, freeStrikeNum)
    : Math.max(2, roundUp(baseDamage * 0.6) + topChar);
  const tier3 = isMinionOrg
    ? Math.max(tier2 + 1, roundUp(baseDamage * 0.65))
    : Math.max(tier2 + 2, roundUp(baseDamage * 1.3) + topChar);

  const speed =
    roleKey === "harrier" || roleKey === "mount"
      ? "7"
      : roleKey === "ambusher"
        ? "6"
        : roleKey === "defender"
          ? "5"
          : "5";
  const stability =
    org === "solo"
      ? "3"
      : org === "leader" || roleKey === "defender" || roleKey === "brute"
        ? "2"
        : roleKey === "mount"
          ? "1"
          : "0";
  const size = org === "solo" ? "2" : roleKey === "brute" || roleKey === "mount" ? "1L" : "1M";

  return {
    ev,
    stamina,
    freeStrike: String(freeStrikeNum),
    speed,
    stability,
    size,
    topChar,
    chars,
    tier1,
    tier2,
    tier3,
    turnsPerRound: org === "solo" ? 2 : 1,
  };
}

export type AbilityTemplateKind = "signature" | "malice" | "triggered" | "villain" | "trait";

const VILLAIN_NUM_RE = /villain\s*action\s*(\d+)/i;

/**
 * Find the lowest missing Villain Action number (1, 2, 3, …) across a
 * monster's existing features so adding a Villain Action fills gaps or counts
 * up automatically.
 */
export function nextVillainActionNumber(features: readonly MonsterFeature[] | undefined): number {
  const used = new Set<number>();
  for (const f of features ?? []) {
    const raw = `${f.cost ?? ""} ${f.ability_type ?? ""} ${f.usage ?? ""}`;
    const match = VILLAIN_NUM_RE.exec(raw);
    if (match?.[1]) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n >= 1) used.add(n);
    }
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return next;
}

export function makeAbilityTemplate(
  kind: AbilityTemplateKind,
  monster: Pick<HomebrewMonster, "level" | "organization" | "role" | "chars" | "name"> & {
    features?: readonly MonsterFeature[];
  },
): MonsterFeature {
  const stats = baselineMonsterStats(monster.level, monster.organization, monster.role);
  const top = Math.max(
    monster.chars.M,
    monster.chars.A,
    monster.chars.R,
    monster.chars.I,
    monster.chars.P,
  );
  const rollBonus = top >= 0 ? `+ ${top}` : `− ${Math.abs(top)}`;
  const potency = Math.max(0, Math.min(6, top));

  switch (kind) {
    case "signature":
      return {
        name: "Signature Strike",
        icon: "🗡",
        ability_type: "Signature Ability",
        usage: "Main action",
        keywords: ["Melee", "Strike", "Weapon"],
        distance: "Melee 1",
        target: "One creature or object",
        effects: [
          {
            roll: `Power Roll ${rollBonus}`,
            tier1: `${stats.tier1} damage`,
            tier2: `${stats.tier2} damage`,
            tier3: `${stats.tier3} damage; M < ${potency}, prone`,
          },
        ],
      };
    case "malice":
      return {
        name: "Ruinous Surge",
        icon: "❇",
        cost: "3 Malice",
        usage: "Main action",
        keywords: ["Area", "Magic"],
        distance: "2 burst",
        target: "Each enemy in the area",
        effects: [
          {
            roll: `Power Roll ${rollBonus}`,
            tier1: `${Math.max(2, Math.round(stats.tier1 * 0.8))} damage`,
            tier2: `${Math.max(3, Math.round(stats.tier2 * 0.85))} damage; push 2`,
            tier3: `${Math.max(4, Math.round(stats.tier3 * 0.9))} damage; push 4; M < ${potency}, dazed (save ends)`,
          },
        ],
      };
    case "triggered":
      return {
        name: "Spiteful Riposte",
        icon: "❗",
        usage: "Triggered",
        keywords: ["Melee", "Strike"],
        distance: "Melee 1",
        target: "The triggering creature",
        trigger: "An adjacent enemy deals damage to this creature.",
        effects: [
          {
            name: "Effect",
            effect: `This creature makes a free strike against the target and shifts 2 squares.`,
          },
        ],
      };
    case "villain": {
      const slot = nextVillainActionNumber(monster.features);
      if (slot === 2) {
        return {
          name: "Turn the Tide",
          icon: "❇",
          cost: "Villain Action 2",
          usage: "Villain Action",
          keywords: ["Area", "Magic"],
          distance: "3 burst",
          target: "Each enemy in the area",
          effects: [
            {
              roll: `Power Roll ${rollBonus}`,
              tier1: `${Math.max(2, Math.round(stats.tier1 * 0.8))} damage; push 2`,
              tier2: `${Math.max(3, Math.round(stats.tier2 * 0.8))} damage; push 3; M < ${Math.max(0, potency - 1)}, prone`,
              tier3: `${Math.max(4, Math.round(stats.tier3 * 0.8))} damage; push 5; M < ${potency}, prone`,
            },
          ],
        };
      }
      if (slot === 3) {
        return {
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
        };
      }
      return {
        name: slot === 1 ? "Command the Field" : `Villain Action ${slot}`,
        icon: "☠",
        cost: `Villain Action ${slot}`,
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
      };
    }
    case "trait":
      return {
        name: "Relentless",
        icon: "⭐",
        feature_type: "trait",
        effects: [
          {
            effect: "While winded, this creature gains an edge on strikes.",
          },
        ],
      };
  }
}

export function blankHomebrewMonster(
  level = 1,
  organization = "Platoon",
  role = "Brute",
): HomebrewMonster {
  const now = Date.now();
  const base = baselineMonsterStats(level, organization, role);
  const draft: HomebrewMonster = {
    id: uuidv7(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    origin: { kind: "local" },
    name: "",
    level: clampInt(level, HOMEBREW_LEVEL_MIN, LEVEL_MAX),
    organization,
    role,
    ev: base.ev,
    size: base.size,
    speed: base.speed,
    movement: "",
    stamina: base.stamina,
    stability: base.stability,
    freeStrike: base.freeStrike,
    immunities: [],
    weaknesses: [],
    withCaptain: organization.toLowerCase() === "minion" ? "+2 damage bonus to strikes" : "",
    ...(base.turnsPerRound > 1 ? { turnsPerRound: base.turnsPerRound } : {}),
    chars: base.chars,
    keywords: [],
    familyPath: "",
    features: [],
    maliceIds: [],
  };
  draft.features = [makeAbilityTemplate("signature", draft)];
  return draft;
}

export function forkMonsterToHomebrew(source: Monster): HomebrewMonster {
  const now = Date.now();
  const origin: HomebrewOrigin = source.isHomebrew
    ? {
        kind: "local",
        sourceId: source.homebrewId ?? basePath(source.path),
        sourceName: source.name,
        ...(source.origin?.author ? { author: source.origin.author } : {}),
      }
    : {
        kind: "official-fork",
        sourceId: basePath(source.path),
        sourceName: source.name,
      };
  return {
    id: uuidv7(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    origin,
    name: `${source.name} (Custom)`,
    level: clampInt(source.level, HOMEBREW_LEVEL_MIN, LEVEL_MAX),
    organization: source.organization === "—" ? "Platoon" : source.organization,
    role: source.role,
    ev: source.evLabel || String(source.ev),
    size: String(source.size === "—" ? "1M" : source.size),
    speed: String(source.speed === "—" ? "5" : source.speed),
    movement: source.movement,
    stamina: source.stamina,
    stability: String(source.stability === "—" ? "0" : source.stability),
    freeStrike: String(source.freeStrike === "—" ? "2" : source.freeStrike),
    immunities: [...source.immunities],
    weaknesses: [...source.weaknesses],
    withCaptain: source.withCaptain,
    ...(source.turnsPerRound > 1 ? { turnsPerRound: source.turnsPerRound } : {}),
    chars: { ...source.chars },
    keywords: [...source.keywords],
    familyPath: source.familyPath,
    features: structuredClone(source.features),
    maliceIds: [...(source.customMaliceIds ?? [])],
  };
}

export function blankHomebrewMalice(
  family = "",
  familyLabelText = "",
  minLevel = 1,
): HomebrewMalice {
  const now = Date.now();
  return {
    id: uuidv7(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    origin: { kind: "local" },
    name: "",
    cost: 3,
    costText: "3 Malice",
    icon: "☠",
    distance: "",
    target: "",
    keywords: [],
    effects: [{ effect: "" }],
    family,
    familyLabel: familyLabelText || (family ? slugToLabel(family) : "Custom Malice"),
    minLevel: Math.max(0, minLevel),
  };
}

const TURNS_RE = /\b(?:can take|takes?)(?: up to)? (\w+) turns each round\b/i;

function inferTurnsPerRound(features: readonly MonsterFeature[], explicit?: number): number {
  if (explicit && Number.isFinite(explicit) && explicit > 1)
    return Math.min(9, Math.round(explicit));
  for (const feature of features) {
    for (const effect of feature.effects ?? []) {
      const word = TURNS_RE.exec(effect.effect ?? "")?.[1]?.toLowerCase();
      const turns = word ? Number(word) || WORD_NUMBERS[word] : 0;
      if (turns && turns > 1) return turns;
    }
  }
  return 1;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom"
  );
}

export function homebrewToMonster(record: HomebrewMonster): Monster {
  const path = homebrewMonsterPath(record.id);
  const ev = parseEv(record.ev, record.organization);
  const keywords = record.keywords.filter(Boolean);
  const features = record.features ?? [];
  const raw: RawStatblock = {
    name: record.name,
    level: record.level,
    organization: record.organization,
    role: record.role,
    ev: record.ev,
    keywords,
    features,
    size: record.size,
    speed: record.speed,
    stamina: record.stamina,
    stability: record.stability,
    free_strike: record.freeStrike,
    movement: record.movement,
    immunities: record.immunities,
    weaknesses: record.weaknesses,
    with_captain: record.withCaptain,
    might: record.chars.M,
    agility: record.chars.A,
    reason: record.chars.R,
    intuition: record.chars.I,
    presence: record.chars.P,
  };
  return {
    id: path,
    path,
    book: "homebrew",
    familyPath: record.familyPath,
    slug: slugify(record.name || "homebrew-monster"),
    name: record.name.trim() || "Untitled Monster",
    level: record.level,
    organization: record.organization || "Platoon",
    role: record.role || "",
    ev: ev.unit,
    evLabel: ev.label,
    defaultQty: ev.suggestedQty,
    keywords,
    ancestry: keywords.join(", "),
    size: record.size || "1M",
    speed: record.speed || "5",
    stamina: Math.max(1, record.stamina),
    stability: record.stability || "0",
    freeStrike: record.freeStrike || "—",
    movement: record.movement && record.movement !== "—" ? record.movement : "",
    immunities: record.immunities.filter(Boolean),
    weaknesses: record.weaknesses.filter(Boolean),
    withCaptain: record.withCaptain.trim(),
    turnsPerRound: inferTurnsPerRound(features, record.turnsPerRound),
    chars: { ...record.chars },
    features,
    source: "",
    raw,
    isHomebrew: true,
    homebrewId: record.id,
    ...(record.origin ? { origin: record.origin } : {}),
    ...(record.maliceIds?.length ? { customMaliceIds: [...record.maliceIds] } : {}),
  };
}

export function homebrewToCatalogEntry(record: HomebrewMonster): CatalogEntry {
  const monster = homebrewToMonster(record);
  return {
    path: monster.path,
    book: "homebrew",
    familyPath: monster.familyPath,
    slug: monster.slug,
    derivedName: monster.name,
    monster,
    error: false,
    isHomebrew: true,
  };
}

/**
 * An official (or another family's) Malice feature, copied into a custom
 * family as the Director's own editable record. Its origin remembers which
 * family it came from.
 */
export function maliceFeatureToHomebrew(
  feature: MaliceFeature,
  family: string,
  familyLabelText: string,
): HomebrewMalice {
  const now = Date.now();
  return {
    id: uuidv7(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    origin: {
      kind: feature.isHomebrew ? "local" : "official-fork",
      sourceId: feature.isHomebrew && feature.homebrewId ? feature.homebrewId : feature.id,
      sourceName: feature.familyLabel || slugToLabel(feature.family),
    },
    name: feature.name,
    cost: feature.cost,
    costText: feature.costText,
    icon: feature.icon,
    distance: feature.distance,
    target: feature.target,
    keywords: [...feature.keywords],
    effects: structuredClone(feature.effects),
    family,
    familyLabel: familyLabelText,
    minLevel: Math.max(0, feature.minLevel),
  };
}

export function homebrewToMaliceFeature(record: HomebrewMalice): MaliceFeature {
  const id = homebrewMaliceId(record.id);
  const familySlug = record.family.trim().toLowerCase();
  const label = record.familyLabel.trim() || (familySlug ? slugToLabel(familySlug) : "Custom");
  const cost = Math.max(0, Number(record.cost) || 0);
  const costText = record.costText.trim() || (cost ? `${cost} Malice` : "0 Malice");
  return {
    id,
    path: id,
    name: record.name.trim() || "Untitled Malice",
    cost,
    costText,
    icon: record.icon || "☠",
    effects: record.effects.length ? record.effects : [{ effect: "" }],
    distance: record.distance,
    target: record.target,
    keywords: record.keywords.filter(Boolean),
    source: "",
    tokens: familySlug ? [familySlug] : ["custom"],
    scope: familySlug ? "family" : "basic",
    family: familySlug || "custom",
    familyLabel: label,
    minLevel: Math.max(0, record.minLevel),
    blockName: `${label} Malice`,
    isHomebrew: true,
    homebrewId: record.id,
    ...(record.origin ? { origin: record.origin } : {}),
  };
}

// ---------- Sanitizers & Raw SteelCompendium converter ----------

const asStr = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;

const asStrList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];

function sanitizeOrigin(raw: unknown): HomebrewOrigin | undefined {
  if (!isRecord(raw)) return undefined;
  const kind =
    raw["kind"] === "official-fork" || raw["kind"] === "imported" ? raw["kind"] : "local";
  const out: HomebrewOrigin = { kind };
  if (typeof raw["sourceId"] === "string" && raw["sourceId"].trim())
    out.sourceId = raw["sourceId"].trim();
  if (typeof raw["sourceName"] === "string" && raw["sourceName"].trim())
    out.sourceName = raw["sourceName"].trim();
  if (typeof raw["author"] === "string" && raw["author"].trim()) out.author = raw["author"].trim();
  if (typeof raw["license"] === "string" && raw["license"].trim())
    out.license = raw["license"].trim();
  return out;
}

function sanitizeEffects(raw: unknown): FeatureEffect[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((item): FeatureEffect[] => {
    const eff: FeatureEffect = {};
    if (typeof item["name"] === "string" && item["name"]) eff.name = item["name"];
    if (typeof item["cost"] === "string" && item["cost"]) eff.cost = item["cost"];
    if (typeof item["effect"] === "string" && item["effect"]) eff.effect = item["effect"];
    if (typeof item["roll"] === "string" && item["roll"]) eff.roll = item["roll"];
    if (typeof item["tier1"] === "string" && item["tier1"]) eff.tier1 = item["tier1"];
    if (typeof item["tier2"] === "string" && item["tier2"]) eff.tier2 = item["tier2"];
    if (typeof item["tier3"] === "string" && item["tier3"]) eff.tier3 = item["tier3"];
    return Object.keys(eff).length ? [eff] : [];
  });
}

function sanitizeFeatures(raw: unknown): MonsterFeature[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item): MonsterFeature => {
    const out: MonsterFeature = {};
    if (typeof item["name"] === "string") out.name = item["name"];
    if (typeof item["icon"] === "string" && item["icon"]) out.icon = item["icon"];
    if (typeof item["feature_type"] === "string" && item["feature_type"])
      out.feature_type = item["feature_type"];
    if (typeof item["ability_type"] === "string" && item["ability_type"])
      out.ability_type = item["ability_type"];
    if (typeof item["cost"] === "string" || typeof item["cost"] === "number")
      out.cost = String(item["cost"]);
    if (typeof item["usage"] === "string" && item["usage"]) out.usage = item["usage"];
    const kw = asStrList(item["keywords"]);
    if (kw.length) out.keywords = kw;
    if (typeof item["distance"] === "string" && item["distance"]) out.distance = item["distance"];
    if (typeof item["target"] === "string" && item["target"]) out.target = item["target"];
    if (typeof item["trigger"] === "string" && item["trigger"]) out.trigger = item["trigger"];
    const effects = sanitizeEffects(item["effects"]);
    if (effects.length) out.effects = effects;
    return out;
  });
}

const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

function safeHomebrewId(value: unknown): string {
  if (typeof value !== "string") return uuidv7();
  // Strip trailing `@<digits>` so `basePath(homebrewMonsterPath(id))` never truncates the ID.
  const cleaned = value.trim().replace(/@\d+$/, "").trim();
  if (!cleaned || RESERVED_IDS.has(cleaned)) return uuidv7();
  return cleaned;
}

function finitePositiveInt(value: unknown, fallback: number, min = 1): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= min ? Math.round(num) : fallback;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function sanitizeHomebrewMonster(value: unknown): HomebrewMonster | null {
  if (!isRecord(value)) return null;
  const name = asStr(value["name"]).trim();
  const id = safeHomebrewId(value["id"]);
  const now = Date.now();
  const createdAt = finiteTimestamp(value["createdAt"], now);
  const updatedAt = finiteTimestamp(value["updatedAt"], createdAt);
  const revision = finitePositiveInt(value["revision"], 1, 1);
  const rawChars = isRecord(value["chars"]) ? value["chars"] : {};
  const chars: Characteristics = {
    M: sanitizeChar(rawChars["M"] ?? value["might"] ?? 0),
    A: sanitizeChar(rawChars["A"] ?? value["agility"] ?? 0),
    R: sanitizeChar(rawChars["R"] ?? value["reason"] ?? 0),
    I: sanitizeChar(rawChars["I"] ?? value["intuition"] ?? 0),
    P: sanitizeChar(rawChars["P"] ?? value["presence"] ?? 0),
  };
  const level = clampInt(value["level"] ?? 1, 0, 20);
  const organization = asStr(value["organization"], "Platoon").trim() || "Platoon";
  const role = asStr(value["role"]).trim();
  const origin = sanitizeOrigin(value["origin"]);
  const maliceIds = asStrList(value["maliceIds"]);
  const tags = asStrList(value["tags"]);
  const turnsRaw = Number(value["turnsPerRound"]);

  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt,
    revision,
    ...(origin ? { origin } : {}),
    ...(tags.length ? { tags } : {}),
    ...(typeof value["packId"] === "string" && value["packId"] ? { packId: value["packId"] } : {}),
    name: name || "Untitled Monster",
    level,
    organization,
    role,
    ev: asStr(value["ev"], "4").trim() || "4",
    size: asStr(value["size"], "1M").trim() || "1M",
    speed: asStr(value["speed"], "5").trim() || "5",
    movement: asStr(value["movement"]).trim(),
    stamina: Math.max(1, Math.round(numberFrom(value["stamina"], 10))),
    stability: asStr(value["stability"], "0").trim() || "0",
    freeStrike: asStr(value["freeStrike"] ?? value["free_strike"], "2").trim() || "2",
    immunities: asStrList(value["immunities"]),
    weaknesses: asStrList(value["weaknesses"]),
    withCaptain: asStr(value["withCaptain"] ?? value["with_captain"]).trim(),
    ...(Number.isFinite(turnsRaw) && turnsRaw > 1
      ? { turnsPerRound: Math.min(9, Math.round(turnsRaw)) }
      : {}),
    chars,
    keywords: asStrList(value["keywords"]),
    familyPath: asStr(value["familyPath"]).trim(),
    features: sanitizeFeatures(value["features"]),
    ...(maliceIds.length ? { maliceIds } : {}),
  };
}

export function sanitizeHomebrewMalice(value: unknown): HomebrewMalice | null {
  if (!isRecord(value)) return null;
  const id = safeHomebrewId(value["id"]);
  const now = Date.now();
  const createdAt = finiteTimestamp(value["createdAt"], now);
  const updatedAt = finiteTimestamp(value["updatedAt"], createdAt);
  const revision = finitePositiveInt(value["revision"], 1, 1);
  const cost = Math.max(0, Math.round(numberFrom(value["cost"] ?? value["costText"], 3)));
  const costText = asStr(value["costText"]).trim() || `${cost} Malice`;
  const family = asStr(value["family"]).trim().toLowerCase();
  const familyLabelText =
    asStr(value["familyLabel"]).trim() || (family ? slugToLabel(family) : "Custom");
  const origin = sanitizeOrigin(value["origin"]);
  const tags = asStrList(value["tags"]);
  const effects = sanitizeEffects(value["effects"]);

  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt,
    revision,
    ...(origin ? { origin } : {}),
    ...(tags.length ? { tags } : {}),
    name: asStr(value["name"], "Untitled Malice").trim() || "Untitled Malice",
    cost,
    costText,
    icon: asStr(value["icon"], "☠").trim() || "☠",
    distance: asStr(value["distance"]).trim(),
    target: asStr(value["target"]).trim(),
    keywords: asStrList(value["keywords"]),
    effects: effects.length ? effects : [{ effect: "" }],
    family,
    familyLabel: familyLabelText,
    minLevel: finitePositiveInt(value["minLevel"], 0, 0),
  };
}

/**
 * Convert a raw SteelCompendium statblock JSON document into a HomebrewMonster
 * so Directors can drop or paste official/community SteelCompendium JSON files
 * directly into Import.
 */
export function rawStatblockToHomebrewMonster(
  raw: RawStatblock,
  sourceName?: string,
): HomebrewMonster | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.name !== "string" &&
    raw.stamina === undefined &&
    raw.features === undefined &&
    raw.ev === undefined
  ) {
    return null;
  }
  const now = Date.now();
  return sanitizeHomebrewMonster({
    id: uuidv7(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    origin: {
      kind: "imported",
      ...(sourceName ? { sourceName } : {}),
    },
    name: raw.name || sourceName || "Imported Monster",
    level: numberFrom(raw.level, 1),
    organization: raw.organization || "Platoon",
    role: raw.role || "",
    ev: raw.ev != null ? String(raw.ev) : "4",
    size: raw.size != null ? String(raw.size) : "1M",
    speed: raw.speed != null ? String(raw.speed) : "5",
    movement: raw.movement || "",
    stamina: Math.max(1, numberFrom(raw.stamina, 10)),
    stability: raw.stability != null ? String(raw.stability) : "0",
    freeStrike: String(raw.free_strike ?? raw.freeStrike ?? "2"),
    immunities: Array.isArray(raw.immunities) ? raw.immunities : [],
    weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses : [],
    withCaptain: raw.with_captain || "",
    chars: {
      M: raw.might ?? 0,
      A: raw.agility ?? 0,
      R: raw.reason ?? 0,
      I: raw.intuition ?? 0,
      P: raw.presence ?? 0,
    },
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    familyPath: "",
    features: Array.isArray(raw.features) ? raw.features : [],
  });
}
