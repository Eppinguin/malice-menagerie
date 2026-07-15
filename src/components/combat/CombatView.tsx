import {
  activeEncounter,
  autoPickMalice,
  removeActiveEffect,
  state,
  toggleMaliceDock
} from '../../store.ts';
import { MaliceDock } from './MaliceDock.tsx';
import { CombatBoard } from './CombatBoard.tsx';

function ActiveEffects() {
  return (
    <div class="active-effects">
      {activeEncounter().combat.activeEffects.map(effect => (
        <span class="effect-chip" key={effect.id}>
          <strong>{effect.name}</strong>
          <button onClick={() => removeActiveEffect(effect.id)}>×</button>
        </span>
      ))}
    </div>
  );
}

export function CombatView({ active }: { active: boolean }) {
  const maliceOpen = state.value.ui.maliceDockOpen;
  const selectedCount = activeEncounter().combat.selectedMaliceFeatureIds.length;
  return (
    <section class={`view combat-view ${active ? 'active' : ''}`}>
      <div class={`encounter-dock panel malice-dock ${maliceOpen ? 'open' : 'closed'}`}>
        <header class="malice-dock-header">
          <button class="malice-dock-toggle" aria-expanded={maliceOpen} onClick={toggleMaliceDock}>
            <b class="malice-dock-caret" aria-hidden="true">{maliceOpen ? '▾' : '▸'}</b>
            <strong>Encounter Malice</strong>
            <span>{selectedCount} selected</span>
          </button>
          {maliceOpen ? (
            <button class="secondary compact-button" title="Choose a balanced 3–4 feature set" onClick={autoPickMalice}>Auto pick 3–4</button>
          ) : null}
        </header>
        {maliceOpen ? (
          <>
            <MaliceDock />
            <ActiveEffects />
          </>
        ) : null}
      </div>
      <CombatBoard />
    </section>
  );
}
