import {
  activeEncounter,
  autoPickMalice,
  removeActiveEffect,
  state,
  toggleMaliceDock
} from '../../store.ts';
import { MaliceDock } from './MaliceDock.tsx';
import { CombatBoard, GroupFilterBar } from './CombatBoard.tsx';
import { TriggerWatch } from './Watch.tsx';
import { CaretIcon, CloseIcon } from '../Icons.tsx';
import { PenRing, PenStrike } from '../Pen.tsx';

function ActiveEffects() {
  return (
    <div class="active-effects">
      {activeEncounter().combat.activeEffects.map(effect => (
        <span class="effect-chip" key={effect.id}>
          <strong>
            {effect.name}
            <PenStrike seed={`${effect.id}:strike`} />
          </strong>
          <button aria-label={`End ${effect.name}`} title="Cross it off" onClick={() => removeActiveEffect(effect.id)}>
            <CloseIcon />
          </button>
          <PenRing seed={effect.id} />
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
      {/* One strip over the board: the Malice toggle, any live effect, and the
          group filter share a line, so the statblocks start high on the page. */}
      <div class={`encounter-dock malice-dock ${maliceOpen ? 'open' : 'closed'}`}>
        <header class="run-strip">
          <div class="malice-dock-header">
            <button class="malice-dock-toggle" aria-expanded={maliceOpen} onClick={toggleMaliceDock}>
              <CaretIcon class="malice-dock-caret" />
              <span class="ds-glyph malice-skull" aria-hidden="true">
                d
              </span>
              <strong>Encounter Malice</strong>
              <span class="malice-dock-count">{selectedCount} selected</span>
            </button>
            {maliceOpen ? (
              <button class="secondary compact-button" title="Choose a balanced 3–4 feature set" onClick={autoPickMalice}>Auto pick 3–4</button>
            ) : null}
          </div>
          <ActiveEffects />
          <GroupFilterBar />
        </header>
        {maliceOpen ? (
          <div class="malice-dock-body">
            <MaliceDock />
          </div>
        ) : null}
      </div>
      <TriggerWatch />
      <CombatBoard />
    </section>
  );
}
