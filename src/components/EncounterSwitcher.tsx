import { useState } from 'preact/hooks';
import {
  createEncounter,
  deleteEncounter,
  duplicateEncounter,
  renameEncounter,
  selectEncounter,
  state
} from '../store.ts';
import type { Encounter } from '../types.ts';
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon } from './Icons.tsx';

function encounterSummary(enc: Encounter): string {
  const enemies = enc.items.reduce((sum, item) => sum + item.count, 0);
  if (enc.combat.active) return `In combat · round ${enc.combat.round}`;
  if (!enemies) return 'Empty';
  return `${enemies} ${enemies === 1 ? 'enemy' : 'enemies'}`;
}

function EncounterRow({ enc, active }: { enc: Encounter; active: boolean }) {
  const [editing, setEditing] = useState(false);

  const commitName = (value: string) => {
    setEditing(false);
    renameEncounter(enc.id, value);
  };

  return (
    <div
      class={`encounter-row ${active ? 'active' : ''}`}
      aria-selected={active}
      onClick={() => {
        if (!editing) selectEncounter(enc.id);
      }}
    >
      <div class="encounter-row-main">
        {editing ? (
          <input
            class="encounter-name-input"
            autoFocus
            value={enc.name}
            aria-label="Encounter name"
            onClick={event => event.stopPropagation()}
            onBlur={event => commitName(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            class="encounter-name"
            title="Double-click to rename"
            onDblClick={event => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <strong>{enc.name}</strong>
            <small>{encounterSummary(enc)}</small>
          </button>
        )}
      </div>
      <div class="encounter-row-actions" onClick={event => event.stopPropagation()}>
        <button class="icon-button" title="Rename" aria-label={`Rename ${enc.name}`} onClick={() => setEditing(true)}>
          <PencilIcon />
        </button>
        <button class="icon-button" title="Duplicate" aria-label={`Duplicate ${enc.name}`} onClick={() => duplicateEncounter(enc.id)}>
          <CopyIcon />
        </button>
        <button
          class="icon-button danger"
          title="Delete encounter"
          aria-label={`Delete ${enc.name}`}
          disabled={state.value.encounters.length === 1}
          onClick={() => {
            if (confirm(`Delete “${enc.name}”? This can’t be undone.`)) deleteEncounter(enc.id);
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

export function EncounterSwitcher() {
  const { encounters, activeEncounterId } = state.value;
  return (
    <section class="encounter-switcher">
      <div class="encounter-switcher-head">
        <h2 class="spine-heading">Encounters</h2>
        <button class="mini-button" title="New encounter" onClick={() => createEncounter()}>
          <PlusIcon />
          New
        </button>
      </div>
      <div class="encounter-list">
        {encounters.map(enc => (
          <EncounterRow key={enc.id} enc={enc} active={enc.id === activeEncounterId} />
        ))}
      </div>
    </section>
  );
}
