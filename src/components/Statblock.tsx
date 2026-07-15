import { fmt, numberFrom, richText, signed } from "../lib/text.ts";
import { effectiveSpeed } from "../lib/rules.ts";
import { activeEncounter, lastRolls, rollFeature, spendAbilityMalice } from "../store.ts";
import type { FeatureEffect, Monster, MonsterFeature } from "../types.ts";

function featureLabel(feature: MonsterFeature): string {
  return [feature.ability_type, feature.cost, feature.usage]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(" · ");
}

function featureMeta(feature: MonsterFeature): string {
  return [
    Array.isArray(feature.keywords) ? feature.keywords.join(", ") : "",
    feature.distance,
    feature.target,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function LaneHeader({ monster }: { monster: Monster }) {
  const speed = effectiveSpeed(monster, activeEncounter().combat.activeEffects);
  return (
    <header class="lane-header">
      <div>
        <p class="eyebrow">{monster.ancestry.toUpperCase()}</p>
        <h2>{monster.name}</h2>
        <p>
          Level {fmt(monster.level)} {monster.organization} {monster.role}
        </p>
      </div>
      <div class="ev-badge">EV {monster.evLabel}</div>
      <div class="lane-core-stats">
        <span>
          <small>SIZE</small>
          <b>{monster.size}</b>
        </span>
        <span>
          <small>SPEED</small>
          <b>
            {speed.value}
            {speed.note ? <em>{speed.note}</em> : null}
          </b>
        </span>
        <span>
          <small>STAMINA</small>
          <b>{fmt(monster.stamina)}</b>
        </span>
        <span>
          <small>STAB.</small>
          <b>{monster.stability}</b>
        </span>
        <span>
          <small>FREE</small>
          <b>{monster.freeStrike}</b>
        </span>
      </div>
      <div class="lane-characteristics">
        {Object.entries(monster.chars).map(([key, value]) => (
          <span key={key}>
            <small>{key}</small>
            <b>{signed(value)}</b>
          </span>
        ))}
      </div>
    </header>
  );
}

function TierRows({ effect, rolledTier }: { effect: FeatureEffect; rolledTier: number | null }) {
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
          <b>{index + 1}</b>
          <span dangerouslySetInnerHTML={{ __html: richText(effect[key]) }} />
        </div>
      ))}
    </div>
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
            <button onClick={() => rollFeature(monster.path, featureIndex, effectIndex)}>
              Roll
            </button>
          ) : null}
          {lastRoll ? <span>{lastRoll.label}</span> : null}
        </div>
      ) : null}
      <TierRows effect={effect} rolledTier={lastRoll?.tier ?? null} />
      {effect.effect ? <p dangerouslySetInnerHTML={{ __html: richText(effect.effect) }} /> : null}
    </>
  );
}

/**
 * The shared statblock body. `interactive` adds roll buttons and
 * malice-spend controls, which only make sense during a live encounter.
 */
export function StatblockBody({
  monster,
  interactive,
}: {
  monster: Monster;
  interactive: boolean;
}) {
  return (
    <div class="statblock-body">
      {monster.features.map((feature, featureIndex) => {
        const isTrait = String(feature.feature_type || "").toLowerCase() === "trait";
        if (isTrait) {
          return (
            <section class="trait-block" key={featureIndex}>
              <div class="feature-title">
                <strong>{feature.name || "Trait"}</strong>
              </div>
              {(feature.effects || []).map((effect, effectIndex) => (
                <p
                  key={effectIndex}
                  dangerouslySetInnerHTML={{ __html: richText(effect.effect || "") }}
                />
              ))}
            </section>
          );
        }
        const meta = featureMeta(feature);
        const cost = numberFrom(feature.cost, 0);
        const spendable =
          interactive && cost > 0 && String(feature.cost).toLowerCase().includes("malice");
        return (
          <section class="ability-block" key={featureIndex}>
            <div class="feature-title">
              <strong>{feature.name || "Ability"}</strong>
              <span>{featureLabel(feature)}</span>
            </div>
            {meta ? <div class="feature-meta">{meta}</div> : null}
            <div class="feature-effects">
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
            </div>
            {spendable ? (
              <button
                class="ability-spend"
                onClick={() => spendAbilityMalice(cost, feature.name || "Ability")}
              >
                Spend {cost} Malice
              </button>
            ) : null}
          </section>
        );
      })}
      <a class="source-link" href={monster.source} target="_blank" rel="noreferrer">
        SteelCompendium source ↗
      </a>
    </div>
  );
}
