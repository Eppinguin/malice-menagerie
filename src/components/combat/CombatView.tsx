import {
  adjustMalice,
  nextRound,
  removeActiveEffect,
  setGroupFilter,
  setView,
  state
} from '../../store.ts';
import { MaliceDock } from './MaliceDock.tsx';
import { CombatBoard } from './CombatBoard.tsx';

function CombatToolbar() {
  const combat = state.value.combat;
  const acted = combat.instances.filter(instance => instance.acted).length;
  const nextGain = state.value.party.heroes + combat.round + 1;
  return (
    <div class="combat-toolbar panel">
      <button class="secondary" onClick={() => setView('builder')}>← Prep</button>
      <div class="round-block"><span>ROUND</span><strong>{combat.round}</strong></div>
      <div class="malice-block">
        <div><span>MALICE</span><small>Next round +{nextGain}</small></div>
        <button class="square" onClick={() => adjustMalice(-1)}>−</button>
        <strong>{combat.malice}</strong>
        <button class="square" onClick={() => adjustMalice(1)}>+</button>
      </div>
      <div class="round-next">
        <span>{acted}/{combat.instances.length} marked</span>
        <button class="primary" onClick={nextRound}>Next round →</button>
      </div>
    </div>
  );
}

function GroupRail() {
  const combat = state.value.combat;
  return (
    <div class="dock-row group-dock">
      <div class="dock-label"><span>GROUPS</span></div>
      <div class="combat-group-rail">
        {state.value.groups.map(group => {
          const members = combat.instances.filter(instance => instance.groupId === group.id);
          const acted = members.filter(instance => instance.acted).length;
          const active = combat.activeGroupFilter === group.id;
          const complete = members.length > 0 && acted === members.length;
          return (
            <button
              key={group.id}
              class={`combat-group-button ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}
              onClick={() => setGroupFilter(group.id)}
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

function ActiveEffects() {
  return (
    <div class="active-effects">
      {state.value.combat.activeEffects.map(effect => (
        <span class="effect-chip" key={effect.id}>
          <strong>{effect.name}</strong>
          <button onClick={() => removeActiveEffect(effect.id)}>×</button>
        </span>
      ))}
    </div>
  );
}

export function CombatView({ active }: { active: boolean }) {
  return (
    <section class={`view ${active ? 'active' : ''}`}>
      <CombatToolbar />
      <div class="encounter-dock panel">
        <GroupRail />
        <div class="dock-row malice-dock">
          <div class="dock-label"><span>MALICE</span></div>
          <div class="malice-feature-row"><MaliceDock /></div>
        </div>
        <ActiveEffects />
      </div>
      <CombatBoard />
    </section>
  );
}
