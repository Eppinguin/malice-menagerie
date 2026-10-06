import type { Characteristics, FeatureEffect, Monster, MonsterFeature } from "../types.ts";

/**
 * Adjusting monster levels, after the Monsters book's "Adjusting Monster
 * Levels" formulas. The book's numbers are handcrafted, so a statblock is
 * never rebuilt from the formulas; each printed number moves by what the
 * formula says the level changes, so every quirk of the printed statblock
 * carries over:
 *
 * - EV and Stamina add the formula's difference between the two levels, so
 *   Stamina a statblock has above the formula (the book's optional extra
 *   Stamina) stays as it is.
 * - Damage and Free Strike scale by the formula's ratio between the two
 *   levels: the tier, minion and target-count modifiers multiply both sides
 *   and cancel out, so a two-target ability stays at its 0.8. A strike adds
 *   its highest characteristic on top; a Free Strike, as printed, doesn't.
 * - Every characteristic shifts with the highest one (1 + echelon), so the
 *   block keeps its spread, within the game's −5 to +5; power rolls and
 *   potencies (0 to 6) follow.
 *
 * Checked against the book by predicting each statblock from the others of
 * its organization and role printed at other levels: these were the closer
 * fit of the delta and ratio forms, value by value.
 *
 * An entry at another level names its statblock by a key, the source path
 * with the level after an "@": "…/goblin-warrior.json@5". A plain path is
 * the printed level.
 */

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 11;

const KEY_RE = /^(.*)@(\d+)$/;

/** The statblock's source path, without any level. */
export function basePath(key: string): string {
  return KEY_RE.exec(key)?.[1] ?? key;
}

/** The level a key asks for, or null for the printed one. */
export function keyLevel(key: string): number | null {
  const level = KEY_RE.exec(key)?.[2];
  return level === undefined ? null : Number(level);
}

/** The key for a statblock at `level`; the printed level is the plain path. */
export function levelKey(path: string, level: number, printed: number): string {
  const base = basePath(path);
  return level === printed ? base : `${base}@${level}`;
}

/** Role and Damage Modifier Table. */
const ROLE_MODIFIER: Record<string, number> = {
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
const ROLE_DAMAGE: Record<string, number> = { ambusher: 1, artillery: 1, brute: 1 };

/** Organization Modifier Table: EV (a minion's is for four together), and
    Stamina (a minion's is one minion's). Organizations it doesn't list are
    taken as a platoon. */
const EV_ORGANIZATION: Record<string, number> = { minion: 0.5, horde: 0.5, platoon: 1, leader: 2, elite: 2, solo: 6 };
const STAMINA_ORGANIZATION: Record<string, number> = {
  minion: 0.125,
  horde: 0.5,
  platoon: 1,
  leader: 2,
  elite: 2,
  solo: 5,
};

function isOrg(m: Monster, org: string): boolean {
  return m.organization.toLowerCase() === org;
}

/** Leaders and solos take the table's own row over their role's. */
function roleModifier(m: Monster): number {
  if (isOrg(m, "leader") || isOrg(m, "solo")) return 30;
  return ROLE_MODIFIER[m.role.toLowerCase()] ?? 20;
}

/** An elite adds its +1 to its role's (for +2 with a +1 role). */
function damageModifier(m: Monster): number {
  if (isOrg(m, "leader")) return 1;
  if (isOrg(m, "solo")) return 2;
  return (ROLE_DAMAGE[m.role.toLowerCase()] ?? 0) + (isOrg(m, "elite") ? 1 : 0);
}

export function echelon(level: number): number {
  return Math.min(4, Math.max(1, Math.ceil(level / 3)));
}

/** Highest characteristic and power roll bonus: 1 + echelon, one more for
    a leader or solo, never past +5. */
function topCharacteristic(m: Monster, level: number): number {
  const boss = isOrg(m, "leader") || isOrg(m, "solo") ? 1 : 0;
  return Math.min(5, 1 + echelon(level) + boss);
}

/** Round up, as the book does, without letting float dust (12.0000001) tip
    a whole number over. */
function roundUp(value: number): number {
  return Math.ceil(value - 1e-9);
}

export interface LevelScale {
  from: number;
  to: number;
  /** EV to add: ((2 × Level) + 4) × Organization Modifier, new less old. */
  ev: number;
  /** Stamina to add: ((10 × Level) + Role Modifier) × Organization Modifier,
      new less old. */
  stamina: number;
  /** Damage to multiply by: 4 + Level + Damage Modifier, new over old. */
  damage: number;
  /** The change to the highest characteristic, power rolls and potencies. */
  step: number;
}

export function levelScale(m: Monster, to: number): LevelScale {
  const from = m.level;
  const role = roleModifier(m);
  const dmg = damageModifier(m);
  const org = m.organization.toLowerCase();
  const evOrg = EV_ORGANIZATION[org] ?? 1;
  const staminaOrg = STAMINA_ORGANIZATION[org] ?? 1;
  const delta = (f: (level: number) => number) => roundUp(f(to)) - roundUp(f(from));
  const ratio = (f: (level: number) => number) => {
    const base = f(from);
    return base > 0 ? f(to) / base : 1;
  };
  return {
    from,
    to,
    ev: delta((l) => (2 * l + 4) * evOrg),
    stamina: delta((l) => (10 * l + role) * staminaOrg),
    damage: ratio((l) => 4 + l + dmg),
    step: topCharacteristic(m, to) - topCharacteristic(m, from),
  };
}

/** "6", "6 fire", "2 extra", "9 corruption or fire", "7 cold, fire, or
    sonic", then "damage" (plain, or the data's linked "[damage](…)"). Only
    damage types may stand between, so "within 3 squares of the damage"
    and thresholds ("5 or more damage") stay as printed. The data's own
    typos ("fir", "lighting") are types too. */
const TYPE = "(?:acid|cold|corruption|fire|fir|holy|lightning|lighting|poison|psychic|sonic|affinity)";
const DAMAGE_RE = new RegExp(
  `\\b(\\d+)((?:\\s+extra)?(?:\\s+${TYPE}(?:,?\\s+(?:or\\s+)?${TYPE})*)?\\s+\\[?damage\\b)`,
  "gi",
);
const POTENCY_RE = /\b([MARIP]) ?< ?(-?\d+)\b/g;

function scaleText(text: string, scale: LevelScale, strikeBonus: number | null): string {
  let out = text.replace(DAMAGE_RE, (_match, amount: string, rest: string) => {
    const printed = Number(amount);
    let value: number;
    if (strikeBonus === null) {
      value = roundUp(printed * scale.damage);
    } else {
      // A strike adds the highest characteristic on top of the formula's
      // damage, so only the rest of it scales.
      const core = printed - strikeBonus;
      const bonus = clampChar(strikeBonus + scale.step);
      value = core > 0 ? roundUp(core * scale.damage) + bonus : printed + bonus - strikeBonus;
    }
    value = Math.max(Math.min(1, printed), value);
    return `${value}${rest}`;
  });
  if (scale.step) {
    out = out.replace(POTENCY_RE, (_match, key: string, value: string) => {
      const next = Math.max(0, Math.min(6, Number(value) + scale.step));
      return `${key} < ${next}`;
    });
  }
  return out;
}

const ROLL_RE = /^(Power Roll\s*)([+−-])\s*(\d+)/i;

function scaleRoll(roll: string, step: number): string {
  if (!step) return roll;
  return roll.replace(ROLL_RE, (_match, lead: string, sign: string, value: string) => {
    const next = clampChar((sign === "+" ? 1 : -1) * Number(value) + step);
    return `${lead}${next < 0 ? "−" : "+"} ${Math.abs(next)}`;
  });
}

function isStrike(feature: MonsterFeature): boolean {
  return (feature.keywords ?? []).some((keyword) => keyword.toLowerCase() === "strike");
}

function scaleFeature(feature: MonsterFeature, scale: LevelScale, top: number): MonsterFeature {
  const strike = isStrike(feature) ? top : null;
  return {
    ...feature,
    ...(feature.trigger ? { trigger: scaleText(feature.trigger, scale, null) } : {}),
    effects: (feature.effects ?? []).map((effect): FeatureEffect => {
      const next: FeatureEffect = { ...effect };
      if (effect.roll) next.roll = scaleRoll(effect.roll, scale.step);
      for (const tier of ["tier1", "tier2", "tier3"] as const) {
        const text = effect[tier];
        if (text) next[tier] = scaleText(text, scale, strike);
      }
      if (effect.effect) next.effect = scaleText(effect.effect, scale, null);
      return next;
    }),
  };
}

function scaleNumberText(value: string | number, ratio: number): string | number {
  if (typeof value === "number") return roundUp(value * ratio);
  const match = /^(\d+)(.*)$/.exec(value.trim());
  return match?.[1] ? `${roundUp(Number(match[1]) * ratio)}${match[2] ?? ""}` : value;
}

function clampChar(value: number): number {
  return Math.max(-5, Math.min(5, value));
}

/** Every characteristic steps with the highest, within −5 to +5. */
function scaleChars(chars: Characteristics, step: number): Characteristics {
  if (!step) return chars;
  const next = { ...chars };
  for (const key of Object.keys(next) as (keyof Characteristics)[]) {
    next[key] = clampChar(next[key] + step);
  }
  return next;
}

/**
 * The statblock at `level`, keyed so lookups by its `path` find it again.
 * Its `printed` field is the statblock as the book prints it.
 */
export function atLevel(m: Monster, level: number): Monster {
  if (level === m.level) return m;
  const scale = levelScale(m, level);
  const top = Math.max(...Object.values(m.chars));
  // The printed EV is the leading number ("3 for four minions" for a set).
  const evPrinted = Number(/^[\d.]+/.exec(m.evLabel)?.[0] ?? m.ev);
  const evNext = Math.max(1, evPrinted + scale.ev);
  const evLabel = m.evLabel.replace(/^([\d.]+)/, String(evNext));
  const perSet = /^[\d.]+\s+for\s+/i.test(m.evLabel);
  const key = levelKey(m.path, level, m.level);
  return {
    ...m,
    id: key,
    path: key,
    level,
    ev: perSet ? evNext / m.defaultQty : evNext,
    evLabel,
    stamina: Math.max(1, m.stamina + scale.stamina),
    freeStrike: scaleNumberText(m.freeStrike, scale.damage),
    chars: scaleChars(m.chars, scale.step),
    features: m.features.map((feature) => scaleFeature(feature, scale, top)),
    printed: m,
  };
}
