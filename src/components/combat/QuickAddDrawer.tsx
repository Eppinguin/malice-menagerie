import { useEffect, useRef, useState } from "preact/hooks";
import {
  catalog,
  catalogBounds,
  hydratedCount,
  monstersVersion,
  sourceError,
  sourceLoading,
} from "../../data.ts";
import {
  MAX_LIBRARY_RESULTS,
  activeEncounter,
  addGroup,
  addToEncounterInGroup,
  clearAllFilters,
  closeQuickAdd,
  decrementMonster,
  encounterTotals,
  evBudgetRemaining,
  fieldedCounts,
  hiddenFilterCount,
  isPartyLevelWindowActive,
  matchedCatalog,
  needsMonsterData,
  openPreview,
  partyLevelWindow,
  quickAddOpen,
  removeGroup,
  renameGroup,
  retrySource,
  selectPrepGroup,
  setRole,
  setSearch,
  setSort,
  setView,
  state,
  toggleFitsBudget,
  toggleInEncounter,
  togglePartyLevelWindow,
  updateParty,
} from "../../store.ts";
import { describeRange, highlightName } from "../../lib/browse.ts";
import { difficultyFor, partyMath } from "../../lib/rules.ts";
import { familyLabel, fmt } from "../../lib/text.ts";
import type { SortKey } from "../../types.ts";
import { ActiveFilterPills, FiltersPanel } from "../LibraryFilters.tsx";
import {
  CaretIcon,
  CloseIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  PrepIcon,
  SearchIcon,
} from "../Icons.tsx";

const QUICK_ORGS = ["all", "Minion", "Horde", "Elite", "Leader", "Solo"] as const;

function QuickPartyTray() {
  const party = activeEncounter().party;
  const values = partyMath(party);
  const commit = (
    patch: Partial<Record<"heroes" | "level" | "victories" | "bonusMalice", unknown>>,
  ) => {
    updateParty({
      heroes: patch.heroes ?? party.heroes,
      level: patch.level ?? party.level,
      victories: patch.victories ?? party.victories,
      bonusMalice: patch.bonusMalice ?? party.bonusMalice,
    });
  };
  return (
    <div class="qa-party-tray" role="region" aria-label="Party settings">
      <div class="qa-party-fields">
        <label>
          <span>Heroes</span>
          <input
            type="number"
            min={1}
            max={12}
            value={party.heroes}
            onChange={(event) => commit({ heroes: event.currentTarget.value })}
          />
        </label>
        <label>
          <span>Level</span>
          <input
            type="number"
            min={1}
            max={10}
            value={party.level}
            onChange={(event) => commit({ level: event.currentTarget.value })}
          />
        </label>
        <label>
          <span>Avg. Victories</span>
          <input
            type="number"
            min={0}
            max={20}
            value={party.victories}
            onChange={(event) => commit({ victories: event.currentTarget.value })}
          />
        </label>
        <label>
          <span>Bonus Malice</span>
          <input
            type="number"
            min={0}
            max={99}
            value={party.bonusMalice}
            onChange={(event) => commit({ bonusMalice: event.currentTarget.value })}
          />
        </label>
      </div>
      <div class="qa-party-metrics">
        <span>
          One hero ES <b>{values.oneHeroES}</b>
        </span>
        <span>
          Party ES <b>{values.partyES}</b>
        </span>
        <span class="qa-party-malice">
          Round 1 Malice <b>{values.roundOne}</b>
        </span>
      </div>
    </div>
  );
}

export function QuickAddDrawer() {
  void monstersVersion.value;
  const open = quickAddOpen.value;
  const drawerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rendered, setRendered] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [limit, setLimit] = useState(MAX_LIBRARY_RESULTS);

  useEffect(() => {
    document.body.classList.toggle("quick-add-open", open);
    if (open) {
      setRendered(true);
      const filterGroup = activeEncounter().combat.activeGroupFilter;
      if (filterGroup) selectPrepGroup(filterGroup);
      const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
      const raf = requestAnimationFrame(() => {
        // On touch devices, focus the drawer instead of the search input so
        // the on-screen keyboard doesn't ambush the monster list on open.
        if (coarse) {
          drawerRef.current?.focus();
        } else {
          searchRef.current?.focus();
          searchRef.current?.select();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    setEditingGroupId(null);
    if (drawerRef.current?.contains(document.activeElement)) {
      document.querySelector<HTMLButtonElement>(".quick-add-trigger")?.focus();
    }
    const timer = setTimeout(() => setRendered(false), 200);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => () => document.body.classList.remove("quick-add-open"), []);

  const ui = state.value.ui;
  const filterKey = [
    ui.search,
    ui.role,
    ui.sort,
    ui.fitsBudget,
    ui.inEncounter,
    ui.levelMin,
    ui.levelMax,
    ui.evMin,
    ui.evMax,
    ui.roles.join(","),
    ui.sizes.join(","),
    ui.keywords.join(","),
  ].join("|");
  useEffect(() => {
    setLimit(MAX_LIBRARY_RESULTS);
  }, [filterKey]);

  const activeEncId = state.value.activeEncounterId;
  useEffect(() => {
    setPartyOpen(false);
    setEditingGroupId(null);
  }, [activeEncId]);

  if (!rendered && !open) return null;

  const enc = activeEncounter();
  const totals = encounterTotals();
  const party = partyMath(enc.party);
  const difficulty = difficultyFor(totals.ev, party.partyES, party.oneHeroES);
  const budget = evBudgetRemaining();
  const fielded = fieldedCounts();
  const levelBounds = catalogBounds.value.level;
  const hidden = hiddenFilterCount(ui, levelBounds);
  const [pLo, pHi] = partyLevelWindow(levelBounds);
  const partyLvActive = isPartyLevelWindowActive(ui, levelBounds);
  const hasPartyWindow = pLo > levelBounds[0] || pHi < levelBounds[1];
  const targetGroupId = enc.groups.some((g) => g.id === enc.activePrepGroupId)
    ? enc.activePrepGroupId
    : (enc.groups[0]?.id ?? "");

  const { matches, parsed, hiddenByFilters } = matchedCatalog();
  const visible = matches.slice(0, limit);
  const remaining = matches.length - visible.length;
  const stillLoading = hydratedCount.value < catalog.value.length;
  const filtering =
    Boolean(ui.search.trim()) ||
    ui.role !== "all" ||
    ui.fitsBudget ||
    ui.inEncounter ||
    partyLvActive ||
    hidden > 0;

  const partySummary =
    `${enc.party.heroes} ${enc.party.heroes === 1 ? "hero" : "heroes"} · Lv ${enc.party.level}` +
    (enc.party.victories > 0 ? ` · ${enc.party.victories}V` : "") +
    (enc.party.bonusMalice > 0 ? ` · +${enc.party.bonusMalice}M` : "");

  const clearAll = () => {
    setSearch("");
    clearAllFilters();
    searchRef.current?.focus();
  };

  const commitGroupRename = (groupId: string, value: string) => {
    setEditingGroupId(null);
    renameGroup(groupId, value);
  };

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      const first = document.querySelector<HTMLElement>("#quickAddList .qa-row-main");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Enter" && ui.search.trim()) {
      const first = document.querySelector<HTMLElement>("#quickAddList .qa-row-main");
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".qa-row-main"),
    );
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && index === 0) {
      searchRef.current?.focus();
    } else {
      const next = Math.max(
        0,
        Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      rows[next]?.focus();
    }
  };

  const onDrawerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (editingGroupId) {
      event.preventDefault();
      event.stopPropagation();
      setEditingGroupId(null);
      return;
    }
    if (partyOpen) {
      event.preventDefault();
      event.stopPropagation();
      setPartyOpen(false);
      return;
    }
    if (filtersOpen) {
      event.preventDefault();
      event.stopPropagation();
      setFiltersOpen(false);
    }
  };

  return (
    <>
      <div
        class={`quick-add-backdrop ${open ? "open" : ""}`}
        aria-hidden="true"
        onClick={closeQuickAdd}
      />
      <aside
        ref={drawerRef}
        id="quickAddDrawer"
        class={`quick-add-drawer ${open ? "open" : ""}`}
        tabIndex={-1}
        aria-hidden={!open}
        aria-label="Add monsters to encounter"
        onKeyDown={onDrawerKeyDown}
      >
        <header class="qa-head">
          <div class="qa-head-top">
            <h2>Add monsters</h2>
            <div class="qa-head-actions">
              <button
                type="button"
                class="secondary compact-button qa-prep-link"
                title="Switch to Prep for full catalog browsing, group balance, and drag-and-drop"
                onClick={() => {
                  closeQuickAdd();
                  setView("builder");
                }}
              >
                <PrepIcon />
                <span>Prep</span>
              </button>
              <button
                class="icon-button"
                onClick={closeQuickAdd}
                title="Close drawer (Esc)"
                aria-label="Close add monsters drawer"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          <div class="qa-head-meta">
            <span class="qa-budget">
              EV <b>{fmt(totals.ev)}</b> ·{" "}
              <strong data-tier={difficulty.tier}>{difficulty.label}</strong>
              {budget.remaining > 0 ? (
                <span class="qa-budget-left">
                  {" "}
                  · {fmt(budget.remaining)} before {budget.nextBand}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              class={`qa-party-trigger ${partyOpen ? "open" : ""}`}
              aria-expanded={partyOpen}
              title="Edit party heroes, level, Victories, and bonus Malice"
              onClick={() => setPartyOpen((prev) => !prev)}
            >
              <span>{partySummary}</span>
              <CaretIcon class="qa-party-caret" />
            </button>
          </div>
        </header>

        <div class="qa-controls">
          {partyOpen ? <QuickPartyTray /> : null}

          <div class="qa-group-bar" role="group" aria-label="Target activation group">
            <span class="qa-bar-label">Group</span>
            <div class="qa-group-pills">
              {enc.groups.map((group, idx) => {
                const active = group.id === targetGroupId;
                const editing = editingGroupId === group.id;
                const canRemove = enc.groups.length > 1;
                const memberCount = enc.items
                  .filter((item) => item.groupId === group.id)
                  .reduce((sum, item) => sum + item.count, 0);
                const fallbackName =
                  enc.groups.find((g) => g.id !== group.id)?.name ?? "another group";
                return (
                  <span
                    key={group.id}
                    class={`qa-group-chip ${active ? "active" : ""}`}
                    data-group={idx % 6}
                  >
                    {editing ? (
                      <input
                        class="qa-group-input"
                        autoFocus
                        value={group.name}
                        aria-label={`Rename group ${group.name}`}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={(event) => commitGroupRename(group.id, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setEditingGroupId(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        class="qa-group-pill"
                        aria-pressed={active}
                        title="Click to select · double-click to rename"
                        onClick={() => selectPrepGroup(group.id)}
                        onDblClick={() => setEditingGroupId(group.id)}
                      >
                        {group.name}
                      </button>
                    )}
                    {active && !editing ? (
                      <button
                        type="button"
                        class="qa-group-edit"
                        aria-label={`Rename group ${group.name}`}
                        title={`Rename group ${group.name}`}
                        onClick={() => setEditingGroupId(group.id)}
                      >
                        <PencilIcon />
                      </button>
                    ) : null}
                    {canRemove && !editing ? (
                      <button
                        type="button"
                        class="qa-group-remove"
                        aria-label={`Remove group ${group.name}`}
                        title={
                          memberCount > 0
                            ? `Remove group ${group.name} (moves ${memberCount} to ${fallbackName}) · Undo available`
                            : `Remove group ${group.name} · Undo available`
                        }
                        onClick={() => removeGroup(group.id)}
                      >
                        <CloseIcon />
                      </button>
                    ) : null}
                  </span>
                );
              })}
              <button
                type="button"
                class="qa-group-add"
                title="Add activation group"
                aria-label="Add activation group"
                onClick={addGroup}
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          <label class="search qa-search">
            <SearchIcon />
            <input
              ref={searchRef}
              id="quickAddSearch"
              placeholder="Name, ability, lv 2, ev<=12…"
              aria-label="Search monsters"
              value={ui.search}
              onKeyDown={onSearchKeyDown}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>

          <div class="qa-chips" role="group" aria-label="Quick filters">
            {(fielded.size > 0 || ui.inEncounter) && (
              <button
                class={`chip ${ui.inEncounter ? "active" : ""}`}
                aria-pressed={ui.inEncounter}
                title="Only monsters currently in this encounter"
                onClick={toggleInEncounter}
              >
                In encounter <i class="chip-count">{fielded.size}</i>
              </button>
            )}
            <button
              class={`chip ${ui.fitsBudget ? "active" : ""}`}
              aria-pressed={ui.fitsBudget}
              disabled={budget.remaining <= 0 && !ui.fitsBudget}
              title={
                budget.remaining <= 0
                  ? "At or above the Extreme EV threshold"
                  : `Monsters that stay within ${fmt(budget.remaining)} EV left before ${budget.nextBand}`
              }
              onClick={toggleFitsBudget}
            >
              Fits EV
            </button>
            {hasPartyWindow ? (
              <button
                class={`chip ${partyLvActive ? "active" : ""}`}
                aria-pressed={partyLvActive}
                title={`Monsters near party level ${enc.party.level} (Level ${pLo}–${pHi})`}
                onClick={() => togglePartyLevelWindow(levelBounds)}
              >
                Lv {pLo}–{pHi}
              </button>
            ) : null}
            {QUICK_ORGS.map((org) => (
              <button
                key={org}
                class={`chip ${ui.role === org ? "active" : ""}`}
                aria-pressed={ui.role === org}
                onClick={() => setRole(org)}
              >
                {org === "all" ? "All" : org}
              </button>
            ))}
          </div>

          <div class="qa-summary">
            <span class="qa-count" aria-live="polite">
              <b>{matches.length}</b>
              {filtering ? ` of ${catalog.value.length}` : " monsters"}
              {parsed.level ? (
                <i class="query-token">{describeRange("Level", parsed.level)}</i>
              ) : null}
              {parsed.ev ? <i class="query-token">{describeRange("EV", parsed.ev)}</i> : null}
              {ui.fitsBudget ? <i class="query-token">≤ {fmt(budget.remaining)} EV</i> : null}
              {needsMonsterData(ui, parsed) && stillLoading ? (
                <span class="results-loading">loading more…</span>
              ) : null}
            </span>
            <div class="qa-summary-tools">
              {filtering ? (
                <button type="button" class="text-button" onClick={clearAll}>
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                class={`chip qa-more-toggle ${hidden > 0 ? "has-filters" : ""} ${filtersOpen ? "open" : ""}`}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                More
                <i class="filter-count" hidden={hidden === 0}>
                  {hidden}
                </i>
                <CaretIcon class="filter-toggle-caret" />
              </button>
              <select
                class="qa-sort-select"
                aria-label="Sort monsters"
                value={ui.sort}
                onChange={(event) => setSort(event.currentTarget.value as SortKey)}
              >
                <option value="name">Name</option>
                <option value="level">Level</option>
                <option value="ev">EV</option>
              </select>
            </div>
          </div>

          {filtersOpen ? <FiltersPanel compact /> : <ActiveFilterPills />}
        </div>

        <div class="qa-list" id="quickAddList" role="list" onKeyDown={onListKeyDown}>
          {sourceError.value ? (
            <div class="source-error">
              <strong>Could not load SteelCompendium.</strong>
              <span>{sourceError.value}</span>
              <button class="secondary" onClick={retrySource}>
                Retry
              </button>
            </div>
          ) : sourceLoading.value && !catalog.value.length ? (
            <div class="library-loading">Loading source index…</div>
          ) : !visible.length ? (
            <div class="empty-state qa-empty">
              <p>
                {ui.inEncounter && !ui.search.trim()
                  ? "No monsters in this encounter yet."
                  : `No monsters match${ui.search.trim() ? ` “${ui.search.trim()}”` : " these filters"}.`}
              </p>
              {hiddenByFilters > 0 ? (
                <button class="secondary compact-button" onClick={clearAllFilters}>
                  Show {hiddenByFilters} more outside filters
                </button>
              ) : (
                <small>Try a family, an ability like “grab”, or “lv 1-3 ev&lt;=12”.</small>
              )}
            </div>
          ) : (
            <>
              {visible.map(({ entry, nameHits, hit }) => {
                const m = entry.monster;
                const here = fielded.get(entry.path) ?? 0;
                const name = m?.name || entry.derivedName;
                const addCount = m ? Math.max(1, m.defaultQty) : 1;
                return (
                  <div class="qa-row" key={entry.path} role="listitem">
                    <button
                      class="qa-row-main"
                      title={`Preview ${name}`}
                      onClick={() => openPreview(entry.path)}
                    >
                      <span class="qa-row-title">
                        <strong>
                          {highlightName(name, nameHits).map((run, i) =>
                            run.hit ? (
                              <mark class="search-hit" key={i}>
                                {run.text}
                              </mark>
                            ) : (
                              run.text
                            ),
                          )}
                        </strong>
                        {m ? <span class="tag">{m.organization}</span> : null}
                      </span>
                      <span class="qa-row-meta">
                        {m ? (
                          <>
                            <span>Lv {fmt(m.level)}</span>
                            {m.role ? <span>{m.role}</span> : null}
                            <span>EV {m.evLabel}</span>
                          </>
                        ) : (
                          <span>{familyLabel(entry.familyPath)}</span>
                        )}
                        {hit ? <span class="qa-row-hit">· {hit}</span> : null}
                      </span>
                    </button>
                    <div class="field-stepper" data-here={here > 0 ? "true" : undefined}>
                      {here > 0 ? (
                        <>
                          <button
                            class="stepper-minus"
                            aria-label={`Remove one ${name}`}
                            title={`Remove one ${name} · Undo available`}
                            onClick={() => decrementMonster(entry.path)}
                          >
                            <MinusIcon />
                          </button>
                          <span class="stepper-count" title={`${here} in this encounter`}>
                            {here}
                          </span>
                        </>
                      ) : null}
                      <button
                        class="stepper-plus"
                        aria-label={`Add ${addCount > 1 ? `${addCount} ` : ""}${name}`}
                        title={`Add ${addCount > 1 ? `squad of ${addCount} ` : ""}${name} to Group ${enc.groups.find((g) => g.id === targetGroupId)?.name ?? ""}`}
                        onClick={() =>
                          void addToEncounterInGroup(entry.path, addCount, targetGroupId)
                        }
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
              {remaining > 0 ? (
                <div class="library-more-bar qa-more-bar">
                  <button
                    type="button"
                    class="secondary compact-button"
                    onClick={() => setLimit((prev) => prev + MAX_LIBRARY_RESULTS)}
                  >
                    Show {Math.min(remaining, MAX_LIBRARY_RESULTS)} more
                  </button>
                  {remaining > MAX_LIBRARY_RESULTS ? (
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => setLimit(matches.length)}
                    >
                      Show all {matches.length}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
