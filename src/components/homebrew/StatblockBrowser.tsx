import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { allCatalog, monsterAt, monstersVersion } from "../../data.ts";
import { matchCatalogEntry, parseQuery } from "../../lib/browse.ts";
import { ORGANIZATIONS, ROLES } from "../../lib/homebrew.ts";
import { familyLabel } from "../../lib/text.ts";
import type { CatalogEntry, Monster, MonsterFeature } from "../../types.ts";
import { CaretIcon, ChevronLeftIcon, CloseIcon, SearchIcon } from "../Icons.tsx";
import { PenSwitch } from "../Pen.tsx";
import { StatblockReader } from "./StatblockReader.tsx";

const NEAR_LEVELS = 2;

/** What the browser shows; kept by the studio so it reopens where it was. */
export interface BrowserState {
  query: string;
  /** Only statblocks within two levels of the monster. */
  near: boolean;
  role: string;
  organization: string;
  /** The statblock being read, or null for the list. */
  path: string | null;
}

/** Browsing from scratch: every statblock. */
export function browseEverything(): BrowserState {
  return { query: "", near: false, role: "", organization: "", path: null };
}

/** Opening a named statblock: the list around it is everything matching the search. */
export function browseTo(path: string, query = ""): BrowserState {
  return { query, near: false, role: "", organization: "", path };
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Every statblock to copy from, beside the studio page: a list to narrow by
 * search, level, role and organization, and each statblock read in full,
 * stepping to the next result without going back to the list.
 */
export function StatblockBrowser({
  draftId,
  level,
  familyPath,
  have,
  state,
  onState,
  onClose,
  onTakeAll,
  onTakeStats,
  onAdd,
  onUseFamily,
}: {
  draftId: string;
  level: number;
  familyPath: string;
  have: ReadonlySet<string>;
  state: BrowserState;
  onState: (next: BrowserState) => void;
  onClose: () => void;
  onTakeAll: (monster: Monster) => void;
  onTakeStats: (monster: Monster) => void;
  onAdd: (feature: MonsterFeature, sourceName: string) => void;
  onUseFamily: (slug: string, label: string) => void;
}) {
  void monstersVersion.value; // subscribe: filters sharpen as statblocks load
  const { query, near, role, organization, path } = state;
  const set = (patch: Partial<BrowserState>) => onState({ ...state, ...patch });
  const [active, setActive] = useState(0);
  // A reading preference, kept while stepping from one statblock to the next.
  const [scale, setScale] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { results, pending } = useMemo(() => {
    const parsed = parseQuery(query);
    const needsData = near || role !== "" || organization !== "";
    const found: { entry: CatalogEntry; score: number }[] = [];
    let waiting = 0;
    for (const entry of allCatalog.value) {
      if (entry.monster?.homebrewId === draftId) continue;
      const hit = matchCatalogEntry(entry, parsed);
      if (!hit) continue;
      const m = entry.monster;
      if (needsData) {
        if (!m) {
          if (!entry.error) waiting += 1;
          continue;
        }
        if (near && Math.abs(m.level - level) > NEAR_LEVELS) continue;
        if (role && !sameText(m.role, role)) continue;
        if (organization && !sameText(m.organization, organization)) continue;
      }
      found.push({ entry, score: hit.score });
    }
    const searching = parsed.words.length > 0;
    found.sort(
      (a, b) =>
        (searching ? b.score - a.score : 0) ||
        (a.entry.monster?.name ?? a.entry.derivedName).localeCompare(
          b.entry.monster?.name ?? b.entry.derivedName,
        ),
    );
    return { results: found.map((f) => f.entry), pending: waiting };
  }, [query, near, role, organization, level, draftId, allCatalog.value, monstersVersion.value]);

  useEffect(() => setActive(0), [query, near, role, organization]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".hb-src-row.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const at = path ? results.findIndex((e) => e.path === path) : -1;
  const raw = path ? monsterAt(path) : undefined;
  const reading = path !== null;

  // Arriving at the list puts the hand in the search, or back on the row
  // just read; arriving at a statblock puts it on the statblock.
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      if (reading) {
        rootRef.current?.focus({ preventScroll: true });
        return;
      }
      const back = lastRead.current;
      const row = back
        ? listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(back)}"]`)
        : null;
      if (row) {
        row.scrollIntoView({ block: "nearest" });
        row.focus({ preventScroll: true });
      } else {
        searchRef.current?.focus({ preventScroll: true });
      }
    });
    if (path) lastRead.current = path;
  }, [reading]);

  const open = (p: string) => set({ path: p });
  const step = (delta: -1 | 1) => {
    const next = results[at + delta];
    if (next) set({ path: next.path });
  };

  const likeLabel = `Level ${Math.max(0, level - NEAR_LEVELS)}–${level + NEAR_LEVELS}`;
  const filtered = near || role !== "" || organization !== "";
  const shown = results;

  const closeButton = (
    <button
      type="button"
      class="icon-button"
      aria-label="Close statblocks"
      title="Close (Esc)"
      onClick={onClose}
    >
      <CloseIcon />
    </button>
  );

  return (
    <div
      class="hb-src"
      ref={rootRef}
      tabIndex={-1}
      aria-label={reading ? "Statblock" : "Statblocks"}
      onKeyDown={(e) => {
        if (!reading || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const t = e.target as HTMLElement;
        if (t.closest("input, textarea, select")) return;
        if (e.key === "ArrowLeft" && at > 0) {
          e.preventDefault();
          step(-1);
        } else if (e.key === "ArrowRight" && at >= 0 && at < results.length - 1) {
          e.preventDefault();
          step(1);
        }
      }}
    >
      <div class="hb-src-list" hidden={reading}>
        <header class="hb-src-head">
          <div class="hb-src-bar">
            <label class="hb-src-search">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search statblocks, lv 3, ev 12"
                aria-label="Search statblocks"
                value={query}
                onInput={(e) => set({ query: e.currentTarget.value })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(shown.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    const hit = shown[active];
                    if (hit) {
                      e.preventDefault();
                      open(hit.path);
                    }
                  }
                }}
              />
            </label>
            {closeButton}
          </div>
          <div class="hb-src-filters">
            <div class="hb-browse-scope" role="radiogroup" aria-label="Level">
              <button
                type="button"
                role="radio"
                aria-checked={!near}
                onClick={() => set({ near: false })}
              >
                Any level
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={near}
                onClick={() => set({ near: true })}
              >
                {likeLabel}
              </button>
            </div>
            <Pick
              label="Role"
              any="Any role"
              value={role}
              options={ROLES}
              onChange={(v) => set({ role: v })}
            />
            <Pick
              label="Organization"
              any="Any organization"
              value={organization}
              options={ORGANIZATIONS}
              onChange={(v) => set({ organization: v })}
            />
          </div>
        </header>
        <div class="hb-src-results" ref={listRef}>
          <p class="hb-src-count" role="status">
            {results.length} {results.length === 1 ? "statblock" : "statblocks"}
            {pending > 0 && filtered ? ` · ${pending} still loading` : ""}
            {filtered ? (
              <button
                type="button"
                class="text-button"
                onClick={() => set({ near: false, role: "", organization: "" })}
              >
                Clear filters
              </button>
            ) : null}
          </p>
          <ul class="hb-src-rows" role="listbox" aria-label="Statblocks">
            {shown.map((entry, i) => {
              const m = entry.monster;
              const fam = familyLabel(m?.familyPath || entry.familyPath);
              return (
                <li key={entry.path} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-path={entry.path}
                    class={`hb-src-row${i === active ? " is-active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(entry.path)}
                  >
                    <strong>{m?.name ?? entry.derivedName}</strong>
                    <span>{m ? `Level ${m.level} ${m.organization} ${m.role}`.trim() : ""}</span>
                    {fam ? <small>{fam}</small> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {path ? (
        <StatblockReader
          path={path}
          level={level}
          familyPath={familyPath}
          have={have}
          onTakeAll={onTakeAll}
          onTakeStats={onTakeStats}
          onAdd={onAdd}
          onUseFamily={onUseFamily}
          scale={scale}
          bar={
            <div class="hb-src-bar">
              <button
                type="button"
                class="text-button hb-src-back"
                onClick={() => set({ path: null })}
              >
                <ChevronLeftIcon />
                <span>
                  {results.length}
                  <span class="hb-src-back-noun">
                    {" "}
                    {results.length === 1 ? "statblock" : "statblocks"}
                  </span>
                </span>
              </button>
              {raw && raw.level !== level ? (
                <PenSwitch
                  seed="source-scale"
                  class="hb-src-scale"
                  checked={scale}
                  onChange={setScale}
                  title={`Print it at your monster's level instead of its own (${raw.level})`}
                  label={`At level ${level}`}
                />
              ) : null}
              {at >= 0 ? (
                <div class="hb-src-step" role="group" aria-label="Step through results">
                  <button
                    type="button"
                    class="icon-button"
                    aria-label="Previous statblock"
                    title="Previous (←)"
                    disabled={at <= 0}
                    onClick={() => step(-1)}
                  >
                    <ChevronLeftIcon />
                  </button>
                  <span>
                    {at + 1} / {results.length}
                  </span>
                  <button
                    type="button"
                    class="icon-button hb-src-next"
                    aria-label="Next statblock"
                    title="Next (→)"
                    disabled={at >= results.length - 1}
                    onClick={() => step(1)}
                  >
                    <ChevronLeftIcon />
                  </button>
                </div>
              ) : null}
              {closeButton}
            </div>
          }
        />
      ) : null}
    </div>
  );
}

/** A filter that is one of a short printed list: a compact picker that reads
    as set (inked) once it holds a value. */
function Pick({
  label,
  any,
  value,
  options,
  onChange,
}: {
  label: string;
  any: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => sameText(o, value)) ?? "";
  return (
    <label class={`hb-src-pick${current ? " is-set" : ""}`}>
      <select aria-label={label} value={current} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <CaretIcon />
    </label>
  );
}
