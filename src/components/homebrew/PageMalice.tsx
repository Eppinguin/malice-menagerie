import { disclosureDetails } from "../../lib/disclosure.ts";
import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { allMaliceFeatures, officialFamilies } from "../../data.ts";
import { dedupeMaliceFeatures, featureText, isPriorMaliceGateway } from "../../lib/malice.ts";
import {
  addMaliceToFamily,
  customMaliceFamilies,
  deleteHomebrewMalice,
  newMaliceFamilySlug,
  openNewCustomMalice,
  state,
} from "../../store.ts";
import type { MaliceFeature } from "../../types.ts";
import { PersistentMaliceFeaturePreview } from "../combat/MaliceDock.tsx";
import { CaretIcon, CheckIcon, CloseIcon, PlusIcon, SearchIcon } from "../Icons.tsx";
import { homebrewToMaliceFeature } from "../../lib/homebrew.ts";

/** Names of families made this session that have no feature or saved
    monster yet, so an empty new family keeps the name it was given. */
const pendingLabels = new Map<string, string>();

/** Name a new custom family; returns its slug. */
export function startMaliceFamily(label: string): string {
  const slug = newMaliceFamilySlug(label);
  pendingLabels.set(slug, label);
  return slug;
}

/** What the page needs to know about the monster's family. */
export interface FamilyInfo {
  slug: string;
  label: string;
  custom: boolean;
}

export function familyInfo(familyPath: string): FamilyInfo {
  const slug = familyPath.toLowerCase().split("/").filter(Boolean)[0] ?? "";
  if (!slug) return { slug: "", label: "", custom: false };
  const custom = customMaliceFamilies.value.find((fam) => fam.slug === slug);
  if (custom) return { slug, label: custom.label, custom: true };
  const official = officialFamilies.value.find((fam) => fam.slug.toLowerCase() === slug);
  if (official) return { slug, label: official.label, custom: false };
  return { slug, label: pendingLabels.get(slug) ?? slug, custom: true };
}

/* ------------------------------------------------------------------ */
/* Family picker                                                       */
/* ------------------------------------------------------------------ */

type FamilyOption =
  | { kind: "create"; label: string; from: FamilyInfo | null }
  | { kind: "pick"; slug: string; label: string; count: number; group: "Yours" | "Official" };

/**
 * The family next to "Malice": a combobox. Type to filter; a name that isn't
 * a family yet is offered as "Create" (highlighted, so Enter makes it), with
 * "Create … from Gnoll" one arrow away when the monster is on an official
 * family.
 */
function FamilyPicker({
  family,
  onPick,
  onCreate,
}: {
  family: FamilyInfo;
  onPick: (slug: string) => void;
  /** Make a family named `label`, copying `fromSlug`'s Malice when given. */
  onCreate: (label: string, fromSlug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = "hb-family-list";

  const [place, setPlace] = useState("");
  // Focus lands before the next keystroke, and the list opens where it fits
  // inside the page: upward near the bottom, right-aligned near the edge.
  useLayoutEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const anchor = wrap.current?.getBoundingClientRect();
    const pane = wrap.current?.closest(".hb-pg-scroll")?.getBoundingClientRect();
    if (anchor && pane) {
      const up =
        pane.bottom - anchor.bottom < 330 && anchor.top - pane.top > pane.bottom - anchor.bottom;
      const right = anchor.left + 300 > pane.right - 8;
      setPlace(`${up ? " is-up" : ""}${right ? " is-right" : ""}`);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const close = (focusBack: boolean) => {
    setOpen(false);
    setQuery("");
    if (focusBack) btn.current?.focus();
  };

  const typed = query.trim();
  const q = typed.toLowerCase();
  const mine = customMaliceFamilies.value.filter(
    (fam) => !q || fam.label.toLowerCase().includes(q),
  );
  const official = officialFamilies.value.filter(
    (fam) => fam.maliceCount > 0 && (!q || fam.label.toLowerCase().includes(q)),
  );
  const exists =
    !!q &&
    (mine.some((fam) => fam.label.toLowerCase() === q) ||
      official.some((fam) => fam.label.toLowerCase() === q));
  const copyFrom = !family.custom && family.slug ? family : null;

  const options: FamilyOption[] = [
    ...(typed && !exists
      ? [
          { kind: "create" as const, label: typed, from: null },
          ...(copyFrom ? [{ kind: "create" as const, label: typed, from: copyFrom }] : []),
        ]
      : []),
    ...mine.map((fam) => ({
      kind: "pick" as const,
      slug: fam.slug,
      label: fam.label,
      count: fam.count,
      group: "Yours" as const,
    })),
    ...official.map((fam) => ({
      kind: "pick" as const,
      slug: fam.slug,
      label: fam.label,
      count: fam.maliceCount,
      group: "Official" as const,
    })),
  ];

  const choose = (opt: FamilyOption | undefined) => {
    if (!opt) return;
    if (opt.kind === "create") onCreate(opt.label, opt.from?.slug ?? null);
    else onPick(opt.slug);
    close(true);
  };

  return (
    <span
      class="hb-family"
      ref={wrap}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        class={`hb-family-btn${family.slug ? "" : " is-empty"}${family.custom ? " is-pen" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Malice family: ${family.label || "none"}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {family.label || "family"}
        <CaretIcon />
      </button>
      {family.slug ? (
        <button
          type="button"
          class="icon-button hb-family-clear"
          aria-label={`Remove ${family.label} Malice from this monster`}
          title="No family"
          onClick={() => onPick("")}
        >
          <CloseIcon />
        </button>
      ) : null}
      {open ? (
        <div class={`hb-family-pop${place}`}>
          <label class="hb-family-search">
            <SearchIcon />
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
              value={query}
              placeholder="Find or name a family"
              aria-label="Find or name a Malice family"
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(options.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(options[active]);
                }
              }}
            />
          </label>
          <ul class="hb-family-list" id={listId} role="listbox" aria-label="Families">
            {options.map((opt, i) => {
              const head =
                opt.kind === "pick" &&
                (i === 0 ||
                  options[i - 1]!.kind !== "pick" ||
                  (options[i - 1] as { group: string }).group !== opt.group);
              return (
                <Fragment key={opt.kind === "pick" ? opt.slug : `create-${opt.from?.slug ?? ""}`}>
                  {head ? (
                    <li class="hb-family-heading" role="presentation">
                      {(opt as { group: string }).group}
                    </li>
                  ) : null}
                  <li
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    class={[
                      i === active ? "is-active" : "",
                      opt.kind === "create" ? "is-create" : "",
                      opt.kind === "pick" && opt.slug === family.slug ? "is-current" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(opt)}
                  >
                    {opt.kind === "create" ? (
                      <>
                        <PlusIcon />
                        <strong>
                          Create “{opt.label}”{opt.from ? ` from ${opt.from.label}` : ""}
                        </strong>
                      </>
                    ) : (
                      <>
                        <strong>{opt.label}</strong>
                        <span>{opt.count}</span>
                      </>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The Malice section on the page                                      */
/* ------------------------------------------------------------------ */

export function PageMalice({
  familyPath,
  level,
  noteMark,
  preview,
  attachedIds,
  onSetFamily,
  onToggleAttached,
  onAttach,
  onBrowse,
}: {
  familyPath: string;
  level: number;
  noteMark: ComponentChildren;
  /** The monster's Malice as printed (official family and attached extras). */
  preview: ComponentChildren;
  attachedIds: readonly string[];
  onSetFamily: (slug: string, label: string) => void;
  onToggleAttached: (id: string, name: string) => void;
  onAttach: (id: string) => void;
  onBrowse: () => void;
}) {
  const family = familyInfo(familyPath);
  const records = state.value.homebrewMalice;
  const familyFeatures = family.custom
    ? records
        .filter((rec) => rec.family.trim().toLowerCase() === family.slug)
        .map(homebrewToMaliceFeature)
        .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
    : [];
  const users = customMaliceFamilies.value.find((fam) => fam.slug === family.slug)?.users ?? 0;
  const extras = records.filter(
    (rec) => !(family.custom && rec.family.trim().toLowerCase() === family.slug),
  );
  const attached = new Set(attachedIds);

  const create = (label: string, fromSlug: string | null) => {
    const slug = startMaliceFamily(label);
    if (fromSlug) {
      const source = dedupeMaliceFeatures(
        allMaliceFeatures.value.filter(
          (f) => f.scope === "family" && f.family === fromSlug && !isPriorMaliceGateway(f),
        ),
      );
      addMaliceToFamily(source, slug, label);
    }
    onSetFamily(slug, label);
  };

  const writeNew = () =>
    family.custom
      ? openNewCustomMalice({ family: family.slug, familyLabel: family.label, minLevel: 1 })
      : openNewCustomMalice({
          family: "",
          familyLabel: "Custom",
          minLevel: level,
          onSaved: onAttach,
        });

  return (
    <section class="hb-pg-malice" aria-label="Encounter Malice">
      <header class="hb-pg-malice-head">
        <span class="ds-glyph malice-skull" aria-hidden="true">
          d
        </span>
        <h3>Malice</h3>
        <FamilyPicker
          family={family}
          onPick={(slug) => onSetFamily(slug, slug ? familyInfo(slug).label : "")}
          onCreate={create}
        />
        {noteMark}
        <span class="hb-pg-malice-actions">
          <button type="button" class="text-button" onClick={onBrowse}>
            Browse
          </button>
          <button type="button" class="secondary compact-button" onClick={writeNew}>
            <PlusIcon />
            <span>New</span>
          </button>
        </span>
      </header>

      {family.custom ? (
        <>
          {users > 1 ? <p class="hb-pg-malice-shared">Shared by {users} monsters</p> : null}
          {familyFeatures.length ? (
            <ul class="hb-pg-family-features">
              {familyFeatures.map((feature) => {
                const rec = records.find((r) => r.id === feature.homebrewId);
                const from = rec?.origin?.sourceName;
                const gated = feature.minLevel > level;
                return (
                  <li key={feature.id} class={gated ? "is-gated" : undefined}>
                    <PersistentMaliceFeaturePreview feature={feature} scope="studio-family" />
                    <span class="hb-pg-family-note">
                      {from ? `from ${from}` : ""}
                      {gated ? `${from ? " · " : ""}level ${feature.minLevel}+` : ""}
                    </span>
                    <button
                      type="button"
                      class="icon-button hb-pgw-x"
                      aria-label={
                        users > 1
                          ? `Remove ${feature.name} from ${family.label}, used by ${users} monsters`
                          : `Remove ${feature.name} from ${family.label}`
                      }
                      title={
                        users > 1
                          ? `Removes it from ${family.label} for all ${users} monsters (Undo available)`
                          : "Remove from family (Undo available)"
                      }
                      onClick={() => feature.homebrewId && deleteHomebrewMalice(feature.homebrewId)}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="hb-pg-malice-empty">
              No Malice in {family.label} yet.{" "}
              <button type="button" class="text-button" onClick={onBrowse}>
                Browse
              </button>{" "}
              or{" "}
              <button type="button" class="text-button" onClick={writeNew}>
                write one
              </button>
            </p>
          )}
        </>
      ) : (
        preview
      )}

      {extras.length ? (
        <details
          class="hb-pg-malice-extras"
          {...disclosureDetails(
            "studio-malice-extras",
            extras.some((rec) => attached.has(rec.id)),
          )}
        >
          <summary>
            Extra custom Malice
            {attached.size ? <span> · {attached.size} on</span> : null}
          </summary>
          <ul class="hb-pg-malice-custom">
            {extras.map((rec) => (
              <li key={rec.id}>
                <label class={attached.has(rec.id) ? "is-on" : undefined}>
                  <input
                    type="checkbox"
                    checked={attached.has(rec.id)}
                    onChange={() => onToggleAttached(rec.id, rec.name)}
                  />
                  <span class="hb-pg-malice-cost">{rec.cost}</span>
                  <strong>{rec.name}</strong>
                  {rec.familyLabel ? <small>{rec.familyLabel}</small> : null}
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Browsing Malice into a family                                       */
/* ------------------------------------------------------------------ */

const PAGE = 30;

export function BrowseMalice({
  family,
  focusKey = 0,
  onUseFamily,
}: {
  family: FamilyInfo;
  focusKey?: number;
  /** Put the monster on an official family as printed. */
  onUseFamily: (slug: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey) searchRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  // What the family already holds, by the feature it was copied from.
  const inFamily = new Set(
    state.value.homebrewMalice
      .filter((rec) => rec.family.trim().toLowerCase() === family.slug)
      .map((rec) => rec.origin?.sourceId)
      .filter(Boolean),
  );

  const pool = useMemo(
    () =>
      dedupeMaliceFeatures(
        allMaliceFeatures.value.filter(
          (f) =>
            !isPriorMaliceGateway(f) &&
            !(f.isHomebrew && f.family === family.slug) &&
            (f.scope === "family" || f.isHomebrew),
        ),
      ).sort(
        (a, b) =>
          a.familyLabel.localeCompare(b.familyLabel) ||
          a.cost - b.cost ||
          a.name.localeCompare(b.name),
      ),
    [allMaliceFeatures.value, family.slug],
  );

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return pool;
    return pool.filter((f) => {
      const hay =
        `${f.name} ${f.familyLabel} ${f.keywords.join(" ")} ${featureText(f)}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [pool, query]);

  useEffect(() => {
    setLimit(PAGE);
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const sourceKey = (f: MaliceFeature) => (f.isHomebrew && f.homebrewId ? f.homebrewId : f.id);

  return (
    <div class="hb-browse">
      <div class="hb-browse-tools">
        <label class="hb-browse-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            placeholder="Name, family or effect"
            aria-label="Search Malice"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        {family.custom ? (
          <p class="hb-browse-into">
            Adding to <strong>{family.label}</strong>
          </p>
        ) : (
          <p class="hb-browse-into">
            To collect Malice of your own, name a new family in the picker above.
          </p>
        )}
      </div>
      <div class="hb-browse-list" ref={listRef}>
        {results.length === 0 ? (
          <div class="hb-browse-empty">
            <p>{pool.length ? "No Malice matches." : "Malice is still loading."}</p>
          </div>
        ) : null}
        {results.slice(0, limit).map((feature, i, shown) => {
          const head = i === 0 || shown[i - 1]!.familyLabel !== feature.familyLabel;
          const added = inFamily.has(sourceKey(feature));
          return (
            <Fragment key={feature.id}>
              {head ? (
                <h4 class="hb-browse-divider">
                  <span>{feature.familyLabel || "Custom"}</span>
                  {!feature.isHomebrew && feature.family !== family.slug ? (
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => onUseFamily(feature.family, feature.familyLabel)}
                    >
                      Use for this monster
                    </button>
                  ) : feature.family === family.slug ? (
                    <small>This monster's family</small>
                  ) : null}
                </h4>
              ) : null}
              <article class="hb-browse-item hb-browse-malice">
                <PersistentMaliceFeaturePreview feature={feature} scope="studio-browser" />
                <footer class="hb-browse-item-foot">
                  <span>
                    {feature.familyLabel}
                    <small>
                      {" "}
                      · {feature.costText || `${feature.cost} Malice`}
                      {feature.minLevel > 1 ? ` · level ${feature.minLevel}+` : ""}
                    </small>
                  </span>
                  {family.custom ? (
                    <button
                      type="button"
                      class={
                        added ? "secondary compact-button is-added" : "secondary compact-button"
                      }
                      aria-label={`Add ${feature.name} to ${family.label}`}
                      onClick={() => addMaliceToFamily([feature], family.slug, family.label)}
                    >
                      {added ? <CheckIcon /> : <PlusIcon />}
                      <span>{added ? "Added" : "Add"}</span>
                    </button>
                  ) : null}
                </footer>
              </article>
            </Fragment>
          );
        })}
        {results.length > limit ? (
          <button
            type="button"
            class="secondary compact-button hb-browse-more"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, results.length - limit)} more of {results.length - limit}
          </button>
        ) : null}
      </div>
    </div>
  );
}
