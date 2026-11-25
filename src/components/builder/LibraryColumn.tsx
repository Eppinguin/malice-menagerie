import { useEffect, useState } from "preact/hooks";
import {
  catalog,
  catalogBounds,
  homebrewCatalog,
  hydratedCount,
  hydrationErrors,
  monsterNameForPath,
  sourceError,
  sourceLoading,
} from "../../data.ts";
import {
  MAX_LIBRARY_RESULTS,
  activeEncounter,
  activeFilterCount,
  addToEncounter,
  clearAllFilters,
  evBudgetRemaining,
  fieldedCounts,
  hiddenFilterCount,
  isPartyLevelWindowActive,
  matchedCatalog,
  needsMonsterData,
  openEditHomebrewMonster,
  openImportDialog,
  openNewHomebrewMonster,
  openPreview,
  openShareDialog,
  partyLevelWindow,
  qtyFor,
  retrySource,
  setRole,
  setSearch,
  setSort,
  state,
  toggleFiltersOpen,
  toggleFitsBudget,
  toggleHomebrewOnly,
  toggleInEncounter,
  togglePartyLevelWindow,
} from "../../store.ts";
import { beginPrepDrag, shouldSuppressClick } from "../../dnd.ts";
import { describeRange, highlightName, type CatalogMatch } from "../../lib/browse.ts";
import { familyLabel, fmt } from "../../lib/text.ts";
import type { SortKey } from "../../types.ts";
import { ActiveFilterPills, FiltersPanel } from "../LibraryFilters.tsx";
import { QtyControl } from "../QtyControl.tsx";
import { PasteImport, pasteImportKeyDown } from "../PasteImport.tsx";
import { looksLikeImport } from "../../lib/importSniff.ts";
import {
  CaretIcon,
  GripIcon,
  ImportIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShareIcon,
} from "../Icons.tsx";

const ROLE_CHIPS = ["all", "Horde", "Minion", "Elite", "Leader", "Solo"] as const;

function SourceStatus() {
  const error = sourceError.value;
  const hbCount = homebrewCatalog.value.length;
  const hbSuffix = hbCount ? ` · ${hbCount} homebrew` : "";
  if (error)
    return (
      <span class="source-status error">
        Source unavailable · {error}
        {hbSuffix}
      </span>
    );
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
  return (
    <span class="source-status">
      {text}
      {hbSuffix}
    </span>
  );
}

function FilterBar() {
  const ui = state.value.ui;
  const fielded = fieldedCounts();
  const hbCount = homebrewCatalog.value.length;
  const budget = evBudgetRemaining();
  const bounds = catalogBounds.value.level;
  const hidden = hiddenFilterCount(ui, bounds);
  const party = activeEncounter().party;
  const [pLo, pHi] = partyLevelWindow(bounds);
  const partyLvActive = isPartyLevelWindowActive(ui, bounds);
  const hasPartyWindow = pLo > bounds[0] || pHi < bounds[1];
  return (
    <div class="filter-bar">
      <div class="filter-row primary-filters">
        <button
          class={`chip chip-homebrew ${ui.homebrewOnly ? "active" : ""}`}
          aria-pressed={ui.homebrewOnly}
          title="Only your homebrew monsters"
          onClick={toggleHomebrewOnly}
        >
          Homebrew{hbCount > 0 ? <i class="chip-count">{hbCount}</i> : null}
        </button>
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
            title={`Monsters near party level ${party.level} (Level ${pLo}–${pHi})`}
            onClick={() => togglePartyLevelWindow(bounds)}
          >
            Lv {pLo}–{pHi}
          </button>
        ) : null}
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
          {m.isHomebrew ? <span class="tag tag-homebrew">Homebrew</span> : null}
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
        {m.isHomebrew && m.homebrewId ? (
          <>
            <button
              class="preview-button"
              title="Edit homebrew monster"
              aria-label={`Edit ${m.name}`}
              onClick={() => openEditHomebrewMonster(m.homebrewId!)}
            >
              <PencilIcon />
            </button>
            <button
              class="preview-button"
              title="Share link or export JSON"
              aria-label={`Share ${m.name}`}
              onClick={() => openShareDialog("monster", m.homebrewId!)}
            >
              <ShareIcon />
            </button>
          </>
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
  const hasHomebrew = homebrewCatalog.value.length > 0;
  if (error && !hasHomebrew) {
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="source-error">
          <strong>Could not load SteelCompendium.</strong>
          <span>{error}</span>
          <div class="hb-empty-actions">
            <button class="secondary" onClick={retrySource}>
              Retry
            </button>
            <button class="primary" onClick={() => openNewHomebrewMonster()}>
              <PlusIcon />
              New monster
            </button>
            <button class="secondary" onClick={openImportDialog}>
              <ImportIcon />
              Import
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (sourceLoading.value && !catalog.value.length && !hasHomebrew) {
    return (
      <div class="monster-library panel" id="monsterLibrary">
        <div class="library-loading">Loading source index…</div>
      </div>
    );
  }

  const ui = state.value.ui;
  const [limit, setLimit] = useState(MAX_LIBRARY_RESULTS);
  const filterKey = [
    ui.search,
    ui.role,
    ui.sort,
    ui.fitsBudget,
    ui.inEncounter,
    ui.homebrewOnly,
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

  const { matches, parsed, hiddenByFilters } = matchedCatalog();
  const visible = matches.slice(0, limit);
  const remaining = matches.length - visible.length;
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
    if (ui.homebrewOnly && !hasHomebrew) {
      return (
        <div class="monster-library panel" id="monsterLibrary">
          <div class="empty-state">
            <p>No homebrew monsters yet.</p>
            <small>
              Build one from Draw Steel’s level math, click “Clone &amp; edit” on any official
              statblock, or import a shared link or JSON file.
            </small>
            <div class="hb-empty-actions">
              <button class="primary" onClick={() => openNewHomebrewMonster()}>
                <PlusIcon />
                New monster
              </button>
              <button class="secondary" onClick={openImportDialog}>
                <ImportIcon />
                Import
              </button>
            </div>
          </div>
        </div>
      );
    }
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
        {remaining > 0 ? (
          <span>
            Showing {visible.length} of {matches.length}
          </span>
        ) : null}
      </div>
      {visible.map((match) => (
        <MonsterCard
          key={match.entry.path}
          match={match}
          here={fielded.get(match.entry.path) ?? 0}
        />
      ))}
      {remaining > 0 ? (
        <div class="library-more-bar">
          <button
            type="button"
            class="secondary compact-button"
            onClick={() => setLimit((prev) => prev + MAX_LIBRARY_RESULTS)}
          >
            Show {Math.min(remaining, MAX_LIBRARY_RESULTS)} more
          </button>
          {remaining > MAX_LIBRARY_RESULTS ? (
            <button type="button" class="text-button" onClick={() => setLimit(matches.length)}>
              Show all {matches.length}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LibraryColumn() {
  const ui = state.value.ui;
  const pasting = looksLikeImport(ui.search);
  const clearSearch = () => setSearch("");
  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (
      pasting &&
      pasteImportKeyDown(event, document.getElementById("libraryPasteImport"), clearSearch)
    ) {
      return;
    }
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
        <div class="library-heading-tools">
          <button
            type="button"
            class="secondary compact-button"
            title="Import homebrew monster, encounter, or share link"
            onClick={openImportDialog}
          >
            <ImportIcon />
            <span>Import</span>
          </button>
          <button
            type="button"
            class="secondary compact-button"
            title="Create a new homebrew monster"
            aria-label="New homebrew monster"
            onClick={() => openNewHomebrewMonster()}
          >
            <PlusIcon />
            <span>New</span>
          </button>
          <label class="search">
            <SearchIcon />
            <input
              id="prepLibrarySearch"
              placeholder="Name, ability, lv 2, ev<=12, or a share link…"
              value={ui.search}
              onKeyDown={onSearchKeyDown}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
        </div>
      </div>
      <FilterBar />
      {ui.filtersOpen ? <FiltersPanel /> : <ActiveFilterPills />}
      {pasting ? (
        <div class="monster-library panel" id="libraryPasteImport">
          <PasteImport text={ui.search} onDone={clearSearch} />
        </div>
      ) : (
        <LibraryList />
      )}
    </section>
  );
}
