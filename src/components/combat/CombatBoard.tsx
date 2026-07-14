import { conditionCatalog, conditionInfo, monsterCache, monstersVersion } from '../../data.ts';
import { fmt } from '../../lib/text.ts';
import {
  addCondition,
  applyStaminaCommand,
  groupInstancesByMonster,
  openConditionPickerFor,
  removeCondition,
  removeInstance,
  renameInstance,
  setInstanceGroup,
  state,
  toggleActed,
  toggleConditionPicker
} from '../../store.ts';
import { LaneHeader, StatblockBody } from '../Statblock.tsx';
import type { CombatInstance, Monster } from '../../types.ts';

function ConditionRow({ instance }: { instance: CombatInstance }) {
  const picking = openConditionPickerFor.value === instance.id;
  return (
    <>
      <div class="condition-row">
        {instance.conditions.map(condition => {
          const info = conditionInfo(condition);
          return (
            <button
              key={condition}
              class="condition-chip"
              title={info?.description || 'Loading condition description…'}
              onClick={() => removeCondition(instance.id, condition)}
            >
              {condition} ×
            </button>
          );
        })}
        <button class="condition-add" aria-expanded={picking} onClick={() => toggleConditionPicker(instance.id)}>+ condition</button>
      </div>
      {picking ? (
        <div class="condition-picker">
          {conditionCatalog.value.length ? conditionCatalog.value.map(condition => (
            <button
              key={condition.slug}
              title={condition.description || 'Loading condition description…'}
              onClick={() => addCondition(instance.id, condition.name)}
            >
              {condition.name}
            </button>
          )) : <span>Loading conditions…</span>}
        </div>
      ) : null}
    </>
  );
}

function InstanceCard({ instance, monster, filter }: { instance: CombatInstance; monster: Monster; filter: string | null }) {
  const group = state.value.groups.find(item => item.id === instance.groupId);
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
          {state.value.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button class="icon-button" title="Remove creature" onClick={() => removeInstance(instance.id)}>×</button>
      </div>
      <div class="stamina-row">
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
      <ConditionRow instance={instance} />
      {group ? <span class="group-corner">{group.name}</span> : null}
    </article>
  );
}

export function CombatBoard() {
  monstersVersion.value; // lanes render once statblocks are cached
  const combat = state.value.combat;
  if (!combat.instances.length) {
    return <div class="combat-board" id="combatBoard"><div class="combat-empty panel">Build an encounter in Prep.</div></div>;
  }
  const filter = combat.activeGroupFilter;
  return (
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
  );
}
