import { conditionCatalog, conditionInfo, monsterCache, monstersVersion } from '../../data.ts';
import { sourceUrl } from '../../lib/repo.ts';
import { fmt } from '../../lib/text.ts';
import {
  activeEncounter,
  addCondition,
  applyStaminaCommand,
  captainCandidates,
  groupInstancesByMonster,
  openConditionPickerFor,
  removeCondition,
  removeInstance,
  renameInstance,
  setGroupFilter,
  setInstanceGroup,
  setSquadCaptain,
  hasActed,
  markTurn,
  toggleConditionPicker
} from '../../store.ts';
import { LaneHeader, StatblockBody } from '../Statblock.tsx';
import { abilityMarks } from './Watch.tsx';
import { abilitySummons } from './Summons.tsx';
import type { CombatInstance, Monster } from '../../types.ts';
import { CaptainIcon, CaretIcon, CloseIcon, PlusIcon } from '../Icons.tsx';
import { PenCross, PenRing, PenStrike, PenTick } from '../Pen.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { minionStamina, standing } from '../../lib/minions.ts';
import { PHONE, chromeOffset, holdChrome, prefersReducedMotion } from '../../lib/phoneScroll.ts';

/** How far a press must travel before it counts as a drag, so a stray tap
    on the track never changes Stamina mid-combat. */
const DRAG_THRESHOLD = 4;

/** On touch, a finger this close to the fill's end has the handle. */
const GRIP_REACH = 22;
/** On touch, a press elsewhere on the track must rest this long to take it. */
const ARM_MS = 250;
/** A resting finger that wanders this far was a scroll or a swipe. */
const REST_SLOP = 6;

/** Touches a Stamina track has taken, so the phone pager leaves them be. */
const heldTouches = new Set<number>();

/** The fill sits this far inside the ruler's border on each side. */
const TRACK_INSET = 2;

/** A point along the fill, as CSS: `p` runs 0..1 between the inset ends. */
const along = (p: number) => `calc(${TRACK_INSET}px + (100% - ${TRACK_INSET * 2}px) * ${p})`;

/**
 * Stamina as a printed ruler filled in pen blue. The fill is what the
 * creature has left; its end is the handle, and the whole track can be
 * dragged. It is a value and a control, so it stays crisp: hand marks are
 * kept for events (a tick, a ring, the Down cross). A drag previews in place
 * (the field and a pen note show the new value and the change) and commits
 * on release; Escape puts it back. Arrow keys step by 1, Page keys and
 * Shift by 10.
 *
 * A finger is held to a stricter standard than a mouse, because the track
 * sits in the way of every scroll and page swipe. Touch the handle and move
 * sideways and it follows at once; anywhere else on the track the finger
 * has to rest a moment first, and the handle lifts to meet it. A finger
 * that is moving on through goes on scrolling or turning the page.
 */
function StaminaTrack({
  id,
  name,
  current,
  max,
  perMinion,
  onPreview,
}: {
  id: string;
  name: string;
  current: number;
  max: number;
  perMinion: number | null;
  onPreview: (value: number | null) => void;
}) {
  // Primitives, not the instance: the store edits instances in place, and a
  // signals-aware component skips renders when its props are unchanged.
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{
    pointer: number;
    touch: boolean;
    startX: number;
    startY: number;
    /** Finger to handle, so a grabbed handle does not leap under it. */
    offset: number;
    /** A touch on the handle, waiting for its first sideways move. */
    grip: boolean;
    timer: number;
    moved: boolean;
    /** Taken by resting, with no move since: a resting thumb, not a choice. */
    idle: boolean;
  } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const shown = draft ?? current;
  const ratio = max > 0 ? Math.max(0, Math.min(1, shown / max)) : 0;

  // Once a finger has the track, the page must not scroll out from under it.
  // Touch events are the only way to say so mid-gesture.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const hold = (event: TouchEvent) => {
      if (drag.current?.moved && event.cancelable) event.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, []);

  const preview = (value: number | null) => {
    setDraft(value);
    onPreview(value);
  };
  // Temporary Stamina can sit above max; a keyboard step must not erase it.
  const commit = (value: number, ceiling = max) => {
    const next = Math.max(0, Math.min(ceiling, Math.round(value)));
    if (next !== current) applyStaminaCommand(id, String(next));
  };
  const valueAt = (el: HTMLElement, clientX: number) => {
    const box = el.getBoundingClientRect();
    const span = box.width - TRACK_INSET * 2;
    return Math.round(Math.max(0, Math.min(1, (clientX - box.left - TRACK_INSET) / span)) * max);
  };
  const handleX = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return box.left + TRACK_INSET + (box.width - TRACK_INSET * 2) * ratio;
  };
  const end = () => {
    const state = drag.current;
    if (!state) return;
    window.clearTimeout(state.timer);
    heldTouches.delete(state.pointer);
    drag.current = null;
  };
  /** The track takes the gesture: from here it is a drag, not a scroll. */
  const take = (el: HTMLElement, pointer: number) => {
    const state = drag.current;
    if (!state || state.moved) return;
    state.moved = true;
    if (state.touch) heldTouches.add(pointer);
    if (!el.hasPointerCapture(pointer)) el.setPointerCapture(pointer);
  };

  const ticks: number[] =
    perMinion && perMinion > 0 && max > perMinion
      ? Array.from({ length: Math.ceil(max / perMinion) - 1 }, (_, i) => ((i + 1) * perMinion) / max)
      : [];

  return (
    <div
      ref={track}
      class={`stamina-track ${draft !== null ? 'dragging' : ''} ${perMinion ? 'squad' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={`${name} Stamina`}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={`${shown} of ${max} Stamina${shown <= 0 ? ', down' : !perMinion && shown <= max / 2 ? ', winded' : ''}`}
      title="Drag to set Stamina"
      onPointerDown={event => {
        if (event.button !== 0 || max <= 0 || drag.current) return;
        const el = event.currentTarget;
        const touch = event.pointerType === 'touch';
        const reach = handleX(el) - event.clientX;
        const state = {
          pointer: event.pointerId,
          touch,
          startX: event.clientX,
          startY: event.clientY,
          offset: 0,
          grip: false,
          timer: 0,
          moved: false,
          idle: false,
        };
        drag.current = state;
        // A mouse or a pen means it: the whole track drags, as before.
        if (!touch) {
          el.setPointerCapture(event.pointerId);
          return;
        }
        if (Math.abs(reach) <= GRIP_REACH) {
          state.grip = true;
          state.offset = reach;
          // Claimed now, so the pager never starts a page turn on the handle.
          heldTouches.add(event.pointerId);
          return;
        }
        // Elsewhere on the track a finger has to rest before it takes hold.
        state.timer = window.setTimeout(() => {
          if (drag.current !== state) return;
          take(el, state.pointer);
          state.idle = true;
          preview(valueAt(el, state.startX));
          navigator.vibrate?.(10);
        }, ARM_MS);
      }}
      onPointerMove={event => {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        const el = event.currentTarget;
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        if (!state.moved) {
          if (state.touch && !state.grip) {
            // Moving before it has rested: a scroll or a swipe passing through.
            if (Math.hypot(dx, dy) > REST_SLOP) end();
            return;
          }
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          // A finger on the handle that heads up or down is scrolling.
          if (state.touch && Math.abs(dy) >= Math.abs(dx)) return end();
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          take(el, state.pointer);
        }
        if (state.idle && Math.abs(dx) >= DRAG_THRESHOLD) state.idle = false;
        preview(valueAt(el, event.clientX + state.offset));
      }}
      onPointerUp={event => {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        end();
        // A finger that rested and lifted again sets nothing: it only showed
        // where the handle would go.
        if (state.moved && !state.idle) commit(valueAt(event.currentTarget, event.clientX + state.offset));
        preview(null);
      }}
      onPointerCancel={() => {
        end();
        preview(null);
      }}
      // A resting finger must not raise the system's press-and-hold menu.
      onContextMenu={event => {
        if (drag.current?.touch) event.preventDefault();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) {
          end();
          preview(null);
          return;
        }
        const big = event.shiftKey ? 10 : 1;
        const step: Record<string, number> = {
          ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big, PageUp: 10, PageDown: -10,
        };
        let next: number | null = null;
        if (event.key in step) next = current + (step[event.key] ?? 0);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = max;
        if (next === null) return;
        event.preventDefault();
        commit(next, perMinion ? max : Math.max(max, current));
      }}
    >
      <span class="stamina-rule" aria-hidden="true" />
      <span class="stamina-fill" style={{ transform: `scaleX(${ratio})` }} />
      <span class="stamina-ticks" aria-hidden="true">
        {ticks.length
          ? ticks.map(at => <i key={at} class="minion-tick" style={{ left: along(at) }} />)
          : <i class="winded-tick" style={{ left: along(0.5) }} />}
      </span>
      <span class="stamina-level" style={{ left: along(ratio) }} aria-hidden="true" />
      {draft !== null && draft !== current ? (
        <b class="stamina-delta" style={{ left: `clamp(14px, ${along(ratio)}, calc(100% - 14px))` }} aria-hidden="true">
          {draft > current ? '+' : '−'}{Math.abs(draft - current)}
        </b>
      ) : null}
    </div>
  );
}

/** One box per turn this round. Most creatures get one; solos get two (Ajax three). */
function TurnBoxes({ instance }: { instance: CombatInstance }) {
  const { turns, turnsTaken, name } = instance;
  return (
    <div class="turn-boxes" role="group" aria-label={`${name}: ${turnsTaken} of ${turns} turns taken`}>
      {Array.from({ length: turns }, (_, index) => {
        const done = index < turnsTaken;
        const label = turns > 1 ? `turn ${index + 1}` : 'turn';
        return (
          <button
            key={index}
            class="acted-toggle"
            title={done ? `Unmark ${label}` : `Mark ${label} taken`}
            aria-pressed={done}
            aria-label={`${name} ${label}`}
            onClick={() => markTurn(instance.id, index)}
          >
            {done ? <PenTick seed={`${instance.id}:${index}`} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Adds a condition: a printed control on the name line, directly above the
    conditions it adds, so a creature with nothing on it costs the card no
    extra row. On a very narrow slip the word gives way to the plus. */
function ConditionAdd({ instanceId, name }: { instanceId: string; name: string }) {
  return (
    <button
      class="condition-add"
      aria-expanded={openConditionPickerFor.value === instanceId}
      aria-label={`Add a condition to ${name}`}
      title="Add a condition"
      onClick={() => toggleConditionPicker(instanceId)}
    >
      <PlusIcon />
      <span class="condition-add-label">Condition</span>
    </button>
  );
}

/** Winded and the ringed conditions. The row exists only while it has
    something to say. */
function ConditionRow({ instanceId, conditions, winded, leads, summoned }: {
  instanceId: string;
  conditions: string[];
  winded: boolean;
  /** The squad this creature captains, if any. */
  leads: string | null;
  /** Who brought this creature onto the board, when an ability did. */
  summoned: string | null;
}) {
  const picking = openConditionPickerFor.value === instanceId;
  return (
    <>
      {winded || leads || summoned !== null || conditions.length ? (
        <div class="condition-row">
          {summoned !== null ? (
            <span class="summoned-note" title="Summoned during the fight: adds no EV, and prep edits leave it be">
              {summoned ? `Summoned by ${summoned}` : 'Summoned'}
            </span>
          ) : null}
          {winded ? <span class="winded-note">Winded</span> : null}
          {leads ? <span class="captain-note" title={`Captain of ${leads}`}>Leads {leads}</span> : null}
          {conditions.map(condition => {
            const info = conditionInfo(condition);
            return (
              // Hover or focus reads the condition's rule on the shared preview
              // card; a click crosses it off.
              <button
                key={condition}
                class="condition-chip"
                data-rule-preview={info ? '' : undefined}
                data-rule-path={info?.path}
                data-rule-url={info ? sourceUrl(info.path) : undefined}
                title={info ? undefined : 'Tap to cross it off.'}
                onClick={() => removeCondition(instanceId, condition)}
              >
                <span class="condition-name">
                  {condition}
                  <PenStrike seed={`${instanceId}:${condition}:strike`} />
                </span>
                <CloseIcon />
                <PenRing seed={`${instanceId}:${condition}`} />
              </button>
            );
          })}
        </div>
      ) : null}
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

/** Draw Steel's own thresholds: winded at half Stamina or less, down at 0.
    A squad's pool is never winded; its minions just fall. */
function staminaState(current: number, max: number, squad: boolean): 'healthy' | 'winded' | 'down' {
  if (current <= 0) return 'down';
  return !squad && current <= max / 2 ? 'winded' : 'healthy';
}

/** The captain choice as a native select: no captain, then the creatures
    on the board that could lead this squad. */
function CaptainSelect({ squad, class: cls }: { squad: CombatInstance; class: string }) {
  const candidates = captainCandidates(squad);
  const captain = activeEncounter().combat.instances.find(item => item.id === squad.captainId);
  const leading = (id: string) =>
    activeEncounter().combat.instances.find(item => item.captainId === id && item.id !== squad.id);
  return (
    <select
      class={cls}
      aria-label={`${squad.name} captain`}
      value={squad.captainId ?? ''}
      onChange={event => setSquadCaptain(squad.id, event.currentTarget.value || null)}
    >
      <option value="">No captain</option>
      {captain && !candidates.includes(captain) ? <option value={captain.id}>{captain.name}</option> : null}
      {candidates.map(item => {
        const other = leading(item.id);
        return (
          <option key={item.id} value={item.id}>
            {item.name}{other ? ` (leads ${other.name})` : ''}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Without a captain, a squad costs no extra row: a small printed control
 * ends the Stamina line, and the native picker opens from it. "Captain" is
 * spelled out only where the slip has room, like "+ Condition".
 */
function CaptainAdd({ squad, monster }: { squad: CombatInstance; monster: Monster }) {
  return (
    <span class="captain-add" title={`Attach a captain. With Captain: ${monster.withCaptain}`}>
      <CaptainIcon />
      <span class="captain-add-label">Captain</span>
      <CaptainSelect squad={squad} class="captain-add-select" />
    </span>
  );
}

/**
 * A led squad's captain line: who leads it (the select also lets go), and
 * the "With Captain" benefit it now has.
 */
function SquadCaptain({ squad, monster }: { squad: CombatInstance; monster: Monster }) {
  return (
    <div class="squad-captain">
      <CaptainSelect squad={squad} class="squad-captain-select" />
      <p class="squad-captain-benefit">
        <strong>With Captain</strong> {monster.withCaptain}
      </p>
    </div>
  );
}

function InstanceCard({ instance, monster }: { instance: CombatInstance; monster: Monster }) {
  const group = activeEncounter().groups.find(item => item.id === instance.groupId);
  const [preview, setPreview] = useState<number | null>(null);
  const shownStamina = preview ?? instance.currentStamina;
  const squad = instance.kind === 'minion-squad';
  const perMinion = squad ? minionStamina(instance, monster) : 0;
  const remaining = squad && perMinion > 0 ? standing(shownStamina, perMinion) : null;
  const leads = squad
    ? null
    : activeEncounter().combat.instances.find(item => item.captainId === instance.id)?.name ?? null;
  const summoned = instance.summonedBy === undefined
    ? null
    : activeEncounter().combat.instances.find(item => item.id === instance.summonedBy)?.name ?? '';
  const commitStamina = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    applyStaminaCommand(instance.id, input.value);
  };
  const health = staminaState(instance.currentStamina, instance.maxStamina, squad);
  return (
    <article
      class={`instance-card ${hasActed(instance) ? 'acted' : ''}`}
      data-health={health}
      data-group={group ? activeEncounter().groups.indexOf(group) % 6 : undefined}
    >
      <div class="instance-topline">
        <TurnBoxes instance={instance} />
        <input
          class="instance-name"
          value={instance.name}
          aria-label="Creature name"
          onChange={event => renameInstance(instance.id, event.currentTarget.value)}
        />
        <ConditionAdd instanceId={instance.id} name={instance.name} />
        <select
          class="instance-group"
          aria-label="Activation group"
          title="Activation group"
          value={instance.groupId}
          onChange={event => setInstanceGroup(instance.id, event.currentTarget.value)}
        >
          {activeEncounter().groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button class="icon-button" title="Remove creature" aria-label={`Remove ${instance.name}`} onClick={() => removeInstance(instance.id)}>
          <CloseIcon />
        </button>
      </div>
      <ConditionRow instanceId={instance.id} conditions={instance.conditions} winded={health === 'winded'} leads={leads} summoned={summoned} />
      <div class="stamina-row">
        <StaminaTrack
          id={instance.id}
          name={instance.name}
          current={instance.currentStamina}
          max={instance.maxStamina}
          perMinion={squad ? perMinion : null} onPreview={setPreview} />
        <label class="stamina-field">
          <input
            class={`stamina-command ${preview !== null ? 'previewing' : ''}`}
            value={fmt(shownStamina)}
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
        {remaining !== null ? <strong class="minion-count" title="Minions standing">{remaining}/{instance.count}</strong> : null}
        {squad && monster.withCaptain && !instance.captainId ? <CaptainAdd squad={instance} monster={monster} /> : null}
      </div>
      {squad && monster.withCaptain && instance.captainId ? <SquadCaptain squad={instance} monster={monster} /> : null}
      {group ? <span class="group-corner">{group.name}</span> : null}
      {health === 'down' ? <PenCross seed={instance.id} /> : null}
    </article>
  );
}

export function GroupFilterBar() {
  const combat = activeEncounter().combat;
  if (activeEncounter().groups.length < 2) return null;
  return (
    <div class="group-filter-bar">
      <span class="group-filter-label">Groups</span>
      <div class="combat-group-rail">
        {activeEncounter().groups.map(group => {
          const members = combat.instances.filter(instance => instance.groupId === group.id);
          const acted = members.reduce((sum, instance) => sum + instance.turnsTaken, 0);
          const turns = members.reduce((sum, instance) => sum + instance.turns, 0);
          const active = combat.activeGroupFilter === group.id;
          const complete = turns > 0 && acted === turns;
          return (
            <button
              key={group.id}
              class={`combat-group-button ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}
              data-group={activeEncounter().groups.indexOf(group) % 6}
              aria-pressed={active}
              onClick={() => setGroupFilter(active ? null : group.id)}
            >
              <strong>{group.name}</strong><span>{acted}/{turns}</span>
              {complete ? <PenTick seed={`${group.id}:done`} /> : null}
            </button>
          );
        })}
      </div>
      <button class={`secondary compact-button ${!combat.activeGroupFilter ? 'active' : ''}`} onClick={() => setGroupFilter(null)}>All</button>
    </div>
  );
}

/** Gap between statblocks while one slides over the other, matching the
    page gutter. */
const PAGE_GAP = 14;
/** Travel before a touch is read as a swipe rather than a tap or a wobble. */
const SWIPE_SLOP = 8;
/** Where a release is headed decides the page: its position plus this much
    of its speed, past this share of the board, turns it. A flick turns the
    page from a short drag; a slow drag has to go most of the way. */
const CARRY_MS = 240;
const TURN_SHARE = 0.28;
/** A swipe past the first or last statblock gives only this much. */
const EDGE_GIVE = 0.22;
/** The page glides to rest on this curve. Its opening slope is 1/0.25, so a
    turn starts at the speed the finger left it at (see `glideMs`). */
const GLIDE = 'cubic-bezier(0.25, 1, 0.5, 1)';
const GLIDE_SLOPE = 4;
const GLIDE_MIN = 170;
const GLIDE_MAX = 340;

/** Presses that already own a sideways drag of their own. */
const OWN_GESTURE = 'input, textarea, select, [contenteditable]';

/** How long a page takes to travel `distance` px when let go at `speed`
    px/ms: matched to the finger when flung, a calm glide otherwise. */
function glideMs(distance: number, speed: number) {
  const calm = Math.min(GLIDE_MAX, GLIDE_MIN + distance * 0.35);
  if (speed < 0.2) return calm;
  return Math.max(GLIDE_MIN, Math.min(calm, (GLIDE_SLOPE * distance) / speed));
}

/** Current sideways offset of a lane, mid-glide included. */
function offsetOf(lane: HTMLElement | undefined) {
  if (!lane) return 0;
  const transform = getComputedStyle(lane).transform;
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m41 : 0;
}

/**
 * On a phone the board is a book of statblocks, one page at a time: exactly
 * one is ever on the page, and a sideways swipe turns to the next. The page
 * coming in slides in level with the top of the screen, head first, so the
 * Director lands on its name however far down the last one they had read;
 * once it has landed the page quietly re-seats under it, so nothing moves on
 * screen. A page still gliding can be caught and flicked on, so flicking
 * through a whole board never waits on an animation. The browser keeps the
 * page's vertical scroll to itself throughout.
 *
 * The page in view is marked on the DOM directly rather than rendered, so a
 * turn never re-renders the statblocks.
 */
function usePager(board: { current: HTMLDivElement | null }, count: number, key: string) {
  const at = useRef(0);
  const count$ = useRef(count);
  count$.current = count;
  /** The turn in flight: where it is going, and how to finish it now. */
  const flight = useRef<{ target: number; finish: () => void } | null>(null);
  const springTimer = useRef(0);

  const lanes = () => Array.from(board.current?.children ?? []) as HTMLElement[];
  const span = () => (board.current?.clientWidth ?? 0) + PAGE_GAP;

  const markCurrent = () => {
    lanes().forEach((lane, index) => lane.toggleAttribute('data-current', index === at.current));
  };
  const clearSlide = () => {
    clearTimeout(springTimer.current);
    for (const lane of lanes()) {
      lane.removeAttribute('data-peek');
      lane.style.transform = '';
      lane.style.transition = '';
    }
    board.current?.style.removeProperty('--peek-top');
  };
  /** Where the incoming page starts: level with the top of the visible
      board, below the pinned head. */
  const peekTop = () => {
    const el = board.current;
    return el ? Math.max(0, Math.round(chromeOffset() - el.getBoundingClientRect().top)) : 0;
  };
  const holdPeek = () => {
    const el = board.current;
    if (el && !el.style.getPropertyValue('--peek-top')) el.style.setProperty('--peek-top', `${peekTop()}px`);
  };

  // New lanes arrive unmarked, and a shorter roster may have lost the page.
  useLayoutEffect(() => {
    if (at.current >= count && count) at.current = count - 1;
    markCurrent();
  });
  // A new pick or a new roster starts from the first statblock.
  useLayoutEffect(() => {
    flight.current = null;
    at.current = 0;
    clearSlide();
    markCurrent();
  }, [key]);

  /** Lay the page in view `dx` px along, with `target` beside it. */
  const place = (target: number, dx: number, ms: number) => {
    const all = lanes();
    const current = all[at.current];
    const incoming = target !== at.current ? all[target] : undefined;
    const dir = Math.sign(target - at.current);
    const width = span();
    const transition = ms ? `transform ${ms}ms ${GLIDE}` : '';
    for (const lane of all) {
      if (lane !== incoming && lane.hasAttribute('data-peek')) {
        lane.removeAttribute('data-peek');
        lane.style.transform = '';
        lane.style.transition = '';
      }
    }
    if (current) {
      current.style.transition = transition;
      current.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
    }
    if (incoming) {
      incoming.setAttribute('data-peek', '');
      incoming.style.transition = transition;
      incoming.style.transform = `translate3d(${dir * width + dx}px, 0, 0)`;
    }
  };

  /** The incoming page has arrived: it becomes the page, and the page
      re-seats under it before the browser paints, so nothing moves. */
  const land = (target: number) => {
    const el = board.current;
    if (!el) return;
    // Only when the board was read past its top; otherwise the page stays.
    // Measured before the swap, which may shorten the page.
    const top = parseFloat(el.style.getPropertyValue('--peek-top')) || 0;
    const to = top ? window.scrollY + el.getBoundingClientRect().top - chromeOffset() : null;
    flight.current = null;
    at.current = target;
    clearSlide();
    markCurrent();
    if (to !== null) {
      holdChrome();
      window.scrollTo({ top: to, behavior: 'instant' });
    }
  };

  /** Glide the rest of the way to `target`, from the page `dx` px along. */
  const turnTo = (target: number, dx = 0, speed = 0) => {
    const el = board.current;
    if (!el || target < 0 || target >= count$.current) return;
    flight.current?.finish();
    if (target === at.current) return;
    holdPeek();
    const dir = Math.sign(target - at.current);
    const width = span();
    if (prefersReducedMotion()) return land(target);
    place(target, dx, 0);
    // Commit the start before gliding from it.
    void el.offsetWidth;
    const ms = glideMs(width - Math.abs(dx), speed);
    place(target, -dir * width, ms);
    let done = false;
    const timer = window.setTimeout(() => finish(), ms);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      land(target);
    };
    flight.current = { target, finish };
  };

  /** Settle back onto the page in view. */
  const springBack = (target: number, dx: number, speed: number) => {
    const ms = prefersReducedMotion() ? 0 : glideMs(Math.abs(dx), speed);
    if (!ms) return clearSlide();
    place(target, 0, ms);
    springTimer.current = window.setTimeout(clearSlide, ms);
  };

  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const phone = matchMedia(PHONE);
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let start = 0;
    let owned = false;
    let caught = false;
    let travel = 0;
    let dx = 0;
    let target = -1;
    let samples: Array<[number, number]> = [];

    const reset = () => {
      id = -1;
      owned = false;
      caught = false;
      travel = 0;
      samples = [];
    };
    /** Follow the finger `mx` px from where the page sat. */
    const follow = (mx: number) => {
      const want = at.current + (mx < 0 ? 1 : -1);
      const exists = want >= 0 && want < count$.current;
      target = exists ? want : -1;
      dx = exists ? mx : mx * EDGE_GIVE;
      place(exists ? want : at.current, dx, 0);
    };

    const onDown = (event: PointerEvent) => {
      if (!phone.matches || event.pointerType === 'mouse' || id !== -1 || count$.current < 2) return;
      const moving = !!flight.current || !!lanes()[at.current]?.style.transform;
      // A moving page is caught wherever the finger lands, even on a slider.
      if (!moving && ((event.target as Element).closest(OWN_GESTURE) || heldTouches.has(event.pointerId))) return;
      id = event.pointerId;
      x0 = event.clientX;
      y0 = event.clientY;
      start = 0;
      // A page still gliding is caught where it is: it lands at once and
      // stays under the finger, ready to be flicked on.
      const gliding = flight.current;
      const all = lanes();
      if (gliding) {
        start = offsetOf(all[gliding.target]);
        gliding.finish();
      } else if (all[at.current]?.style.transform) {
        start = offsetOf(all[at.current]);
        clearTimeout(springTimer.current);
      }
      if (start) {
        caught = true;
        owned = true;
        el.style.removeProperty('--peek-top');
        holdPeek();
        follow(start);
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== id) return;
      const mx = event.clientX - x0;
      const my = event.clientY - y0;
      travel = Math.max(travel, Math.abs(mx));
      if (!owned) {
        // A Stamina track took this finger after it rested: its drag, not a turn.
        if (heldTouches.has(id)) return reset();
        if (Math.abs(mx) < SWIPE_SLOP && Math.abs(my) < SWIPE_SLOP) return;
        // A mostly vertical move is the page's to scroll.
        if (Math.abs(my) >= Math.abs(mx)) return reset();
        owned = true;
        // Start from here, so the page does not leap the slop.
        x0 = event.clientX;
        holdPeek();
      }
      if (!el.hasPointerCapture(id)) el.setPointerCapture(id);
      samples.push([event.timeStamp, event.clientX]);
      if (samples.length > 6) samples.shift();
      follow(start + event.clientX - x0);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== id) return;
      if (!owned) return reset();
      // A swipe is not a tap: keep it from pressing whatever it ended on.
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);

      // Speed over the last few moves, ignoring a finger that stopped first.
      const recent = samples.filter(([t]) => event.timeStamp - t < 100);
      const [t0, sx] = recent[0] ?? [event.timeStamp, event.clientX];
      const speed = recent.length > 1 ? (event.clientX - sx) / Math.max(1, event.timeStamp - t0) : 0;
      const width = span();
      const headed = dx + speed * CARRY_MS;
      // A caught page let go without a swipe simply comes to rest.
      const still = caught && travel < SWIPE_SLOP;
      const turn = event.type === 'pointerup' && !still && target !== -1 && Math.sign(headed) === Math.sign(dx) && Math.abs(headed) > width * TURN_SHARE;
      if (turn) turnTo(target, dx, Math.abs(speed));
      else springBack(target === -1 ? at.current : target, dx, Math.abs(speed));
      reset();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    // The board element comes and goes with the empty state.
  }, [key, count > 0]);

  return turnTo;
}

/** Presses that belong to a control rather than to the page under it. */
const CONTROL = [
  'a, button, input, textarea, select, label, summary, [contenteditable], [draggable="true"]',
  '[role="slider"], [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], [role="menuitem"]',
  '[tabindex]:not([tabindex="-1"]), [data-rule-preview], [data-hint]'
].join(', ');
/** Travel before a press on the page is read as a grab rather than a click. */
const GRAB_SLOP = 5;
/** How long a turn in flight stays the place the next one counts from. */
const GOAL_MS = 450;

/** Whether the point sits on a printed glyph, so a press there selects
    text rather than grabbing the board. */
function onText(x: number, y: number) {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | undefined;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const at = doc.caretPositionFromPoint(x, y);
    node = at?.offsetNode;
    offset = at?.offset ?? 0;
  } else {
    const at = document.caretRangeFromPoint?.(x, y);
    node = at?.startContainer;
    offset = at?.startOffset ?? 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const length = node.textContent?.length ?? 0;
  const range = document.createRange();
  // The caret falls between two characters: the point is on text if it is
  // inside either of them.
  for (const index of [offset - 1, offset]) {
    if (index < 0 || index >= length) continue;
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    for (const box of range.getClientRects()) {
      if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) return true;
    }
  }
  return false;
}

/**
 * On a desk the board is a table of pages laid side by side, and the wheel
 * keeps reading the statblock under the pointer. A press on blank page,
 * anywhere off text and controls, takes hold of the board and slides it like
 * paper, settling on the nearest statblock when let go. The arrow keys turn
 * it a statblock at a time.
 *
 * Returns `step`, which turns the board one statblock either way.
 */
function useDeskPan(board: { current: HTMLDivElement | null }, count: number) {
  const count$ = useRef(count);
  count$.current = count;
  const goal = useRef<{ left: number; until: number } | null>(null);

  const width = (el: HTMLElement) => (count$.current ? el.scrollWidth / count$.current : 0);
  const glide = (el: HTMLElement, left: number) => {
    goal.current = { left, until: performance.now() + GOAL_MS };
    el.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  const step = (dir: number) => {
    const el = board.current;
    const w = el ? width(el) : 0;
    if (!el || !w) return;
    // Counted from where the last turn is headed, so quick presses add up.
    const from = goal.current && performance.now() < goal.current.until ? goal.current.left : el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    glide(el, Math.max(0, Math.min(max, (Math.round(from / w) + dir) * w)));
  };

  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const phone = matchMedia(PHONE);
    const wide = () => !phone.matches && el.scrollWidth > el.clientWidth + 1;

    /** A press here would grab the board: blank page, off any control, any
        scrollbar and any printed text. */
    const grabbable = (target: EventTarget | null, x: number, y: number) => {
      if (!(target instanceof Element) || target.closest(CONTROL)) return false;
      const box = el.getBoundingClientRect();
      if (y >= box.top + el.clientHeight) return false;
      const lane = target.closest<HTMLElement>('.monster-lane');
      if (lane && x >= lane.getBoundingClientRect().left + lane.clientLeft + lane.clientWidth) return false;
      return !onText(x, y);
    };

    // The hand shows over blank page, so the grab can be found.
    let hover = 0;
    let lastMove: PointerEvent | null = null;
    const onHover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      lastMove = event;
      hover ||= requestAnimationFrame(() => {
        hover = 0;
        const move = lastMove;
        if (move) el.classList.toggle('grab-ready', wide() && grabbable(move.target, move.clientX, move.clientY));
      });
    };
    const onLeave = () => el.classList.remove('grab-ready');

    let id = -1;
    let x0 = 0;
    let left0 = 0;
    let owned = false;
    let samples: Array<[number, number]> = [];
    let snapTimer = 0;
    const restoreSnap = () => {
      clearTimeout(snapTimer);
      el.style.scrollSnapType = '';
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || id !== -1 || !wide()) return;
      if (!grabbable(event.target, event.clientX, event.clientY)) return;
      id = event.pointerId;
      x0 = event.clientX;
      left0 = el.scrollLeft;
      owned = false;
      samples = [];
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== id) return;
      const dx = event.clientX - x0;
      if (!owned) {
        if (Math.abs(dx) < GRAB_SLOP) return;
        owned = true;
        x0 = event.clientX;
        // Snapping would fight the hand; the release settles it instead.
        restoreSnap();
        el.style.scrollSnapType = 'none';
        el.setPointerCapture(id);
        document.documentElement.classList.add('board-grabbing');
        getSelection()?.removeAllRanges();
        goal.current = null;
      }
      samples.push([event.timeStamp, event.clientX]);
      if (samples.length > 6) samples.shift();
      el.scrollLeft = left0 - (event.clientX - x0);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== id) return;
      id = -1;
      if (!owned) return;
      owned = false;
      document.documentElement.classList.remove('board-grabbing');
      // A grab is not a click: keep it from pressing whatever it ended on.
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      // Let go moving, it carries on a little way, then settles on the
      // statblock nearest where it was headed.
      const recent = samples.filter(([t]) => event.timeStamp - t < 100);
      const [t0, sx] = recent[0] ?? [event.timeStamp, event.clientX];
      const speed = recent.length > 1 ? (event.clientX - sx) / Math.max(1, event.timeStamp - t0) : 0;
      const w = width(el);
      const max = el.scrollWidth - el.clientWidth;
      const headed = el.scrollLeft - speed * CARRY_MS;
      glide(el, w ? Math.max(0, Math.min(max, Math.round(headed / w) * w)) : el.scrollLeft);
      el.addEventListener('scrollend', restoreSnap, { once: true });
      snapTimer = window.setTimeout(restoreSnap, 700);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!wide() || !el.getClientRects().length) return;
      const focus = document.activeElement;
      if (focus?.closest('input, textarea, select, [contenteditable], [role="slider"], [role="tablist"], [role="radiogroup"], [role="menu"], [role="listbox"]')) return;
      // An open drawer keeps its arrows.
      if (document.querySelector('.preview-drawer.open, .mobile-nav.open')) return;
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };

    el.addEventListener('pointermove', onHover);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(hover);
      restoreSnap();
      document.documentElement.classList.remove('board-grabbing');
      el.removeEventListener('pointermove', onHover);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // The board element comes and goes with the empty state.
  }, [count > 0]);

  return step;
}

/** Page edges drawn for the statblocks off the board on one side; more
    than this reads as a stack all the same. A narrow margin holds fewer. */
const EDGE_PAGES = 3;
const EDGE_PAGES_NARROW = 2;
const NARROW_MARGIN = '(max-width: 900px)';
/** One page edge's step out from the last, and how much shorter it stands. */
const PAGE_STEP = 4;
const PAGE_INSET = 9;
/** Scroll within this share of a statblock counts as resting on it. */
const PAGE_REST = 0.004;

/**
 * Lays the page edges for `h` statblocks' worth of board off one side, `h`
 * fractional mid-scroll. Each hairline is the edge of a real statblock: the
 * one sliding off comes out of the board's side and settles onto the stack,
 * and the one sliding back travels in and merges with the board as it
 * arrives, the stack behind it closing up a step at a time.
 */
function layPages(lines: HTMLElement[], h: number, cap: number, dir: 1 | -1) {
  const near = Math.round(h);
  if (Math.abs(h - near) < PAGE_REST) h = near;
  const edges = h > 0 ? Math.ceil(h) : 0;
  // How far the nearest edge has come out from the board: (0, 1].
  const out = h - edges + 1;
  lines.forEach((line, index) => {
    // Slot 0 is the first page of the stack; -1 is the board's own side.
    const slot = index + out - 1;
    const depth = Math.max(0, slot);
    const fade = Math.min(1, Math.max(0, 1 + slot)) * Math.min(1, Math.max(0, cap - slot));
    line.style.opacity = index < edges ? String(fade * (1 - Math.min(depth, cap - 1) * 0.18)) : '0';
    line.style.translate = `${dir * slot * PAGE_STEP}px 0`;
    line.style.top = line.style.bottom = `${depth * PAGE_INSET}px`;
  });
}

function BoardEdges({ board, names, step }: { board: { current: HTMLDivElement | null }; names: string[]; step: (dir: number) => void }) {
  const [[before, after], setHidden] = useState<[number, number]>([0, 0]);
  const count = names.length;
  const pages = { prev: useRef<HTMLSpanElement>(null), next: useRef<HTMLSpanElement>(null) };
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const narrow = matchMedia(NARROW_MARGIN);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const w = count ? el.scrollWidth / count : 0;
      const left = el.scrollLeft;
      // The edges follow the board every frame; the count and the name
      // change only as a whole statblock goes or comes.
      const cap = narrow.matches ? EDGE_PAGES_NARROW : EDGE_PAGES;
      const lines = (side: { current: HTMLSpanElement | null }) => Array.from(side.current?.children ?? []) as HTMLElement[];
      layPages(lines(pages.prev), w ? left / w : 0, cap, -1);
      layPages(lines(pages.next), w ? (el.scrollWidth - el.clientWidth - left) / w : 0, cap, 1);
      if (!w) return setHidden([0, 0]);
      const next: [number, number] = [
        Math.max(0, Math.ceil((left - 2) / w)),
        Math.max(0, count - Math.floor((left + el.clientWidth + 2) / w))
      ];
      setHidden(now => (now[0] === next[0] && now[1] === next[1] ? now : next));
    };
    const queue = () => {
      frame ||= requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', queue, { passive: true });
    const resize = new ResizeObserver(queue);
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', queue);
      resize.disconnect();
    };
  }, [count]);

  const tab = (dir: -1 | 1, hidden: number, name: string | undefined) => (
    <button
      class={`board-edge ${dir < 0 ? 'prev' : 'next'}`}
      data-shown={hidden ? '' : undefined}
      tabIndex={hidden ? 0 : -1}
      aria-hidden={hidden ? undefined : 'true'}
      aria-label={hidden ? `Turn to ${name}, ${hidden} ${hidden > 1 ? 'statblocks' : 'statblock'} ${dir < 0 ? 'before' : 'after'}` : undefined}
      onClick={() => step(dir)}
    >
      <span class="board-edge-pages" ref={dir < 0 ? pages.prev : pages.next} aria-hidden="true">
        {/* One spare, for the edge on its way in or out. */}
        {Array.from({ length: EDGE_PAGES + 1 }, (_, page) => (
          <i key={page} />
        ))}
      </span>
      <span class="board-edge-index" aria-hidden="true">
        <CaretIcon />
        <b>{hidden || ''}</b>
        <span class="board-edge-name">{hidden ? name : ''}</span>
      </span>
    </button>
  );
  return (
    <>
      {tab(-1, before, names[before - 1])}
      {tab(1, after, names[count - after])}
    </>
  );
}

/** A click on a lane's pinned name band takes that lane back to its top,
    where its Stamina, slips and stats are. On the phone page the page itself
    scrolls, so the band brings the board up under the running head. */
function backToTop(event: MouseEvent) {
  if (!(event.target as Element).closest('.lane-band')) return;
  const lane = event.currentTarget as HTMLElement;
  if (matchMedia(PHONE).matches) {
    if (lane.parentElement) alignTop(lane.parentElement);
    return;
  }
  lane.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Marks a lane scrolled away from its top, so the band offers the way back. */
function markScrolled(event: Event) {
  const lane = event.currentTarget as HTMLElement;
  lane.classList.toggle('lane-scrolled', lane.scrollTop > 0);
}

/** Bring the board's top edge up under the pinned chrome, if the page has
    scrolled past it. */
function alignTop(board: HTMLElement) {
  if (!matchMedia(PHONE).matches) return;
  const gap = board.getBoundingClientRect().top - chromeOffset();
  if (gap >= -1) return;
  holdChrome();
  window.scrollBy({ top: gap, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function CombatBoard() {
  void monstersVersion.value; // subscribe: lanes render once statblocks are cached
  const encounter = activeEncounter();
  const combat = encounter.combat;
  const filter = combat.activeGroupFilter;
  // A picked group is a plain filter: only its statblocks, and in them only
  // its creatures, in their usual order. Nothing moves but what is hidden.
  const lanes = groupInstancesByMonster()
    .map(([path, instances]) => {
      const shown = filter ? instances.filter(instance => instance.groupId === filter) : instances;
      return { path, instances, shown, hidden: instances.length - shown.length };
    })
    .filter(lane => lane.shown.length);
  const board = useRef<HTMLDivElement>(null);
  const turnTo = usePager(board, lanes.length, filter ?? '');
  const step = useDeskPan(board, lanes.length);
  // A new pick starts the board from its first statblock.
  useEffect(() => {
    board.current?.scrollTo({ left: 0 });
  }, [filter]);
  if (!combat.instances.length) {
    return <div class="combat-board" id="combatBoard"><div class="combat-empty panel">Build an encounter in Prep.</div></div>;
  }
  if (!lanes.length) {
    const name = encounter.groups.find(group => group.id === filter)?.name ?? '';
    return (
      <div class="combat-board" id="combatBoard">
        <div class="combat-empty panel">
          No creatures in group {name}. <button class="secondary compact-button" onClick={() => setGroupFilter(null)}>Show all</button>
        </div>
      </div>
    );
  }
  return (
    <div class="board-frame">
      <div class="combat-board" id="combatBoard" ref={board}>
        {lanes.map(({ path, instances, shown, hidden }, index) => {
          const monster = monsterCache.get(path);
          if (!monster) {
            return <section class="monster-lane panel" key={path}><div class="lane-loading">Loading statblock…</div></section>;
          }
          return (
            <section class="monster-lane panel" key={path} data-path={path} onClick={backToTop} onScroll={markScrolled}>
              <LaneHeader monster={monster} nav={{ index, count: lanes.length, turnTo }} />
              <div class="instance-stack">
                {shown.map(instance => <InstanceCard key={instance.id} instance={instance} monster={monster} />)}
                {hidden ? <p class="lane-hidden-note">+{hidden} in other groups</p> : null}
              </div>
              <StatblockBody
                monster={monster}
                interactive={true}
                addon={(_feature, featureIndex) => abilityMarks(monster, instances, featureIndex)}
                summons={featureIndex => abilitySummons(monster, instances, featureIndex)}
              />
            </section>
          );
        })}
      </div>
      <BoardEdges board={board} names={lanes.map(lane => monsterCache.get(lane.path)?.name ?? 'the next statblock')} step={step} />
    </div>
  );
}
