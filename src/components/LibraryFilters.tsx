import { catalogBounds, facetOptions } from "../data.ts";
import type { FacetOption } from "../data.ts";
import {
  activeEncounter,
  isPartyLevelWindowActive,
  partyLevelWindow,
  setRangeFilter,
  state,
  toggleFacetValue,
  togglePartyLevelWindow,
} from "../store.ts";
import type { FacetKey } from "../types.ts";
import { CloseIcon } from "./Icons.tsx";

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
          type="button"
          class={`chip facet-chip ${selectedSet.has(value) ? "active" : ""}`}
          aria-pressed={selectedSet.has(value)}
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
  action,
}: {
  label: string;
  bounds: readonly [number, number];
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  action?: preact.JSX.Element | null;
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
      <div class="facet-label-row">
        <p class="facet-label">
          {label}{" "}
          <span class={`range-value ${constrained ? "range-value-active" : ""}`}>
            {constrained ? `${lowActive}–${highActive}` : `${lo}–${hi}`}
          </span>
        </p>
        {action}
      </div>
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

/** Shared collapsible facet panel used in both Prep and Quick Add. */
export function FiltersPanel({ compact = false }: { compact?: boolean }) {
  const ui = state.value.ui;
  const options = facetOptions.value;
  const bounds = catalogBounds.value;
  const party = activeEncounter().party;
  const [pLo, pHi] = partyLevelWindow(bounds.level);
  const partyWindowActive = isPartyLevelWindowActive(ui, bounds.level);
  const hasPartyWindow = pLo > bounds.level[0] || pHi < bounds.level[1];

  return (
    <div class={`filters-panel panel ${compact ? "filters-panel-compact" : ""}`}>
      <div class="facet-ranges">
        <DualRange
          label="Level"
          bounds={bounds.level}
          min={ui.levelMin}
          max={ui.levelMax}
          onChange={(min, max) => setRangeFilter("level", min, max)}
          action={
            hasPartyWindow ? (
              <button
                type="button"
                class={`range-preset ${partyWindowActive ? "active" : ""}`}
                aria-pressed={partyWindowActive}
                title={`Filter to levels ${pLo}–${pHi} (around party level ${party.level})`}
                onClick={() => togglePartyLevelWindow(bounds.level)}
              >
                Near party (Lv {pLo}–{pHi})
              </button>
            ) : null
          }
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

/** One-tap removable pills surfacing active "More" facets when the panel is collapsed. */
export function ActiveFilterPills() {
  const ui = state.value.ui;
  const options = facetOptions.value;
  const bounds = catalogBounds.value;

  const pills: { key: string; label: string; remove: () => void }[] = [];

  if (
    (ui.levelMin !== null || ui.levelMax !== null) &&
    !isPartyLevelWindowActive(ui, bounds.level)
  ) {
    const lo = ui.levelMin ?? bounds.level[0];
    const hi = ui.levelMax ?? bounds.level[1];
    pills.push({
      key: "level",
      label: lo === hi ? `Level ${lo}` : `Level ${lo}–${hi}`,
      remove: () => setRangeFilter("level", null, null),
    });
  }
  if (ui.evMin !== null || ui.evMax !== null) {
    const lo = ui.evMin ?? bounds.ev[0];
    const hi = ui.evMax ?? bounds.ev[1];
    pills.push({
      key: "ev",
      label: lo === hi ? `EV ${lo}` : `EV ${lo}–${hi}`,
      remove: () => setRangeFilter("ev", null, null),
    });
  }

  const labelLookup = (list: FacetOption[]) => new Map(list);
  const roleMap = labelLookup(options.roles);
  const sizeMap = labelLookup(options.sizes);
  const keywordMap = labelLookup(options.keywords);

  for (const val of ui.roles) {
    pills.push({
      key: `role:${val}`,
      label: roleMap.get(val) ?? val,
      remove: () => toggleFacetValue("roles", val),
    });
  }
  for (const val of ui.sizes) {
    pills.push({
      key: `size:${val}`,
      label: `Size ${sizeMap.get(val) ?? val}`,
      remove: () => toggleFacetValue("sizes", val),
    });
  }
  for (const val of ui.keywords) {
    pills.push({
      key: `kw:${val}`,
      label: keywordMap.get(val) ?? val,
      remove: () => toggleFacetValue("keywords", val),
    });
  }

  if (!pills.length) return null;

  return (
    <div class="active-filter-pills" role="group" aria-label="Active catalog filters">
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          class="active-filter-pill"
          title={`Remove ${pill.label} filter`}
          onClick={pill.remove}
        >
          <span>{pill.label}</span>
          <CloseIcon />
        </button>
      ))}
    </div>
  );
}
