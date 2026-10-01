import { useEffect, useState } from 'preact/hooks';
import { catalog, loadMonster, monsterCache, monstersVersion } from '../../data.ts';
import { activeEncounter, summonCreatures, summonerRules } from '../../store.ts';
import { featureSummons, planSummon, type SummonChoice, type SummonOption } from '../../lib/summons.ts';
import { isMinion, minionStamina, SQUAD_MAX, standing } from '../../lib/minions.ts';
import type { CombatInstance, Monster } from '../../types.ts';
import { CloseIcon, PlusIcon } from '../Icons.tsx';
import { PayMalice } from '../Statblock.tsx';

/** Read once per statblock and ability, again only when the catalog or a
    statblock it names has loaded. */
const cache = new Map<string, { version: string; choices: SummonChoice[] }>();

function choicesFor(monster: Monster, featureIndex: number): SummonChoice[] {
  const feature = monster.features[featureIndex];
  if (!feature) return [];
  const entries = catalog.value;
  const version = `${entries.length}:${monstersVersion.value}`;
  const key = `${monster.path}#${featureIndex}`;
  const hit = cache.get(key);
  if (hit?.version === version) return hit.choices;
  const choices = featureSummons(monster, feature, entries, path => monsterCache.get(path));
  cache.set(key, { version, choices });
  return choices;
}

function standingIn(lane: CombatInstance[]): CombatInstance[] {
  return lane.filter(instance => instance.currentStamina > 0);
}

/** How many of an option `summoner` has room for under their squad limits:
    all of them for creatures that aren't minions. */
function roomFor(summoner: CombatInstance, option: SummonOption): number {
  const m = monsterCache.get(option.path);
  if (m && !isMinion(m)) return option.count;
  const plan = planSummon(
    activeEncounter().combat.instances,
    summoner.id,
    option.path,
    option.count,
    summonerRules(summoner),
    SQUAD_MAX,
    squad => (m ? standing(squad.currentStamina, minionStamina(squad, m)) : squad.count),
  );
  return option.count - plan.dropped;
}

function optionLabel(option: SummonOption): string {
  return `${option.count} × ${option.name}`;
}

/** Why an option can't be summoned now, or how many of it will fit, as the
    short note printed beside it. */
function roomNote(room: number, option: SummonOption): string {
  if (!room) return 'Squads full';
  return room < option.count ? `Room for ${room}` : '';
}

function SummonRow({ choices, lane }: { choices: SummonChoice[]; lane: CombatInstance[] }) {
  // The option waiting on "who summons it", when more than one could.
  const [asking, setAsking] = useState<SummonOption | null>(null);
  const summoners = standingIn(lane);
  const paths = choices.flatMap(choice => choice.options.map(option => option.path)).join('|');
  // Load what the chips name, for their prices and names and so a tap is instant.
  useEffect(() => {
    for (const path of paths.split('|')) if (path && !monsterCache.has(path)) loadMonster(path).catch(() => {});
  }, [paths]);

  const pick = (option: SummonOption) => {
    const able = summoners.filter(summoner => roomFor(summoner, option) > 0);
    const only = able.length === 1 ? able[0] : undefined;
    if (only) void summonCreatures(only.id, option.path, option.count, option.malice);
    else setAsking(option);
  };
  const roomOf = (option: SummonOption) => Math.max(0, ...summoners.map(summoner => roomFor(summoner, option)));
  const blockedBy = (room: number) =>
    !summoners.length
      ? 'No one left standing to summon them'
      : !room
        ? 'Their squads are full, or they command all the squads they can'
        : undefined;

  return (
    <div class="summon-row">
      {choices.map((choice, i) =>
        choice.options.some(option => option.malice > 0) ? (
          // A price list, as the book prints it: each line its own buy.
          <ul class="summon-prices" key={i} aria-label="Summon for Malice">
            {choice.options.map(option => {
              const room = roomOf(option);
              const note = summoners.length ? roomNote(room, option) : '';
              return (
                <li key={option.path} class={blockedBy(room) ? 'blocked' : ''}>
                  <PayMalice
                    class={`summon-price ${asking === option ? 'asking' : ''}`}
                    cost={option.malice}
                    label={
                      <>
                        <span class="summon-cost">{option.malice} Malice</span>
                        <span class="summon-name">
                          {optionLabel(option)}
                          {note ? <span class="summon-room">{note}</span> : null}
                        </span>
                      </>
                    }
                    name={`summon ${optionLabel(option)}`}
                    blocked={blockedBy(room)}
                    onPay={() => pick(option)}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <div class="summon-choice" key={i}>
            {choice.lead ? <span class="summon-lead">{choice.lead}</span> : null}
            {choice.options.map((option, j) => {
              const room = roomOf(option);
              const blocked = blockedBy(room);
              const note = summoners.length ? roomNote(room, option) : '';
              return (
                // "or" travels with the chip after it, so a wrap never strands it.
                <span class="summon-alt" key={option.path}>
                  {j ? <span class="summon-or">or</span> : null}
                  <button
                    class={`summon-chip ${asking === option ? 'asking' : ''}`}
                    disabled={!!blocked}
                    title={blocked ?? (note ? `${note} in their squads (adds no EV)` : 'Put them on the board (adds no EV)')}
                    onClick={() => pick(option)}
                  >
                    <PlusIcon />
                    Summon {optionLabel(option)}
                  </button>
                  {note ? <span class="summon-room">{note}</span> : null}
                </span>
              );
            })}
          </div>
        ),
      )}
      {asking ? (
        <div class="summon-who" role="group" aria-label={`Who summons ${asking.name}?`}>
          <span>Summoned by</span>
          {summoners.map(instance => (
            <button
              key={instance.id}
              disabled={!roomFor(instance, asking)}
              onClick={() => {
                setAsking(null);
                void summonCreatures(instance.id, asking.path, asking.count, asking.malice);
              }}
            >
              {instance.name}
            </button>
          ))}
          <button class="icon-button" aria-label="Cancel" title="Cancel" onClick={() => setAsking(null)}>
            <CloseIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The summon chips for one ability of a lane's statblock, or null when the
    ability summons nothing. */
export function abilitySummons(monster: Monster, lane: CombatInstance[], featureIndex: number) {
  const choices = choicesFor(monster, featureIndex);
  if (!choices.length) return null;
  return {
    node: <SummonRow choices={choices} lane={lane} />,
    pays: choices.some(choice => choice.options.some(option => option.malice > 0)),
  };
}
