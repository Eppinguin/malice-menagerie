import { monsterCache, monstersVersion } from '../../data.ts';
import { indexFeatures, reactionsPerRound, type IndexedFeature } from '../../lib/actions.ts';
import { isDazed } from '../../lib/conditions.ts';
import { richText } from '../../lib/text.ts';
import { PHONE, chromeOffset, holdChrome, prefersReducedMotion } from '../../lib/phoneScroll.ts';
import {
  activeEncounter,
  groupInstancesByMonster,
  state,
  takeBackReaction,
  toggleVillainAction,
  cycleReaction,
  toggleWatch,
  villainActionThisRound,
} from '../../store.ts';
import type { CombatInstance, Monster } from '../../types.ts';
import { Fragment } from 'preact';
import { CaretIcon } from '../Icons.tsx';
import { PenTick } from '../Pen.tsx';
import { useRef } from 'preact/hooks';

/** How long a press must rest on a box to take a use back. */
const HOLD_MS = 450;

/* The table's second memory. A statblock prints everything a creature can
   do; these pieces pull out what happens on someone else's turn (triggered
   actions and villain actions), so nothing that fires between turns is left
   buried in a column. */

const alive = (instances: CombatInstance[]) => instances.filter(instance => instance.currentStamina > 0);
/** Tracked triggered actions: a free triggered action never counts against the round's limit. */
const tracked = (item: IndexedFeature) => item.slot === 'trigger' && !item.free;
/** A creature with no triggered action left this round: used up, or Dazed. */
const reacted = (instance: CombatInstance, capacity: number) =>
  instance.reactions.length >= capacity || isDazed(instance);
const usesOf = (instance: CombatInstance, name: string) => instance.reactions.filter(used => used.name === name).length;

/** Bring an ability into view in its column and wash it with the highlighter,
    so the eye lands on it. */
export function jumpToFeature(path: string, index: number) {
  const lane = document.querySelector<HTMLElement>(`.monster-lane[data-path="${CSS.escape(path)}"]`);
  const target = lane?.querySelector<HTMLElement>(`[data-feature="${index}"]`);
  const board = lane?.parentElement;
  if (!lane || !target || !board) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  const phone = matchMedia(PHONE).matches;
  const flash = () => {
    target.classList.remove('feature-flash');
    void target.offsetWidth;
    target.classList.add('feature-flash');
    target.addEventListener('animationend', () => target.classList.remove('feature-flash'), { once: true });
  };
  if (!phone) {
    // Bring the lane on to the board, then the ability up its own column.
    const laneLeft = lane.offsetLeft - board.offsetLeft;
    if (laneLeft < board.scrollLeft || laneLeft + lane.offsetWidth > board.scrollLeft + board.clientWidth + 1)
      board.scrollTo({ left: laneLeft, behavior });
    // The lane scrolls as a whole under its pinned name band.
    const scroller = [lane.querySelector<HTMLElement>('.statblock-body'), lane].find(
      el => el && el.scrollHeight > el.clientHeight + 1,
    );
    if (scroller) {
      const band = lane.querySelector<HTMLElement>('.lane-band');
      const pinned = scroller === lane && band ? band.offsetHeight : 0;
      const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: top - pinned - 8, behavior });
    }
    flash();
    return;
  }
  // On a phone the board swipes one statblock at a time and the page scrolls
  // as a whole: turn to the lane first, then read down to the ability once the
  // swipe has landed.
  const down = () => {
    holdChrome();
    // Clear of the running head and the lane's own pinned name band.
    const band = lane.querySelector<HTMLElement>('.lane-band')?.offsetHeight ?? 0;
    const top = target.getBoundingClientRect().top + window.scrollY - chromeOffset() - band - 8;
    window.scrollTo({ top, behavior });
    flash();
  };
  if (Math.abs(board.scrollLeft - (lane.offsetLeft - board.offsetLeft)) > 4) {
    board.scrollTo({ left: lane.offsetLeft - board.offsetLeft, behavior: 'auto' });
    window.setTimeout(down, 220);
  } else down();
}

function MaliceCost({ value, short }: { value: number; short?: boolean }) {
  return (
    <span class={`watch-cost ${short ? 'short' : ''}`} title={`${value} Malice`}>
      {value}
      <span class="ds-glyph" aria-hidden="true">d</span>
      <span class="sr-only"> Malice</span>
    </span>
  );
}

/** A printed box the Director ticks. With several creatures, or for a
    numbered villain action, the box carries its number until it is ticked. */
function MarkBox({
  on,
  spent,
  label,
  ordinal,
  count,
  seed,
  title,
  onClick,
  onUndo,
}: {
  on: boolean;
  spent?: boolean;
  label: string;
  /** Keeps the tick's hand-drawn shape when the label changes; the label by default. */
  seed?: string | undefined;
  ordinal?: number | undefined;
  /** Uses so far: past one, the Director's pen writes the number on the
      box's corner beside the tick. */
  count?: number | undefined;
  title: string;
  onClick: () => void;
  /** Press and hold (mouse, touch or pen) or right-click: take one back. */
  onUndo?: (() => void) | undefined;
}) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const release = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  const undo = () => {
    onUndo?.();
    navigator.vibrate?.(12);
  };
  return (
    <button
      class={`acted-toggle mark-box ${spent ? 'spent' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={title}
      onPointerDown={
        onUndo
          ? event => {
              if (event.button !== 0) return;
              const press = { timer: 0, x: event.clientX, y: event.clientY, fired: false };
              press.timer = window.setTimeout(() => {
                press.fired = true;
                undo();
              }, HOLD_MS);
              hold.current = press;
            }
          : undefined
      }
      onPointerMove={event => {
        const press = hold.current;
        // A drag (scrolling the strip) is not a hold.
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) release();
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onClick={() => {
        // The click that ends a hold has already done its work.
        if (hold.current?.fired) {
          hold.current = null;
          return;
        }
        onClick();
      }}
      onContextMenu={
        onUndo
          ? event => {
              event.preventDefault();
              // A touch hold also raises the context menu; it has already undone.
              if (hold.current?.fired) return;
              release();
              undo();
            }
          : undefined
      }
    >
      {on ? <PenTick seed={seed ?? label} /> : ordinal ? <span class="mark-ordinal">{ordinal}</span> : null}
      {on && count && count > 1 ? (
        <span class="mark-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** One box per living creature that could use this triggered action, ticked
    like every other box. A creature allowed several a round (Ajax) taps it
    again for each further use, and the count is pen-written on the box's
    corner; once it has none left the next tap clears this one back to empty.
    Press and hold (or right-click) takes back a single use. */
function ReactionMarks({
  item,
  lane,
  capacity,
}: {
  item: IndexedFeature;
  lane: CombatInstance[];
  capacity: number;
}) {
  const many = lane.length > 1;
  return (
    <span class="mark-boxes">
      {alive(lane).map(instance => {
        const uses = usesOf(instance, item.name);
        const full = reacted(instance, capacity);
        const dazed = isDazed(instance);
        const ordinal = many ? lane.indexOf(instance) + 1 : undefined;
        const cost = item.malice ? ` · ${item.malice} Malice` : '';
        return (
          <MarkBox
            key={instance.id}
            on={uses > 0}
            spent={uses === 0 && full}
            ordinal={ordinal}
            count={uses}
            seed={`${instance.id}:${item.name}`}
            label={`${instance.name}: ${item.name}${capacity > 1 ? `, used ${uses} of ${capacity}` : ''}`}
            title={
              dazed && !uses
                ? `${instance.name} is Dazed and can't use triggered actions`
                : capacity === 1
                ? uses
                  ? `Take back ${item.name}`
                  : full
                    ? `${instance.name} has used its triggered action; tap to swap to ${item.name}`
                    : `${instance.name} uses ${item.name}${cost}`
                : full
                  ? uses
                    ? `Used ${uses}× · tap to clear · hold to take back one`
                    : `${instance.name} has no triggered action left this round`
                  : uses
                    ? `Used ${uses}× · tap to use again${cost} · hold to take back one`
                    : `${instance.name} uses ${item.name}${cost}`
            }
            onClick={() => cycleReaction(instance.id, item.name, item.malice, capacity)}
            onUndo={uses ? () => takeBackReaction(instance.id, item.name) : undefined}
          />
        );
      })}
    </span>
  );
}

function VillainMarks({ item, lane }: { item: IndexedFeature; lane: CombatInstance[] }) {
  const n = item.villain ?? 1;
  const many = lane.length > 1;
  const now = villainActionThisRound();
  return (
    <span class="mark-boxes">
      {alive(lane).map(instance => {
        const usedIn = instance.villainRounds[n - 1] ?? 0;
        return (
          <MarkBox
            key={instance.id}
            on={usedIn > 0}
            spent={!usedIn && !!now}
            ordinal={many ? lane.indexOf(instance) + 1 : undefined}
            label={`${instance.name}: villain action ${n}, ${item.name}`}
            title={
              usedIn
                ? `Used in round ${usedIn} · tap to take back`
                : now
                  ? `${now.name} already used this round's villain action`
                  : `Mark ${item.name} used`
            }
            onClick={() => toggleVillainAction(instance.id, n)}
          />
        );
      })}
    </span>
  );
}

/**
 * Beside a triggered or villain action's printed type in the statblock: whose
 * is used. `spent` sets the ability back once no creature in the lane can use
 * it (a villain action already used, or no triggered action left this round).
 * `undefined` for every other ability, so its own Spend button stays.
 */
export function abilityMarks(monster: Monster, lane: CombatInstance[], featureIndex: number) {
  const item = indexFeatures(monster)[featureIndex];
  if (!item || !(tracked(item) || item.villain)) return undefined;
  const living = alive(lane);
  if (!living.length) return null;
  if (item.villain) {
    const n = item.villain;
    return {
      marks: <VillainMarks item={item} lane={lane} />,
      spent: living.every(instance => (instance.villainRounds[n - 1] ?? 0) > 0),
    };
  }
  const capacity = reactionsPerRound(monster);
  return {
    marks: <ReactionMarks item={item} lane={lane} capacity={capacity} />,
    spent: living.every(instance => reacted(instance, capacity)),
  };
}

/** The villain actions in the fight, as numbered boxes on the strip's own
    line: one per round across the whole encounter, each once. */
function VillainTrack() {
  void monstersVersion.value; // its own subscription: signals skip a child whose props didn't change
  const rows: { path: string; instance: CombatInstance; items: IndexedFeature[] }[] = [];
  for (const [path, lane] of groupInstancesByMonster()) {
    const monster = monsterCache.get(path);
    if (!monster) continue;
    const items = indexFeatures(monster)
      .filter(item => item.villain)
      .sort((a, b) => (a.villain ?? 0) - (b.villain ?? 0));
    if (items.length) for (const instance of alive(lane)) rows.push({ path, instance, items });
  }
  if (!rows.length) return null;
  const now = villainActionThisRound();
  return (
    <div class={`villain-track ${now ? 'done' : ''}`} role="group" aria-label="Villain actions">
      <span class="villain-track-label">Villain</span>
      {rows.map(({ path, instance, items }) => (
        <span class="villain-who" key={instance.id}>
          <button
            class="villain-name"
            title="Show the next unused villain action"
            onClick={() => {
              const next = items.find(item => !instance.villainRounds[(item.villain ?? 1) - 1]) ?? items[0];
              if (next) jumpToFeature(path, next.index);
            }}
          >
            {instance.name}
          </button>
          {items.map(item => {
            const usedIn = instance.villainRounds[(item.villain ?? 1) - 1] ?? 0;
            return (
              <MarkBox
                key={item.index}
                on={usedIn > 0}
                spent={!usedIn && !!now}
                ordinal={item.villain ?? undefined}
                label={`${instance.name}: villain action ${item.villain}, ${item.name}`}
                title={
                  usedIn
                    ? `${item.villain} · ${item.name} · used in round ${usedIn}`
                    : `${item.villain} · ${item.name}${now ? ` · ${now.name} already used this round's` : ''}`
                }
                onClick={() => toggleVillainAction(instance.id, item.villain ?? 1)}
              />
            );
          })}
        </span>
      ))}
      <em class="villain-note">{now ? 'used this round' : 'ready'}</em>
    </div>
  );
}

/**
 * "Listening for": every triggered action in the fight, grouped by creature
 * with its trigger spelled out, and the villain actions on the strip's own
 * line. It answers the question the Director asks on every hero's turn: does
 * anything react to this?
 */
export function TriggerWatch() {
  void monstersVersion.value; // subscribe: rows appear as statblocks load
  const combat = activeEncounter().combat;
  const open = state.value.ui.watchOpen;
  const groups: { path: string; monster: Monster; lane: CombatInstance[]; capacity: number; items: IndexedFeature[] }[] = [];
  let hasVillain = false;
  for (const [path, lane] of groupInstancesByMonster()) {
    const monster = monsterCache.get(path);
    if (!monster || !alive(lane).length) continue;
    const all = indexFeatures(monster);
    if (all.some(item => item.villain)) hasVillain = true;
    const items = all.filter(item => item.slot === 'trigger');
    if (items.length) groups.push({ path, monster, lane, capacity: reactionsPerRound(monster), items });
  }
  if (!groups.length && !hasVillain) return null;

  let left = 0;
  for (const { lane, capacity, items } of groups) {
    if (!items.some(tracked)) continue;
    for (const instance of alive(lane)) if (!isDazed(instance)) left += Math.max(0, capacity - instance.reactions.length);
  }
  const summary = groups.some(group => group.items.some(tracked))
    ? `${left} triggered action${left === 1 ? '' : 's'} left this round`
    : '';

  return (
    <section class={`watch ${open ? 'open' : 'closed'}`} aria-label="Listening for">
      <div class="watch-head">
        {groups.length ? (
          <button class="watch-toggle" aria-expanded={open} onClick={toggleWatch}>
            <CaretIcon class="watch-caret" />
            <span class="ds-glyph watch-glyph" aria-hidden="true">)</span>
            <strong>Listening for</strong>
            <span>{summary}</span>
          </button>
        ) : null}
        <VillainTrack />
      </div>
      {open && groups.length ? (
        <div class="watch-body">
          <div class="watch-columns">
          {groups.map(({ path, monster, lane, capacity, items }) => {
            const living = alive(lane);
            const used = living.reduce((sum, instance) => sum + instance.reactions.length, 0);
            const out = living.every(instance => reacted(instance, capacity));
            return (
              <Fragment key={path}>
                <div class="watch-group-head">
                  <strong>
                    {monster.name}
                    {lane.length > 1 ? <span class="watch-count"> ×{living.length}</span> : null}
                  </strong>
                  {items.some(tracked) ? (
                    <em>
                      {out
                        ? 'none left this round'
                        : capacity > 1
                          ? `${capacity} a round${used ? ` · ${used} used` : ''}`
                          : used
                            ? `${used} of ${living.length} used`
                            : 'one a round'}
                    </em>
                  ) : null}
                </div>
                {items.map(item => {
                  const short = item.malice > combat.malice;
                  const quiet = tracked(item) && living.every(instance => reacted(instance, capacity) && !usesOf(instance, item.name));
                  return (
                    <div class={`watch-line ${quiet ? 'quiet' : ''}`} key={item.index}>
                      {tracked(item) ? (
                        <ReactionMarks item={item} lane={lane} capacity={capacity} />
                      ) : (
                        <em class="watch-free">free</em>
                      )}
                      <p>
                        <button class="watch-link" onClick={() => jumpToFeature(path, item.index)}>
                          {item.name}
                        </button>
                        {item.malice ? <> <MaliceCost value={item.malice} short={short} /></> : null}{' '}
                        {/* Out of reach this round: the name is enough; the trigger comes back next round. */}
                        {item.trigger && !quiet ? (
                          <span class="watch-trigger" dangerouslySetInnerHTML={{ __html: richText(item.trigger) }} />
                        ) : null}
                      </p>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
