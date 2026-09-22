import { conditionCatalog, conditionInfo, monsterCache, monstersVersion } from '../../data.ts';
import { fmt } from '../../lib/text.ts';
import {
  activeEncounter,
  addCondition,
  applyStaminaCommand,
  groupInstancesByMonster,
  openConditionPickerFor,
  removeCondition,
  removeInstance,
  renameInstance,
  setGroupFilter,
  setInstanceGroup,
  toggleActed,
  toggleConditionPicker
} from '../../store.ts';
import { LaneHeader, StatblockBody } from '../Statblock.tsx';
import type { CombatInstance, Monster } from '../../types.ts';

function ConditionRow({ instanceId, conditions }: { instanceId: string; conditions: string[] }) {
  const picking = openConditionPickerFor.value === instanceId;
  return (
    <>
      <div class="condition-row">
        {conditions.map(condition => {
          const info = conditionInfo(condition);
          return (
            <button
              key={condition}
              class="condition-chip"
              title={info?.description || 'Loading condition description…'}
              onClick={() => removeCondition(instanceId, condition)}
            >
              {condition} ×
            </button>
          );
        })}
        <button class="condition-add" aria-expanded={picking} onClick={() => toggleConditionPicker(instanceId)}>+ condition</button>
      </div>
      {picking ? (
        <div class="condition-picker">
          {conditionCatalog.value.length ? conditionCatalog.value.map(condition => (
            <button
              key={condition.slug}
              title={condition.description || 'Loading condition description…'}
              onClick={() => addCondition(instanceId, condition.name)}
            >
              {condition.name}
            </button>
          )) : <span>Loading conditions…</span>}
        </div>
      ) : null}
    </>
  );
}

type ColorStop = { at: number; rgb: [number, number, number] };

/** Single solid stamina colour that shifts red → gold → teal as the bar fills.
    Interpolates across a few anchor stops so the whole bar reads as one health hue. */
function staminaColor(pct: number): string {
  const stops: ColorStop[] = [
    { at: 0, rgb: [236, 112, 89] }, // critical red   (#ec7059)
    { at: 35, rgb: [232, 165, 107] }, // wounded orange (#e8a56b)
    { at: 65, rgb: [224, 201, 138] }, // caution gold   (#e0c98a)
    { at: 100, rgb: [52, 201, 184] }, // healthy teal   (--accent #34c9b8)
  ];
  const clamped = Math.max(0, Math.min(100, pct));
  let lo = stops[0]!;
  let hi = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (clamped >= a.at && clamped <= b.at) {
      lo = a;
      hi = b;
      break;
    }
  }
  const t = (clamped - lo.at) / (hi.at - lo.at || 1);
  const mix = (i: number) => Math.round(lo.rgb[i]! + (hi.rgb[i]! - lo.rgb[i]!) * t);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

function InstanceCard({ instance, monster, filter }: { instance: CombatInstance; monster: Monster; filter: string | null }) {
  const group = activeEncounter().groups.find(item => item.id === instance.groupId);
  const dimmed = filter && filter !== instance.groupId;
  const pct = instance.maxStamina > 0 ? Math.max(0, Math.min(100, (instance.currentStamina / instance.maxStamina) * 100)) : 0;
  const remaining = instance.kind === 'minion-squad' && monster.stamina > 0 ? Math.ceil(instance.currentStamina / monster.stamina) : null;
  const commitStamina = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    applyStaminaCommand(instance.id, input.value);
  };
  return (
    <article class={`instance-card ${instance.acted ? 'acted' : ''} ${dimmed ? 'instance-dimmed' : ''}`}>
      <div class="instance-topline">
        <button class="acted-toggle" title={instance.acted ? 'Mark not acted' : 'Mark acted'} onClick={() => toggleActed(instance.id)}>
          {instance.acted ? '✓' : ''}
        </button>
        <input
          class="instance-name"
          value={instance.name}
          aria-label="Creature name"
          onChange={event => renameInstance(instance.id, event.currentTarget.value)}
        />
        <select
          class="instance-group"
          aria-label="Activation group"
          value={instance.groupId}
          onChange={event => setInstanceGroup(instance.id, event.currentTarget.value)}
        >
          {activeEncounter().groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button class="icon-button" title="Remove creature" onClick={() => removeInstance(instance.id)}>×</button>
      </div>
      <div class="stamina-row">
        <div
          class="stamina-meter"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${pct}%`, background: staminaColor(pct) }} />
        </div>
        <label class="stamina-field">
          <input
            class="stamina-command"
            value={fmt(instance.currentStamina)}
            inputMode="numeric"
            aria-label="Current stamina"
            onFocus={event => event.currentTarget.select()}
            onChange={commitStamina}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitStamina(event);
              }
            }}
          />
          <span>/ {fmt(instance.maxStamina)}</span>
        </label>
        {remaining !== null ? <strong class="minion-count">{remaining}/{instance.count}</strong> : null}
      </div>
      <ConditionRow instanceId={instance.id} conditions={instance.conditions} />
      {group ? <span class="group-corner">{group.name}</span> : null}
    </article>
  );
}

function GroupFilterBar() {
  const combat = activeEncounter().combat;
  if (activeEncounter().groups.length < 2) return null;
  return (
    <div class="group-filter-bar panel">
      <span class="group-filter-label">GROUPS</span>
      <div class="combat-group-rail">
        {activeEncounter().groups.map(group => {
          const members = combat.instances.filter(instance => instance.groupId === group.id);
          const acted = members.filter(instance => instance.acted).length;
          const active = combat.activeGroupFilter === group.id;
          const complete = members.length > 0 && acted === members.length;
          return (
            <button
              key={group.id}
              class={`combat-group-button ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}
              onClick={() => setGroupFilter(active ? null : group.id)}
            >
              <strong>{group.name}</strong><span>{acted}/{members.length}</span>
            </button>
          );
        })}
      </div>
      <button class={`secondary compact-button ${!combat.activeGroupFilter ? 'active' : ''}`} onClick={() => setGroupFilter(null)}>All</button>
    </div>
  );
}

export function CombatBoard() {
  void monstersVersion.value; // subscribe: lanes render once statblocks are cached
  const combat = activeEncounter().combat;
  if (!combat.instances.length) {
    return <div class="combat-board" id="combatBoard"><div class="combat-empty panel">Build an encounter in Prep.</div></div>;
  }
  const filter = combat.activeGroupFilter;
  return (
    <>
      <GroupFilterBar />
      <div class="combat-board" id="combatBoard">
        {groupInstancesByMonster().map(([path, instances]) => {
          const monster = monsterCache.get(path);
          if (!monster) {
            return <section class="monster-lane panel" key={path}><div class="lane-loading">Loading statblock…</div></section>;
          }
          const laneRelevant = !filter || instances.some(instance => instance.groupId === filter);
          return (
            <section class={`monster-lane panel ${laneRelevant ? '' : 'lane-dimmed'}`} key={path}>
              <LaneHeader monster={monster} />
              <div class="instance-stack">
                {instances.map(instance => <InstanceCard key={instance.id} instance={instance} monster={monster} filter={filter} />)}
              </div>
              <StatblockBody monster={monster} interactive={true} />
            </section>
          );
        })}
      </div>
    </>
  );
}
