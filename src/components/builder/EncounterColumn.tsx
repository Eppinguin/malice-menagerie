import { catalogByPath, monsterCache, monstersVersion } from '../../data.ts';
import {
  addGroup,
  changeEncounterCount,
  encounterTotals,
  removeEncounterEntry,
  removeGroup,
  renameGroup,
  selectPrepGroup,
  startCombat,
  state
} from '../../store.ts';
import { beginPrepDrag, shouldSuppressClick } from '../../dnd.ts';
import { difficultyFor, partyMath } from '../../lib/rules.ts';
import { fmt, slugToLabel } from '../../lib/text.ts';
import type { EncounterItem, Group } from '../../types.ts';

function nameForPath(sourcePath: string): string {
  return monsterCache.get(sourcePath)?.name
    || catalogByPath.get(sourcePath)?.derivedName
    || slugToLabel(sourcePath.split('/').pop()?.replace(/\.json$/i, '') ?? '');
}

function BalanceCard() {
  const totals = encounterTotals();
  const party = partyMath(state.value.party);
  const difficulty = difficultyFor(totals.ev, party.partyES);
  const fillPct = Math.min(100, party.partyES ? (totals.ev / (party.partyES * 1.5)) * 100 : 0);
  const markerPct = Math.min(100, party.partyES ? (party.partyES / (party.partyES * 1.5)) * 100 : 0);
  return (
    <div class="balance-card">
      <div><small>EV</small><strong>{fmt(totals.ev)}</strong></div>
      <div class="difficulty-block"><small>DIFFICULTY</small><strong data-tier={difficulty.tier}>{difficulty.label}</strong></div>
      <div class="budget-track"><span data-tier={difficulty.tier} style={{ width: `${fillPct}%` }} /><i style={{ left: `${markerPct}%` }} /></div>
      <p>{difficulty.help}</p>
    </div>
  );
}

function RosterItem({ item }: { item: EncounterItem }) {
  const m = monsterCache.get(item.sourcePath);
  const name = nameForPath(item.sourcePath);
  const ev = m ? fmt(m.ev * item.count) : '…';
  const startDrag = (event: PointerEvent, row: HTMLElement) => {
    beginPrepDrag(event, {
      kind: 'encounter',
      itemId: item.id,
      sourcePath: item.sourcePath,
      count: item.count,
      fromGroupId: item.groupId,
      label: name
    }, row);
  };
  const guard = (fn: () => void) => () => {
    if (!shouldSuppressClick()) fn();
  };
  return (
    <div class="roster-item" title="Drag to move between groups or back to the monster list" onPointerDown={event => startDrag(event, event.currentTarget)}>
      <div class="roster-item-main">
        <span class="drag-grip" aria-hidden="true">⋮⋮</span>
        <div><strong>{name}</strong><small>{item.count} × · EV {ev}</small></div>
      </div>
      <div class="group-actions">
        <button onClick={guard(() => changeEncounterCount(item.id, -1))}>−</button>
        <b>{item.count}</b>
        <button onClick={guard(() => changeEncounterCount(item.id, 1))}>+</button>
        <button class="remove-entry" onClick={guard(() => removeEncounterEntry(item.id))}>×</button>
      </div>
    </div>
  );
}

function RosterGroup({ group }: { group: Group }) {
  const items = state.value.encounter.filter(item => item.groupId === group.id);
  const selected = group.id === state.value.activePrepGroupId;
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <section
      class={`prep-roster-group ${selected ? 'selected' : ''}`}
      data-drop-group={group.id}
      aria-selected={selected}
      onClick={event => {
        if (shouldSuppressClick()) return;
        if (!(event.target instanceof Element) || event.target.closest('input, button')) return;
        selectPrepGroup(group.id);
      }}
    >
      <div class="prep-group-head">
        <input
          class="group-name-input"
          value={group.name}
          aria-label="Group name"
          onChange={event => renameGroup(group.id, event.currentTarget.value)}
        />
        <div class="prep-group-head-actions">
          <span>{total}</span>
          <button class="icon-button danger" title="Remove group" onClick={() => removeGroup(group.id)}>×</button>
        </div>
      </div>
      <div class="prep-group-items">
        {items.length
          ? items.map(item => <RosterItem key={item.id} item={item} />)
          : <div class="group-empty">Empty</div>}
      </div>
    </section>
  );
}

export function EncounterColumn() {
  void monstersVersion.value; // subscribe: roster names/EV settle as statblocks hydrate
  const { count } = encounterTotals();
  const hasEncounter = state.value.encounter.length > 0;
  return (
    <aside class="encounter-column panel">
      <div class="panel-heading">
        <div><h2>Encounter</h2></div>
        <div class="panel-heading-actions">
          <span class="count-pill">{count} {count === 1 ? 'enemy' : 'enemies'}</span>
          <button class="secondary compact-button" onClick={addGroup}>+ Group</button>
        </div>
      </div>
      <BalanceCard />
      <div id="rosterGroups" class="roster-groups">
        {state.value.groups.map(group => <RosterGroup key={group.id} group={group} />)}
      </div>
      <div class="prep-new-group-drop" id="prepNewGroupDrop" aria-label="Drop here to create a new group">
        <span>＋</span><strong>New group</strong>
      </div>
      <button class="primary wide" disabled={!hasEncounter} onClick={() => void startCombat()}>Run this encounter</button>
    </aside>
  );
}
