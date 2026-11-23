import {
  catalog,
  catalogBounds,
  facetOptions,
  hydratedCount,
  hydrationErrors,
  monsterNameForPath,
  sourceError,
  sourceLoading,
} from "../../data.ts";
import type { FacetOption } from "../../data.ts";
import {
  MAX_LIBRARY_RESULTS,
  activeFilterCount,
  addToEncounter,
  clearAllFilters,
  decrementMonster,
  evBudgetRemaining,
  fieldedCounts,
  hiddenFilterCount,
  matchedCatalog,
  needsMonsterData,
  openPreview,
  qtyFor,
  retrySource,
  setRole,
  setSearch,
  setSort,
  state,
  toggleFacetValue,
  toggleFiltersOpen,
  toggleFitsBudget,
  toggleInEncounter,
  setRangeFilter,
} from "../../store.ts";
import { beginPrepDrag, shouldSuppressClick } from "../../dnd.ts";
import { describeRange, highlightName, type CatalogMatch } from "../../lib/browse.ts";
import { familyLabel, fmt } from "../../lib/text.ts";
import type { FacetKey, SortKey } from "../../types.ts";
import { QtyControl } from "../QtyControl.tsx";
import { CaretIcon, GripIcon, MinusIcon, SearchIcon } from "../Icons.tsx";

const ROLE_CHIPS = ["all", "Horde", "Minion", "Elite", "Leader", "Solo"] as const;

function SourceStatus() {
  const error = sourceError.value;
  if (error) return <span class="source-status error">Source unavailable · {error}</span>;
  const total = catalog.value.length;
  const hydrated = hydratedCount.value;
  const errors = hydrationErrors.value;
  let text: string;
  if (sourceLoading.value) text = "Connecting to SteelCompendium…";
  else if (!total) text = "No statblocks found";
  else if (hydrated < total)
    text = `${total} statblocks · loading details ${Math.min(hydrated, total)}/${total}`;
  else
    text = `${total - errors} statblocks from SteelCompendium${errors ? ` · ${errors} unavailable` : ""}`;
  return <span class="source-status">{text}</span>;
}

function FilterBar() {
  const ui = state.value.ui;
  const hidden = hiddenFilterCount(ui);
  const fielded = fieldedCounts();
  const budget = evBudgetRemaining();
  return (
    <div class="filter-bar">
      <div class="filter-row primary-filters">
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
        {ROLE_CHIPS.map((role) => (
          <button
            key={role}
            class={`chip ${ui.role === role ? "active" : ""}`}
            aria-pressed={ui.role === role}
            onClick={() => setRole(role)}
          >
            {role === "all" ? "All" : role}
          </button>
        ))}
      </div>
      <div class="filter-tools">
        <button class="text-button" hidden={activeFilterCount(ui) === 0} onClick={clearAllFilters}>
          Clear all
        </button>
        <button
          class={`chip filter-toggle ${hidden > 0 ? "has-filters" : ""} ${ui.filtersOpen ? "open" : ""}`}
          aria-expanded={ui.filtersOpen}
          onClick={toggleFiltersOpen}
        >
          More
          <i class="filter-count" hidden={hidden === 0}>
            {hidden}
          </i>
          <CaretIcon class="filter-toggle-caret" />
        </button>
        <label class="sort-control">
          <span>Sort</span>
          <select
            aria-label="Sort monsters"
            value={ui.sort}
            onChange={(event) => setSort(event.currentTarget.value as SortKey)}
          >
            <option value="name">Name</option>
            <option value="level">Level</option>
            <option value="ev">EV</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function FacetChips({
  facetKey,
  options,
  selected,
}: {
  facetKey: FacetKey;
  options: FacetOption[];
  selected: string[];
}) {
  if (!options.length) return <span class="facet-empty">Loading…</span>;
  const selectedSet = new Set(selected);
  return (
    <>
      {options.map(([value, label]) => (
        <button
          key={value}
          class={`chip facet-chip ${selectedSet.has(value) ? "active" : ""}`}
          onClick={() => toggleFacetValue(facetKey, value)}
        >
          {label}
        </button>
      ))}
    </>
  );
}

function DualRange({
  label,
  bounds,
  min,
  max,
  onChange,
}: {
  label: string;
  bounds: readonly [number, number];
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [lo, hi] = bounds;
  const lowActive = min ?? lo;
  const highActive = max ?? hi;
  const span = hi - lo || 1;
  const leftPct = ((lowActive - lo) / span) * 100;
  const rightPct = ((highActive - lo) / span) * 100;
  const constrained = min !== null || max !== null;
  // A thumb resting on its bound means "no constraint" on that side.
  const commit = (minVal: number, maxVal: number) => {
    onChange(minVal <= lo ? null : minVal, maxVal >= hi ? null : maxVal);
  };
  return (
    <div class="range-facet">
      <p class="facet-label">
        {label}{" "}
        <span class={`range-value ${constrained ? "range-value-active" : ""}`}>
          {constrained ? `${lowActive}–${highActive}` : `${lo}–${hi}`}
        </span>
      </p>
      <div class="dual-range">
        <div class="dual-range-track">
          <span
            class="dual-range-fill"
            style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          />
        </div>
        <input
          type="range"
          min={lo}
          max={hi}
          step={1}
          value={lowActive}
          aria-label={`Minimum ${label.toLowerCase()}`}
          onInput={(event) => {
            const value = Number(event.currentTarget.value);
            commit(Math.min(value, highActive), highActive);
          }}
        />
        <input
          type="range"
          min={lo}
          max={hi}
          step={1}
          value={highActive}
          aria-label={`Maximum ${label.toLowerCase()}`}
          onInput={(event) => {
            const value = Number(event.currentTarget.value);
            commit(lowActive, Math.max(value, lowActive));
          }}
        />
      </div>
    </div>
  );
}

function FiltersPanel() {
  const ui = state.value.ui;
  const options = facetOptions.value;
  const bounds = catalogBounds.value;
  return (
    <div class="filters-panel panel">
      <div class="facet-ranges">
        <DualRange
          label="Level"
          bounds={bounds.level}
          min={ui.levelMin}
          max={ui.levelMax}
          onChange={(min, max) => setRangeFilter("level", min, max)}
        />
        <DualRange
          label="EV"
          bounds={bounds.ev}
          min={ui.evMin}
          max={ui.evMax}
          onChange={(min, max) => setRangeFilter("ev", min, max)}
        />
      </div>
      <div class="facet">
        <p class="facet-label">Role</p>
        <div class="facet-chips">
          <FacetChips facetKey="roles" options={options.roles} selected={ui.roles} />
        </div>
      </div>
      <div class="facet">
        <p class="facet-label">Size</p>
        <div class="facet-chips">
          <FacetChips facetKey="sizes" options={options.sizes} selected={ui.sizes} />
        </div>
      </div>
      <div class="facet">
        <p class="facet-label">Keywords</p>
        <div class="facet-chips">
          <FacetChips facetKey="keywords" options={options.keywords} selected={ui.keywords} />
        </div>
      </div>
    </div>
  );
}

/** Eye glyph for the "preview statblock" button. */
function EyeIcon() {
  return (
    <svg
      class="preview-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function MonsterCard({ match, here }: { match: CatalogMatch; here: number }) {
  const { entry, nameHits, hit } = match;
  const m = entry.monster;
  const startDrag = (event: PointerEvent, card: HTMLElement) => {
    beginPrepDrag(
      event,
      {
        kind: "library",
        sourcePath: entry.path,
        count: qtyFor(entry.path),
        label: monsterNameForPath(entry.path),
      },
      card,
    );
  };
  const preview = () => {
    if (!shouldSuppressClick()) openPreview(entry.path);
  };
  const add = () => {
    if (!shouldSuppressClick()) void addToEncounter(entry.path, qtyFor(entry.path));
  };

  if (!m) {
    return (
      <article
        class="monster-card loading-card"
        onPointerDown={(event) => startDrag(event, event.currentTarget)}
      >
        <div class="monster-main">
          <div class="monster-title-row">
            <GripIcon class="card-drag-handle" />
            <h3>
              {highlightName(entry.derivedName, nameHits).map((run, i) =>
                run.hit ? (
                  <mark class="search-hit" key={i}>
                    {run.text}
                  </mark>
                ) : (
                  run.text
                ),
              )}
            </h3>
            <span class="tag">{familyLabel(entry.familyPath)}</span>
          </div>
          <div class="monster-meta">
            <span>{entry.error ? "Source file unavailable" : "Loading statblock…"}</span>
          </div>
        </div>
        <div class="add-controls">
          <QtyControl path={entry.path} />
          <button class="primary" onClick={add}>
            Add
          </button>
        </div>
      </article>
    );
  }

  const featurePreview = m.features
    .slice(0, 3)
    .map((feature) => feature.name)
    .filter(Boolean)
    .join(" · ");
  return (
    <article class="monster-card" onPointerDown={(event) => startDrag(event, event.currentTarget)}>
      <div
        class="monster-main preview-target"
        tabIndex={0}
        role="button"
        title="Click to preview statblock"
        onClick={preview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            preview();
          }
        }}
      >
        <div class="monster-title-row">
          <GripIcon class="card-drag-handle" />
          <h3>
            {highlightName(m.name, nameHits).map((run, i) =>
              run.hit ? (
                <mark class="search-hit" key={i}>
                  {run.text}
                </mark>
              ) : (
                run.text
              ),
            )}
          </h3>
          <span class="tag">{m.organization}</span>
          {here > 0 ? (
            <span class="fielded-pill" title={`${here} in this encounter`}>
              ×{here}
            </span>
          ) : null}
        </div>
        <div class="monster-meta">
          <span>
            Level <b>{fmt(m.level)}</b>
          </span>
          <span>{m.role || "—"}</span>
          <span>
            EV <b>{m.evLabel}</b>
          </span>
          <span>{m.size}</span>
          {hit ? <span class="monster-hit-gloss">· {hit}</span> : null}
        </div>
        <div class="monster-preview">
          {featurePreview || m.ancestry || familyLabel(m.familyPath)}
        </div>
      </div>
      <div class="add-controls">
        {here > 0 ? (
          <button
            class="icon-button fielded-trim"
            title={`Remove one ${m.name} from encounter · Undo available`}
            aria-label={`Remove one ${m.name} from encounter`}
            onClick={() => {
              if (!shouldSuppressClick()) decrementMonster(m.path);
            }}
          >
            <MinusIcon />
          </button>
        ) : null}
        <button
          class="preview-button"
          title="Preview statblock"
          aria-label={`Preview ${m.name}`}
          onClick={preview}
        >
          <EyeIcon />
        </button>
        <QtyControl path={m.path} />
        <button class="primary" onClick={add}>
          Add
        </button>
      </div>
    </article>
  );
}

function LibraryList() {
  const error = sourceError.value;
  if (error) {
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="source-error">
          <strong>Could not load SteelCompendium.</strong>
          <span>{error}</span>
          <button class="secondary" onClick={retrySource}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (sourceLoading.value && !catalog.value.length) {
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="library-loading">Loading source index…</div>
      </div>
    );
  }

  const ui = state.value.ui;
  const { matches, parsed, hiddenByFilters } = matchedCatalog();
  const visible = matches.slice(0, MAX_LIBRARY_RESULTS);
  const stillLoading = hydratedCount.value < catalog.value.length;
  const filters = activeFilterCount(ui);
  const fielded = fieldedCounts();
  const budget = evBudgetRemaining();

  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        ".monster-main.preview-target",
      ),
    );
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && index === 0) {
      document.getElementById("prepLibrarySearch")?.focus();
    } else {
      const next = Math.max(
        0,
        Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      rows[next]?.focus();
    }
  };

  if (!visible.length) {
    const note =
      (filters || parsed.level || parsed.ev) && stillLoading
        ? "No matches yet — statblock data is still loading."
        : filters
          ? `No monsters match${ui.search.trim() ? ` “${ui.search.trim()}”` : " these filters"}.`
          : `No matching monsters${ui.search.trim() ? ` for “${ui.search.trim()}”` : ""}.`;
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="empty-state">
          <p>{note}</p>
          {hiddenByFilters > 0 ? (
            <button class="secondary" onClick={clearAllFilters}>
              Show {hiddenByFilters} more outside filters
            </button>
          ) : filters ? (
            <button class="secondary" onClick={clearAllFilters}>
              Clear filters
            </button>
          ) : (
            <small>Try a family, an ability like “grab”, or “lv 1-3 ev&lt;=12”.</small>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="monster-library panel" id="monsterLibrary" onKeyDown={onListKeyDown}>
      <div class="library-results-bar">
        <span class="results-meta">
          {matches.length} result{matches.length === 1 ? "" : "s"}
          {parsed.level ? <i class="query-token">{describeRange("Level", parsed.level)}</i> : null}
          {parsed.ev ? <i class="query-token">{describeRange("EV", parsed.ev)}</i> : null}
          {ui.fitsBudget ? <i class="query-token">≤ {fmt(budget.remaining)} EV</i> : null}
          {needsMonsterData(ui, parsed) && stillLoading ? (
            <span class="results-loading">loading more…</span>
          ) : null}
        </span>
        {matches.length > MAX_LIBRARY_RESULTS ? (
          <span>Showing first {MAX_LIBRARY_RESULTS}</span>
        ) : null}
      </div>
      {visible.map((match) => (
        <MonsterCard
          key={match.entry.path}
          match={match}
          here={fielded.get(match.entry.path) ?? 0}
        />
      ))}
    </div>
  );
}

export function LibraryColumn() {
  const ui = state.value.ui;
  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      const first = document.querySelector<HTMLElement>(
        "#monsterLibrary .monster-main.preview-target",
      );
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Enter" && ui.search.trim()) {
      const first = document.querySelector<HTMLElement>(
        "#monsterLibrary .monster-main.preview-target",
      );
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  };
  return (
    <section class="library-column">
      <div class="section-heading">
        <div>
          <h2>Monster library</h2>
          <SourceStatus />
        </div>
        <label class="search">
          <SearchIcon />
          <input
            id="prepLibrarySearch"
            placeholder="Name, ability, lv 2, ev<=12…"
            value={ui.search}
            onKeyDown={onSearchKeyDown}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
      </div>
      <FilterBar />
      {ui.filtersOpen ? <FiltersPanel /> : null}
      <LibraryList />
    </section>
  );
}
