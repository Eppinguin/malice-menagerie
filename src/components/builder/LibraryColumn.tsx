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
  filteredCatalog,
  hiddenFilterCount,
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
  setRangeFilter,
} from "../../store.ts";
import { beginPrepDrag, shouldSuppressClick } from "../../dnd.ts";
import { familyLabel, fmt } from "../../lib/text.ts";
import type { CatalogEntry, FacetKey, SortKey } from "../../types.ts";
import { QtyControl } from "../QtyControl.tsx";

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
  return (
    <div class="filter-bar">
      <div class="filter-row primary-filters">
        {ROLE_CHIPS.map((role) => (
          <button
            key={role}
            class={`chip ${ui.role === role ? "active" : ""}`}
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
          <span class="filter-toggle-caret" aria-hidden="true">
            ▾
          </span>
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

/** Eye glyph for the "preview statblock" button, replacing the stray emoji. */
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

function MonsterCard({ entry }: { entry: CatalogEntry }) {
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
            <span class="card-drag-handle" aria-hidden="true">
              ⠿
            </span>
            <h3>{entry.derivedName}</h3>
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
      <div class="monster-main preview-target" title="Click to preview statblock" onClick={preview}>
        <div class="monster-title-row">
          <span class="card-drag-handle" aria-hidden="true">
            ⠿
          </span>
          <h3>{m.name}</h3>
          <span class="tag">{m.organization}</span>
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
        </div>
        <div class="monster-preview">
          {featurePreview || m.ancestry || familyLabel(m.familyPath)}
        </div>
      </div>
      <div class="add-controls">
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
  const matches = filteredCatalog();
  const visible = matches.slice(0, MAX_LIBRARY_RESULTS);
  const stillLoading = hydratedCount.value < catalog.value.length;
  const filters = activeFilterCount(ui);

  if (!visible.length) {
    const note =
      filters && stillLoading
        ? "No matches yet — statblock data is still loading."
        : filters
          ? "No monsters match these filters."
          : "No matching monsters.";
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="empty-state">
          {note}
          {filters ? (
            <button class="secondary" onClick={clearAllFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div class="monster-library panel" id="monsterLibrary">
      <div class="library-results-bar">
        <span>
          {matches.length} result{matches.length === 1 ? "" : "s"}
          {needsMonsterData(ui) && stillLoading ? (
            <span class="results-loading">loading more…</span>
          ) : null}
        </span>
        {matches.length > MAX_LIBRARY_RESULTS ? (
          <span>Showing first {MAX_LIBRARY_RESULTS}</span>
        ) : null}
      </div>
      {visible.map((entry) => (
        <MonsterCard key={entry.path} entry={entry} />
      ))}
    </div>
  );
}

export function LibraryColumn() {
  const ui = state.value.ui;
  return (
    <section class="library-column">
      <div class="section-heading">
        <div>
          <h2>Monster library</h2>
          <SourceStatus />
        </div>
        <label class="search">
          <span>⌕</span>
          <input
            placeholder="Search monsters"
            value={ui.search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
      </div>
      <FilterBar />
      {ui.filtersOpen ? <FiltersPanel /> : null}
      <LibraryList />
    </section>
  );
}
