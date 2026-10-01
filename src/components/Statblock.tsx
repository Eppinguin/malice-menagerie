import { fmt, numberFrom, richText, signed } from "../lib/text.ts";
import { characteristicLabel, type CharacteristicKey } from "../lib/rules.ts";
import { effectiveSpeed } from "../lib/rules.ts";
import { isMainAction } from "../lib/actions.ts";
import { isMinion, tierDamage } from "../lib/minions.ts";
import {
  activeEncounter,
  lastRolls,
  rollCharacteristic,
  rollFeature,
  spendAbilityMalice,
} from "../store.ts";
import type { EdgeState, PowerRollResult } from "../types.ts";
import { rollPress } from "./combat/EdgeMenu.tsx";
import type { FeatureEffect, Monster, MonsterFeature } from "../types.ts";
import { CaretIcon, ExternalIcon } from "./Icons.tsx";
import type { ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import { PenD10, PenDoubleRule, PenLoop, PenRing } from "./Pen.tsx";

/** Power-roll bands as printed in Draw Steel: tier 1, 2, 3. */
export const TIER_LABELS = ["≤11", "12–16", "17+"] as const;
/** The same bands in MCDM's Draw Steel Glyphs font. */
const TIER_GLYPHS = ["!", "@", "#"] as const;

/** A tier badge set in the official glyph font, with the band as its accessible text. */
export function TierMark({ index }: { index: number }) {
  return (
    <b class="tier-mark">
      <span class="ds-glyph" aria-hidden="true">
        {TIER_GLYPHS[index]}
      </span>
      <span class="sr-only">{TIER_LABELS[index]}</span>
    </b>
  );
}

/** SteelCompendium marks each feature with the book's icon as an emoji; these
    are the same icons in the Draw Steel Glyphs font. */
const ICON_GLYPHS: Record<string, string> = {
  "⭐": "*",
  "🗡": "t",
  "🏹": "g",
  "☠": "d",
  "❗": ")",
  "🔳": "e",
  "❇": "b",
  "👤": "f",
  "⚔": "l",
  "🌀": "c",
};

/** The glyph for a feature's printed icon (emoji variation selectors ignored). */
export function iconGlyph(icon: unknown, fallback = ""): string {
  const key = typeof icon === "string" ? icon.replace(/\uFE0F/g, "").trim() : "";
  return ICON_GLYPHS[key] ?? fallback;
}

/** A printed icon in the glyph font; decorative, the text beside it carries the meaning. */
export function FeatureGlyph({ glyph }: { glyph: string }) {
  if (!glyph) return null;
  return (
    <span class="ds-glyph feature-glyph" aria-hidden="true">
      {glyph}
    </span>
  );
}

/** The bold right-hand label on an ability's first line: its cost (Malice or
    villain action), else its ability type, as the book prints it. */
function featureKind(feature: MonsterFeature): string {
  const cost = feature.cost == null ? "" : String(feature.cost).trim();
  return cost || feature.ability_type || "";
}

function featureUsage(feature: MonsterFeature): string {
  const usage = (feature.usage || "").trim();
  return usage === "-" || usage === "—" ? "" : usage;
}

/** Where a lane sits on the phone's one-page-at-a-time board, and the way
    to its neighbours. */
export type LaneNav = { index: number; count: number; turnTo: (index: number) => void };

export function LaneHeader({ monster, nav }: { monster: Monster; nav?: LaneNav }) {
  const speed = effectiveSpeed(monster, activeEncounter().combat.activeEffects);
  const charKeys = ["M", "A", "R", "I", "P"] as const;
  let lastCharKey: CharacteristicKey | null = null;
  for (const key of lastRolls.value.keys()) {
    if (key.startsWith(`${monster.id}|char|`)) {
      lastCharKey = key.slice(`${monster.id}|char|`.length) as CharacteristicKey;
    }
  }
  const lastCharRoll = lastCharKey ? lastRolls.value.get(`${monster.id}|char|${lastCharKey}`) : undefined;
  const paging = nav && nav.count > 1 ? nav : null;
  // The arrows turn the page; the rest of the band takes it back to its top.
  const turn = (event: MouseEvent, step: number) => {
    event.stopPropagation();
    paging?.turnTo(paging.index + step);
  };
  return (
    <header class="lane-header">
      <div class={paging ? "lane-band has-nav" : "lane-band"}>
        {paging ? (
          <button
            class="lane-nav prev"
            aria-label="Previous statblock"
            disabled={paging.index === 0}
            onClick={event => turn(event, -1)}
          >
            <CaretIcon />
          </button>
        ) : null}
        {/* Name and EV, then level, organization and role with the keywords
            after them: the same two lines in every lane, so the stat rows
            below line up across the board. */}
        <div class="lane-band-text">
          <div class="lane-band-row">
            <h2>{monster.name}</h2>
            <span class="ev-badge">EV {monster.evLabel}</span>
          </div>
          <div class="lane-band-row lane-keys">
            <span class="lane-level">
              Level {fmt(monster.level)} {monster.organization} {monster.role}
            </span>
            <span class="lane-keywords">{monster.ancestry}</span>
          </div>
        </div>
        {paging ? (
          <span class="lane-nav-end">
            <button
              class="lane-nav next"
              aria-label="Next statblock"
              disabled={paging.index === paging.count - 1}
              onClick={event => turn(event, 1)}
            >
              <CaretIcon />
            </button>
            <span class="lane-nav-count" aria-label={`Statblock ${paging.index + 1} of ${paging.count}`}>
              {paging.index + 1}/{paging.count}
            </span>
          </span>
        ) : null}
      </div>
      <div class="lane-core-stats">
        <span>
          <b>{monster.size}</b>
          <small>Size</small>
        </span>
        <span>
          <b>
            {speed.value}
            {speed.note ? <em>{speed.note}</em> : null}
          </b>
          <small>Speed</small>
          {monster.movement ? <i class="lane-movement">{monster.movement.toLowerCase()}</i> : null}
        </span>
        <span>
          <b>{fmt(monster.stamina)}</b>
          <small>Stamina</small>
        </span>
        <span>
          <b>{monster.stability}</b>
          <small>Stability</small>
        </span>
        <span>
          <b>{monster.freeStrike}</b>
          <small>Free Strike</small>
        </span>
      </div>
      <LaneDefenses monster={monster} />
      <div class="lane-characteristics">
        {charKeys.map((key) => (
          <button
            key={key}
            class="char-roll"
            title={`${characteristicLabel(key)} check — tap to roll, hold for edge/bane menu`}
            aria-label={`Roll ${characteristicLabel(key)} ${signed(monster.chars[key])}`}
            {...rollPress(
              (event) => rollCharacteristic(monster.path, key, event),
              (edge: EdgeState) => rollCharacteristic(monster.path, key, edge),
            )}
          >
            <small>
              <span class="ds-glyph" aria-hidden="true">
                {key}
              </span>
              {characteristicLabel(key).slice(1)}
            </small>
            <b>{signed(monster.chars[key])}</b>
          </button>
        ))}
      </div>
      {lastCharRoll && lastCharKey ? (
        <div class="char-roll-result" aria-live="polite">
          <span>{characteristicLabel(lastCharKey)}</span>
          <RollTally key={rollSerial(lastCharRoll)} roll={lastCharRoll} showTier crit="natural" />
        </div>
      ) : null}
    </header>
  );
}

/** "poison 4" as "Poison **4**": the damage type, then its value in bold so
    the number is what the eye lands on mid-combat. */
function DamageValue({ text }: { text: string }) {
  const match = /^(.*?)\s+(\S+)$/.exec(text);
  const type = match?.[1] ?? text;
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <span class="damage-value">
      {label}
      {match?.[2] ? <b> {match[2]}</b> : null}
    </span>
  );
}

/** Damage immunities and weaknesses, and a minion's captain bonus, on one
    compact line under the core stats. Movement lives in the Speed cell. */
function LaneDefenses({ monster }: { monster: Monster }) {
  const { immunities, weaknesses, withCaptain } = monster;
  if (!immunities.length && !weaknesses.length && !withCaptain) return null;
  return (
    <dl class="lane-defenses">
      {immunities.length ? (
        <div>
          <dt>Immunity</dt>
          <dd>
            {immunities.map((text, index) => (
              <DamageValue key={index} text={text} />
            ))}
          </dd>
        </div>
      ) : null}
      {weaknesses.length ? (
        <div>
          <dt>Weakness</dt>
          <dd>
            {weaknesses.map((text, index) => (
              <DamageValue key={index} text={text} />
            ))}
          </dd>
        </div>
      ) : null}
      {withCaptain ? (
        <div>
          <dt>With Captain</dt>
          <dd dangerouslySetInnerHTML={{ __html: richText(withCaptain) }} />
        </div>
      ) : null}
    </dl>
  );
}

/** An effect's printed lead-in: its cost ("2 Malice") or label ("Special"). */
function effectLead(effect: FeatureEffect): string {
  const cost = (effect.cost || "").trim();
  const name = (effect.name || "").trim();
  return cost || name;
}

const EDGE_NOTE: Record<EdgeState, string> = {
  "double-bane": "double bane",
  bane: "bane",
  normal: "",
  edge: "edge",
  "double-edge": "double edge",
};

/** A roll worked out in pen: both d10s, the bonus, and the total ruled off
    twice the way an answer is marked. The numbers are there on the first
    frame; only the sketching (the dice, the rules) is drawn on, and fast,
    so the answer never waits on the pen. When the line is
    short the working gives way and the total stays, so the tally never
    drops to a row of its own. The tier shows only where no tier row is
    circled for it. Key it by `rollSerial(roll)` so every roll writes
    itself out afresh. */
export function RollTally({
  roll,
  showTier = false,
  crit = "crit",
}: {
  roll: PowerRollResult;
  showTier?: boolean;
  /** How a natural 19 or 20 is noted: a critical hit on an ability ("main"
      adds its reward, another main action), or just the natural on a test. */
  crit?: "crit" | "main" | "natural";
}) {
  const note = EDGE_NOTE[roll.edge];
  const serial = rollSerial(roll);
  return (
    <span class={`roll-tally${roll.critical ? " is-critical" : ""}${note ? " has-note" : ""}${showTier ? " has-tier" : ""}`}>
      <span class="sr-only">
        {roll.label}
        {roll.critical && crit !== "natural" ? `, critical hit${crit === "main" ? ": take another main action" : ""}` : ""}
      </span>
      <span class="roll-tally-sum" aria-hidden="true">
        <span class="roll-tally-working">
          <span class="roll-tally-dice">
            <PenD10 seed={`${serial}a`} value={roll.dice[0]} />
            <PenD10 seed={`${serial}b`} value={roll.dice[1]} />
            {roll.critical ? <PenRing seed={`${serial}c`} /> : null}
          </span>
          {roll.bonus ? <span class="roll-tally-bonus">{signed(roll.bonus)}</span> : null}
          <span class="roll-tally-eq">=</span>
        </span>
        <b class="roll-tally-total">
          {roll.total}
          <PenDoubleRule seed={serial} />
        </b>
        {showTier ? <span class="roll-tally-tier">T{roll.tier}</span> : null}
        {note ? <span class="roll-tally-edge">{note}</span> : null}
      </span>
      {roll.critical ? (
        <span class="roll-tally-crit" aria-hidden="true">
          {crit === "natural" ? `natural ${roll.dice[0] + roll.dice[1]}` : "crit"}
          {crit === "main" ? <span class="roll-tally-crit-reward">, extra main action</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** Each roll result gets its own serial, so the loop redraws on every roll,
    even one that lands on the tier already circled. */
const rollSerials = new WeakMap<object, number>();
let nextRollSerial = 0;
export function rollSerial(roll: object): number {
  let serial = rollSerials.get(roll);
  if (serial === undefined) {
    serial = nextRollSerial++;
    rollSerials.set(roll, serial);
  }
  return serial;
}

function TierRows({ effect, roll }: { effect: FeatureEffect; roll: PowerRollResult | undefined }) {
  const rolledTier = roll?.tier ?? null;
  const tierKeys = (["tier1", "tier2", "tier3"] as const).filter((key) => effect[key]);
  if (!tierKeys.length) return null;
  return (
    <div class="tiers">
      {tierKeys.map((key, index) => (
        <div
          key={key}
          class={rolledTier === index + 1 ? "rolled-tier" : ""}
          aria-current={rolledTier === index + 1 ? "true" : undefined}
        >
          {roll && rolledTier === index + 1 ? <PenLoop key={rollSerial(roll)} seed={rollSerial(roll)} /> : null}
          <TierMark index={index} />
          <span dangerouslySetInnerHTML={{ __html: richText(effect[key]) }} />
        </div>
      ))}
    </div>
  );
}

/**
 * A squad's signature strike, worked out for the rolled tier: two or three
 * minions on the same target add their free strike each (the book caps it
 * at three), so the Director reads the total instead of adding it up.
 */
function SquadStack({ effect, roll, monster }: { effect: FeatureEffect; roll: PowerRollResult; monster: Monster }) {
  const text = [effect.tier1, effect.tier2, effect.tier3][roll.tier - 1];
  const damage = text ? tierDamage(text) : null;
  const freeStrike = numberFrom(monster.freeStrike, 0);
  if (!damage || !freeStrike) return null;
  const type = damage.type ? ` ${damage.type}` : "";
  // A led squad's strikes carry the captain's damage bonus.
  const bonus = Number(monster.withCaptain.match(/^\+(\d+) damage bonus to strikes$/i)?.[1] ?? 0);
  const led =
    bonus > 0 &&
    activeEncounter().combat.instances.some(
      (item) => item.sourcePath === monster.path && item.kind === "minion-squad" && item.captainId,
    );
  return (
    <p class="squad-stack">
      <span class="squad-stack-label">Same target</span>
      {[2, 3].map((minions) => (
        <span key={minions} class="squad-stack-step">
          {minions} minions <b>{damage.amount + freeStrike * (minions - 1)}</b>
          {type}
        </span>
      ))}
      {led ? <span class="squad-stack-note">+{bonus} with captain</span> : null}
    </p>
  );
}

function EffectText({ effect }: { effect: FeatureEffect }) {
  const lead = effectLead(effect);
  return (
    <p>
      {lead ? <strong class="effect-lead">{lead}:</strong> : null}
      {lead ? " " : null}
      <span dangerouslySetInnerHTML={{ __html: richText(effect.effect) }} />
    </p>
  );
}

function EffectBlock({
  effect,
  monster,
  featureIndex,
  effectIndex,
  interactive,
}: {
  effect: FeatureEffect;
  monster: Monster;
  featureIndex: number;
  effectIndex: number;
  interactive: boolean;
}) {
  const rollKey = `${monster.id}|${featureIndex}|${effectIndex}`;
  const lastRoll = interactive ? lastRolls.value.get(rollKey) : undefined;
  return (
    <>
      {effect.roll ? (
        <div class="roll-line">
          <strong>{effect.roll}</strong>
          {interactive ? (
            <button
              title="Roll — tap, or hold for edge/bane menu"
              {...rollPress(
                (event) => rollFeature(monster.path, featureIndex, effectIndex, event),
                (edge: EdgeState) => rollFeature(monster.path, featureIndex, effectIndex, edge),
              )}
            >
              Roll
            </button>
          ) : null}
          {lastRoll ? (
            <RollTally
              key={rollSerial(lastRoll)}
              roll={lastRoll}
              crit={isMainAction(monster.features[featureIndex]) ? "main" : "crit"}
            />
          ) : null}
        </div>
      ) : null}
      <TierRows effect={effect} roll={lastRoll} />
      {lastRoll && isMinion(monster) && monster.features[featureIndex]?.ability_type === "Signature Ability" ? (
        <SquadStack key={rollSerial(lastRoll)} effect={effect} roll={lastRoll} monster={monster} />
      ) : null}
      {effect.effect ? <EffectText effect={effect} /> : null}
    </>
  );
}

/**
 * A printed Malice cost that pays itself: tap the price to spend it. It reads
 * as print until it is reachable, and goes to a dashed, pale mark when the
 * pool can't cover it (a tap then says what's missing instead of paying), or
 * when something else stands in the way: `blocked` says what, and a tap
 * does nothing.
 */
export function PayMalice({
  cost,
  label,
  name,
  onPay,
  blocked,
  class: className = "",
}: {
  cost: number;
  label: ComponentChildren;
  name: string;
  onPay: () => void;
  blocked?: string | undefined;
  class?: string;
}) {
  const short = !!blocked || cost > activeEncounter().combat.malice;
  return (
    <button
      class={`pay-malice ${className} ${short ? "short" : ""}`}
      aria-disabled={short}
      aria-label={`Spend ${cost} Malice: ${name}`}
      title={blocked ?? (short ? `Need ${cost} Malice` : `Spend ${cost} Malice`)}
      onClick={(event) => {
        if (blocked) return;
        if (!short) stampPaid(event.currentTarget);
        onPay();
      }}
    >
      {label}
    </button>
  );
}

/** The ink takes: a crimson fill that dries back off the plate. */
function stampPaid(element: HTMLElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "scale(0.92)", filter: "brightness(0.85)" },
      { transform: "scale(1)", filter: "none" },
    ],
    { duration: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

/**
 * The shared statblock body. `interactive` adds roll buttons and
 * malice-spend controls, which only make sense during a live encounter.
 */
/**
 * Which abilities the Director has folded or unfolded by hand, keyed
 * "path#index". A spent ability folds on its own; a hand's choice holds only
 * while the ability stays in the state it was made in, so a new round (or a
 * use) hands it back to the automatic rule.
 */
const folds = signal<ReadonlyMap<string, { folded: boolean; spent: boolean }>>(new Map());

function isFolded(key: string, spent: boolean): boolean {
  const hand = folds.value.get(key);
  return hand && hand.spent === spent ? hand.folded : spent;
}

function toggleFold(key: string, folded: boolean, spent: boolean): void {
  const next = new Map(folds.value);
  next.set(key, { folded: !folded, spent });
  folds.value = next;
}

/** Rules text the Director opened beside a price list, keyed "path#index". */
const openedRules = signal<ReadonlySet<string>>(new Set());

function toggleRules(key: string): void {
  const next = new Set(openedRules.value);
  if (!next.delete(key)) next.add(key);
  openedRules.value = next;
}

export function StatblockBody({
  monster,
  interactive,
  addon,
  summons,
}: {
  monster: Monster;
  interactive: boolean;
  /** Live marks for an ability (a triggered action used, a villain action
      spent), boxed beside its printed type; an ability that has them pays its
      Malice there. `spent` sets the whole ability back once it can't be used. */
  addon?: (
    feature: MonsterFeature,
    featureIndex: number,
  ) => { marks: ComponentChildren; spent: boolean } | null | undefined;
  /** The creatures an ability can bring onto the board, as controls under
      its text. `pays` when they carry their own Malice price, which then
      stands in for the ability's plain spend button. */
  summons?: (featureIndex: number) => { node: ComponentChildren; pays: boolean } | null;
}) {
  void folds.value; // subscribe: a tap on a name folds its ability
  /** The name, as the fold control on the Run board; plain print elsewhere. */
  const heading = (key: string, name: string, glyph: string, folded: boolean, spent: boolean) =>
    interactive ? (
      <button
        class="feature-fold"
        aria-expanded={!folded}
        title={folded ? "Unfold" : "Fold"}
        onClick={() => toggleFold(key, folded, spent)}
      >
        <FeatureGlyph glyph={glyph} />
        <strong>
          {name}
          <CaretIcon class="feature-fold-caret" />
        </strong>
      </button>
    ) : (
      <>
        <FeatureGlyph glyph={glyph} />
        <strong>{name}</strong>
      </>
    );
  return (
    <div class="statblock-body">
      {monster.features.map((feature, featureIndex) => {
        const isTrait = String(feature.feature_type || "").toLowerCase() === "trait";
        const key = `${monster.path}#${featureIndex}`;
        if (isTrait) {
          const folded = interactive && isFolded(key, false);
          return (
            <section class={`trait-block ${folded ? "folded" : ""}`} key={featureIndex} data-feature={featureIndex}>
              <div class="feature-title">
                {heading(key, feature.name || "Trait", iconGlyph(feature.icon, "*"), folded, false)}
              </div>
              {folded
                ? null
                : (feature.effects || []).map((effect, effectIndex) => (
                    <EffectText key={effectIndex} effect={effect} />
                  ))}
              {folded || !interactive ? null : summons?.(featureIndex)?.node}
            </section>
          );
        }
        const keywords = Array.isArray(feature.keywords) ? feature.keywords.join(", ") : "";
        const usage = featureUsage(feature);
        const kind = featureKind(feature);
        const cost = numberFrom(feature.cost, 0);
        const live = addon?.(feature, featureIndex);
        const summon = interactive ? summons?.(featureIndex) : null;
        const spendable =
          interactive &&
          live === undefined &&
          !summon?.pays &&
          cost > 0 &&
          String(feature.cost).toLowerCase().includes("malice");
        const spent = !!live?.spent;
        const folded = interactive && isFolded(key, spent);
        // A price list says what the ability buys, so its rules text waits a tap.
        const clamped = !!summon?.pays && !openedRules.value.has(key);
        const title = (
          <div class="feature-title">
            {heading(key, feature.name || "Ability", iconGlyph(feature.icon), folded, spent)}
            {live?.marks ? (
              <span class="feature-kind-marks">
                {live.marks}
                {kind ? <span>{kind}</span> : null}
              </span>
            ) : spendable ? (
              <PayMalice
                class="feature-cost"
                cost={cost}
                label={kind}
                name={feature.name || "Ability"}
                onPay={() => spendAbilityMalice(cost, feature.name || "Ability")}
              />
            ) : kind ? (
              <span>{kind}</span>
            ) : null}
          </div>
        );
        if (folded) {
          // Folded to its title line: the name, whose it is, and its boxes.
          return (
            <section
              class={`ability-block folded ${spent ? "ability-spent" : ""}`}
              key={featureIndex}
              data-feature={featureIndex}
            >
              {title}
            </section>
          );
        }
        return (
          <section
            class={`ability-block ${spent ? "ability-spent" : ""}`}
            key={featureIndex}
            data-feature={featureIndex}
          >
            {title}
            {keywords || usage ? (
              <div class="feature-line">
                <span>{keywords || "—"}</span>
                {usage ? <span>{usage}</span> : null}
              </div>
            ) : null}
            {feature.distance || feature.target ? (
              <div class="feature-line">
                <span>
                  {feature.distance ? <FeatureGlyph glyph="o" /> : null}
                  {feature.distance}
                </span>
                {feature.target ? (
                  <span>
                    <FeatureGlyph glyph="x" />
                    {feature.target}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div class={`feature-effects ${clamped ? "clamped" : ""}`}>
              {feature.trigger ? (
                <p>
                  <strong class="effect-lead">Trigger:</strong>{" "}
                  <span dangerouslySetInnerHTML={{ __html: richText(feature.trigger) }} />
                </p>
              ) : null}
              {(feature.effects || []).map((effect, effectIndex) => (
                <EffectBlock
                  key={effectIndex}
                  effect={effect}
                  monster={monster}
                  featureIndex={featureIndex}
                  effectIndex={effectIndex}
                  interactive={interactive}
                />
              ))}
              {summon?.pays ? (
                <button class="effects-more" aria-expanded={!clamped} onClick={() => toggleRules(key)}>
                  {clamped ? "more" : "less"}
                </button>
              ) : null}
            </div>
            {summon?.node}
          </section>
        );
      })}
      <a class="source-link" href={monster.source} target="_blank" rel="noreferrer">
        SteelCompendium source
        <ExternalIcon />
      </a>
    </div>
  );
}
