import { catalogByPath, monsterCache, monstersVersion } from '../../data.ts';
import {
  activeEncounter,
  addGroup,
  changeEncounterCount,
  encounterChecks,
  encounterTotals,
  groupBalance,
  groupCountAdvice,
  removeEncounterEntry,
  removeGroup,
  renameGroup,
  resetActiveEncounter,
  canPeelEntry,
  freshEntry,
  resumeCombat,
  selectPrepGroup,
  startCombat
} from '../../store.ts';
import { beginPrepDrag, shouldSuppressClick } from '../../dnd.ts';
import { difficultyFor, partyMath } from '../../lib/rules.ts';
import { fmt, slugToLabel } from '../../lib/text.ts';
import { SQUAD_MAX } from '../../lib/minions.ts';
import type { ComponentChildren } from 'preact';
import type { EncounterItem, Group } from '../../types.ts';
import { CaretIcon, CloseIcon, GripIcon, MinusIcon, PlusIcon } from '../Icons.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PHONE, prefersReducedMotion } from '../../lib/phoneScroll.ts';

function nameForPath(sourcePath: string): string {
  return monsterCache.get(sourcePath)?.name
    || catalogByPath.get(sourcePath)?.derivedName
    || slugToLabel(sourcePath.split('/').pop()?.replace(/\.json$/i, '') ?? '');
}

/** A creature row's EV line: "EV 16 · 4 each", or "EV 4" for one. Worded,
    not "4 × EV 4", which would read as a multiplication. */
function evLine(item: EncounterItem): string {
  const m = monsterCache.get(item.sourcePath);
  if (!m) return 'EV …';
  return item.count > 1 ? `EV ${fmt(m.ev * item.count)} · ${fmt(m.ev)} each` : `EV ${fmt(m.ev)}`;
}

function BalanceCard() {
  const totals = encounterTotals();
  const party = partyMath(activeEncounter().party);
  const difficulty = difficultyFor(totals.ev, party.partyES, party.oneHeroES);
  const checks = encounterChecks();
  // The ruler runs one hero past the start of Extreme, with the party's ES marked.
  const scale = party.partyES + 4 * party.oneHeroES;
  const fillPct = Math.min(100, scale ? (totals.ev / scale) * 100 : 0);
  const markerPct = Math.min(100, scale ? (party.partyES / scale) * 100 : 0);
  return (
    <div class="balance-card">
      <div><small>Encounter EV</small><strong>{fmt(totals.ev)}</strong></div>
      <div class="difficulty-block"><small>Difficulty</small><strong data-tier={difficulty.tier}>{difficulty.label}</strong></div>
      <div class="budget-track"><span data-tier={difficulty.tier} style={{ width: `${fillPct}%` }} /><i style={{ left: `${markerPct}%` }} /></div>
      {checks.length ? (
        <ul class="balance-checks">
          {checks.map(note => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

/** How long − or + is held before it takes its other step. */
const ALT_HOLD_MS = 450;

/**
 * A stepper button: a tap takes its step. With `onAlt`, holding it (or
 * Shift+click) takes the other step instead, and the tap that ends the hold is
 * swallowed. A squad steps a set on a tap and one minion on a hold.
 */
function StepButton({ label, title, disabled, onStep, onAlt, children }: {
  label: string;
  title?: string | undefined;
  disabled?: boolean;
  onStep: () => void;
  onAlt?: (() => void) | undefined;
  children: ComponentChildren;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const release = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => release, []);
  return (
    <button
      aria-label={label}
      title={title}
      disabled={disabled}
      onPointerDown={onAlt ? event => {
        if (event.button !== 0) return;
        held.current = false;
        release();
        timer.current = setTimeout(() => {
          timer.current = null;
          held.current = true;
          navigator.vibrate?.(10);
          onAlt();
        }, ALT_HOLD_MS);
      } : undefined}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={onAlt ? event => event.preventDefault() : undefined}
      onClick={event => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (shouldSuppressClick()) return;
        if (onAlt && event.shiftKey) onAlt();
        else onStep();
      }}
    >
      {children}
    </button>
  );
}

// The store edits entries in place, and with signals installed a row that
// holds hook state (or reads a signal) skips renders while its props look
// unchanged. So everything it shows arrives as props from its group, and it
// reads no signals of its own, not even through a store helper.
function RosterItem({ item, count, name, ev, set, continues, fresh, peelable }: {
  item: EncounterItem;
  count: number;
  name: string;
  /** A creature entry's EV line (see `evLine`). */
  ev: string;
  /** A squad's minion set size (four, mostly); 0 for creatures. */
  set: number;
  continues: boolean;
  fresh: boolean;
  peelable: boolean;
}) {
  const squad = Boolean(item.squad);
  const lift = (event: PointerEvent, source: HTMLElement, part?: number) => {
    beginPrepDrag(event, {
      kind: 'encounter',
      itemId: item.id,
      sourcePath: item.sourcePath,
      count: part ?? count,
      fromGroupId: item.groupId,
      label: part || !squad ? name : `Squad of ${count} · ${name}`,
      ...(part ? { part } : {})
    }, source);
  };
  const guard = (fn: () => void) => () => {
    if (!shouldSuppressClick()) fn();
  };
  // A squad is dealt in its minion's sets (four, mostly): a tap steps a set,
  // a hold or Shift-click a single minion. The change is written after the
  // squad size in pen for a moment.
  const [jump, setJump] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!jump) return;
    const id = setTimeout(() => setJump(null), 900);
    return () => clearTimeout(id);
  }, [jump]);
  const stepSquad = (delta: number) => {
    const applied = Math.max(delta, -count);
    setJump({ text: applied > 0 ? `+${applied}` : `−${-applied}`, key: Date.now() });
    changeEncounterCount(item.id, applied);
  };
  const setOf = Math.max(1, set);
  const over = squad && count > SQUAD_MAX;
  // The count lifts part of the entry, the row all of it: one creature, or a
  // set of minions (one with Shift). A part as big as the squad is the squad.
  const partFor = (event: PointerEvent) => (squad ? (event.shiftKey ? 1 : setOf) : 1);
  const partTitle = squad
    ? `Drag to move ${setOf} to another squad or group · Shift-drag for one`
    : `Drag to move one ${name} to another group`;
  return (
    <div
      class={`roster-item ${continues ? 'continues' : ''} ${fresh ? 'fresh' : ''}`}
      title="Drag to move between groups or back to the monster list"
      data-drop-squad={squad ? item.id : undefined}
      onPointerDown={event => lift(event, event.currentTarget)}
    >
      <div class="roster-item-main">
        <GripIcon class="drag-grip" />
        <div>
          <strong>{name}</strong>
          <small>
            {over ? (
              <span
                class="squad-over"
                data-hint="Squad above eight"
                data-hint-body={`The rules cap a squad at ${SQUAD_MAX} minions.`}
                tabIndex={0}
              >Squad of {count}</span>
            ) : squad ? `Squad of ${count}` : ev}
            {jump ? <span key={jump.key} class="count-jump" aria-hidden="true">{jump.text}</span> : null}
          </small>
        </div>
      </div>
      <div class="group-actions">
        <StepButton
          label={squad ? `${setOf} fewer ${name} in this squad` : `One fewer ${name}`}
          title={squad ? `${setOf} fewer · hold or Shift-click for one` : undefined}
          onStep={() => (squad ? stepSquad(-setOf) : changeEncounterCount(item.id, -1))}
          onAlt={squad && setOf > 1 ? () => stepSquad(-1) : undefined}
        >
          <MinusIcon />
        </StepButton>
        <b
          class={peelable ? 'peel' : undefined}
          title={peelable ? partTitle : undefined}
          onPointerDown={peelable ? event => {
            const part = partFor(event);
            if (part >= count) return; // the whole squad: the row's own drag
            event.stopPropagation();
            lift(event, event.currentTarget, part);
          } : undefined}
        >
          {count}
        </b>
        <StepButton
          label={squad ? `${setOf} more ${name} in this squad` : `One more ${name}`}
          title={squad ? `${setOf} more · hold or Shift-click for one` : undefined}
          onStep={() => (squad ? stepSquad(setOf) : changeEncounterCount(item.id, 1))}
          onAlt={squad && setOf > 1 ? () => stepSquad(1) : undefined}
        >
          <PlusIcon />
        </StepButton>
        <button class="remove-entry" aria-label={squad ? `Remove ${name} squad` : `Remove ${name}`} onClick={guard(() => removeEncounterEntry(item.id))}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function RosterGroup({ group }: { group: Group }) {
  void monstersVersion.value; // subscribe: EV appears once statblocks load
  const items = activeEncounter().items.filter(item => item.groupId === group.id);
  const selected = group.id === activeEncounter().activePrepGroupId;
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const balance = groupBalance().get(group.id);
  const { oneHeroES } = partyMath(activeEncounter().party);
  // Off the book's one-to-two-hero range: only the EV changes, and explains
  // itself in the rule-preview card (hover, focus, or a tap).
  const hint = balance?.off
    ? `Encounter value ${balance.off === 'heavy' ? 'above' : 'below'} recommendation`
    : undefined;
  const hintBody = `Recommended value is between ${fmt(oneHeroES)}–${fmt(2 * oneHeroES)}.` +
    (balance?.off === 'light' ? ' One group below it is fine.' : '');
  return (
    <section
      class={`prep-roster-group ${selected ? 'selected' : ''}`}
      data-drop-group={group.id}
      data-group={activeEncounter().groups.indexOf(group) % 6}
      aria-selected={selected}
      onClick={event => {
        if (shouldSuppressClick()) return;
        if (!(event.target instanceof Element) || event.target.closest('input, button, [data-hint]')) return;
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
          {balance ? (
            <span class="group-tally">
              {total} {total === 1 ? 'enemy' : 'enemies'} · {hint ? (
                <span class="group-ev off" data-hint={hint} data-hint-body={hintBody} tabIndex={0}>
                  EV {fmt(balance.ev ?? 0)}
                  {/* Which way it is off, readable without the card. */}
                  <CaretIcon class={`ev-dir ${balance.off === 'heavy' ? 'up' : 'down'}`} />
                  <span class="sr-only">{balance.off === 'heavy' ? ', too high' : ', too low'}</span>
                </span>
              ) : <span class="group-ev">EV {balance.ev === null ? '…' : fmt(balance.ev)}</span>}
            </span>
          ) : null}
          <button class="icon-button danger" title="Remove group" aria-label={`Remove group ${group.name}`} onClick={() => removeGroup(group.id)}>
            <CloseIcon />
          </button>
        </div>
      </div>
      <div class="prep-group-items">
        {items.length
          ? items.map((item, i) => (
            <RosterItem
              key={item.id}
              item={item}
              count={item.count}
              name={nameForPath(item.sourcePath)}
              ev={evLine(item)}
              set={item.squad ? Math.max(1, monsterCache.get(item.sourcePath)?.defaultQty ?? 4) : 0}
              continues={items[i - 1]?.sourcePath === item.sourcePath}
              fresh={freshEntry.value === item.id}
              peelable={canPeelEntry(item)}
            />
          ))
          : <div class="group-empty">Empty</div>}
      </div>
    </section>
  );
}

/** The book's group count, printed under the groups only when it's off. */
function GroupCountNote() {
  void monstersVersion.value; // subscribe: solos settle as statblocks hydrate
  const advice = groupCountAdvice();
  if (!advice) return null;
  const { groups, heroes, lo, hi } = advice;
  return (
    <p class="group-count-note" title="Without a solo creature, about as many groups as heroes, give or take two, keeps turns brisk.">
      {groups} {groups === 1 ? 'group' : 'groups'} for {heroes} {heroes === 1 ? 'hero' : 'heroes'} · aim for {lo} to {hi}
    </p>
  );
}

export function EncounterColumn() {
  void monstersVersion.value; // subscribe: roster names/EV settle as statblocks hydrate
  const { count } = encounterTotals();
  const combat = activeEncounter().combat;
  const hasEncounter = activeEncounter().items.length > 0;
  const combatActive = combat.active && combat.instances.length > 0;
  return (
    <aside class="encounter-column panel">
      <div class="panel-heading">
        <div><h2>Encounter</h2></div>
        <div class="panel-heading-actions">
          <span class="count-pill">{count} {count === 1 ? 'enemy' : 'enemies'}</span>
          <button class="secondary compact-button" onClick={addGroup}>
            <PlusIcon />
            Group
          </button>
          <button
            class="secondary compact-button"
            disabled={!hasEncounter}
            title="Empty the roster and reset groups"
            onClick={resetActiveEncounter}
          >Clear</button>
        </div>
      </div>
      <BalanceCard />
      <div id="rosterGroups" class="roster-groups">
        {activeEncounter().groups.map(group => <RosterGroup key={group.id} group={group} />)}
      </div>
      <GroupCountNote />
      <div class="prep-new-group-drop" id="prepNewGroupDrop" aria-label="Drop here to create a new group">
        <PlusIcon />
        <strong>New group</strong>
      </div>
      {combatActive ? (
        <button class="primary wide" onClick={resumeCombat}>Resume combat</button>
      ) : (
        <button class="primary wide" disabled={!hasEncounter} onClick={() => void startCombat()}>Run this encounter</button>
      )}
    </aside>
  );
}

/**
 * On a phone the Encounter box sits below the whole library, so the running
 * total rides along the bottom edge while the Director picks monsters: every
 * Add shows up here at once, and a tap goes down to the roster. It steps
 * aside whenever the Encounter box itself is on screen.
 */
export function EncounterBar() {
  void monstersVersion.value; // subscribe: EV settles as statblocks hydrate
  const [boxInView, setBoxInView] = useState(false);
  const { count, ev } = encounterTotals();
  const party = partyMath(activeEncounter().party);
  const difficulty = difficultyFor(ev, party.partyES, party.oneHeroES);
  useEffect(() => {
    const box = document.querySelector('.encounter-column');
    if (!box) return;
    const watch = new IntersectionObserver(([entry]) => setBoxInView(Boolean(entry?.isIntersecting)), {
      rootMargin: '0px 0px -30% 0px',
    });
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  const shown = count > 0 && !boxInView;
  useEffect(() => {
    document.documentElement.classList.toggle('encounter-bar-shown', shown && matchMedia(PHONE).matches);
    return () => document.documentElement.classList.remove('encounter-bar-shown');
  }, [shown]);
  const go = () => document.querySelector('.encounter-column')?.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
  return (
    <button
      class={`encounter-bar ${shown ? 'shown' : ''}`}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      aria-label={`Go to the encounter: ${count} ${count === 1 ? 'enemy' : 'enemies'}, EV ${fmt(ev)}, ${difficulty.label}`}
      onClick={go}
    >
      <span class="encounter-bar-count">{count} {count === 1 ? 'enemy' : 'enemies'}</span>
      <span class="encounter-bar-ev">EV <b>{fmt(ev)}</b></span>
      <strong data-tier={difficulty.tier}>{difficulty.label}</strong>
      <span class="encounter-bar-go" aria-hidden="true"><CaretIcon /></span>
    </button>
  );
}
