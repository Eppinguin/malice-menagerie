import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { allCatalog, monstersVersion } from "../../data.ts";
import {
  ABILITY_CATEGORIES,
  buildAbilityIndex,
  cloneAbilityForLevel,
  filterAbilityIndex,
  type AbilityCategory,
  type IndexedAbility,
} from "../../lib/abilityIndex.ts";
import type { Monster, MonsterFeature } from "../../types.ts";
import { CheckIcon, PlusIcon, SearchIcon } from "../Icons.tsx";
import { PenSwitch } from "../Pen.tsx";
import { StatblockBody } from "../Statblock.tsx";

const PAGE = 24;
const NEAR_LEVELS = 2;

/**
 * The facing page's ability list: browse every official ability for ideas, printed in full as the book prints
 * it and already scaled to this monster's level. It opens on monsters like
 * this one (same role, nearby level); Add drops the ability on the page and
 * the sheet stays open for the next.
 */
export function BrowseAbilities({
  draftId,
  level,
  role,
  onAdd,
  onOpen,
  focusKey = 0,
  have = [],
}: {
  draftId: string;
  level: number;
  role: string;
  onAdd: (feature: MonsterFeature, sourceName: string) => void;
  /** Read an ability's whole statblock beside the page. */
  onOpen?: (path: string) => void;
  /** Bumped to move focus into the search (e.g. from a Browse button). */
  focusKey?: number;
  /** Names of abilities the monster already has; not offered again. */
  have?: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AbilityCategory>("all");
  const [likeYours, setLikeYours] = useState(true);
  const [scale, setScale] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey) searchRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const haveKey = have.map((n) => n.trim().toLowerCase()).join("|");
  const index = useMemo(() => {
    const owned = new Set(haveKey.split("|").filter(Boolean));
    return buildAbilityIndex(allCatalog.value, draftId).filter(
      (item) => !owned.has(item.nameLower),
    );
  }, [allCatalog.value, monstersVersion.value, draftId, haveKey]);

  const searching = query.trim() !== "";
  const isLike = (item: IndexedAbility) => {
    const roleLower = role.trim().toLowerCase();
    return (
      (!roleLower || item.monster.role.toLowerCase() === roleLower) &&
      Math.abs(item.monster.level - level) <= NEAR_LEVELS
    );
  };

  // Browsing, "Like yours" narrows the list. Searching, it only decides what
  // comes first: a monster you name is always found, like yours or not.
  const { results, likeCount } = useMemo(() => {
    const found = filterAbilityIndex(index, { query, category, onlyHomebrew: false });
    if (!searching) {
      const list = likeYours ? found.filter(isLike) : found;
      list.sort(
        (a, b) =>
          Math.abs(a.monster.level - level) - Math.abs(b.monster.level - level) ||
          a.nameLower.localeCompare(b.nameLower),
      );
      return { results: list, likeCount: list.length };
    }
    if (!likeYours) return { results: found, likeCount: found.length };
    const like = found.filter(isLike);
    const other = found.filter((item) => !isLike(item));
    return { results: [...like, ...other], likeCount: like.length };
  }, [index, query, category, likeYours, role, level]);

  const loaded = allCatalog.value.filter((e) => e.monster).length;
  const total = allCatalog.value.length;

  useEffect(() => {
    setLimit(PAGE);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, category, likeYours]);

  const add = (item: IndexedAbility, feature: MonsterFeature) => {
    onAdd(feature, item.monster.name);
    setAdded((prev) => new Set(prev).add(item.key));
  };

  const likeLabel = `${role || "Any role"} · level ${Math.max(0, level - NEAR_LEVELS)}–${
    level + NEAR_LEVELS
  }`;

  return (
    <div class="hb-browse">
      <div class="hb-browse-tools">
        <label class="hb-browse-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            placeholder="Name, keyword or effect"
            aria-label="Search abilities"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        <div class="hb-browse-chips" role="group" aria-label="Kind">
          {ABILITY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              class="chip"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.id === "villain" ? "Villain" : c.label}
            </button>
          ))}
        </div>
        <div class="hb-browse-row">
          <div class="hb-browse-scope" role="radiogroup" aria-label="Which monsters">
            <button
              type="button"
              role="radio"
              aria-checked={likeYours}
              onClick={() => setLikeYours(true)}
            >
              {likeLabel}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!likeYours}
              onClick={() => setLikeYours(false)}
            >
              All monsters
            </button>
          </div>
          <PenSwitch
            seed="browse-scale"
            checked={scale}
            onChange={setScale}
            label={`Scale to level ${level}`}
          />
        </div>
        {loaded < total ? (
          <p class="hb-browse-loading" role="status">
            Loading statblocks {loaded}/{total}
          </p>
        ) : null}
      </div>

      <div class="hb-browse-list" ref={listRef}>
        {results.length === 0 ? (
          <div class="hb-browse-empty">
            <p>
              {index.length === 0
                ? "Statblocks are still loading."
                : likeYours && !searching
                  ? `Nothing here for a ${likeLabel.toLowerCase()}.`
                  : "No ability matches."}
            </p>
            {likeYours && !searching && index.length ? (
              <button
                type="button"
                class="secondary compact-button"
                onClick={() => setLikeYours(false)}
              >
                Show every monster
              </button>
            ) : null}
          </div>
        ) : null}
        {results.slice(0, limit).map((item, i) => (
          <Fragment key={item.key}>
            {searching && likeYours && likeCount > 0 && i === likeCount ? (
              <h4 class="hb-browse-divider">Other monsters</h4>
            ) : null}
            <BrowseItem
              item={item}
              level={level}
              scale={scale}
              added={added.has(item.key)}
              onAdd={add}
              onOpen={onOpen}
            />
          </Fragment>
        ))}
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

function BrowseItem({
  item,
  level,
  scale,
  added,
  onAdd,
  onOpen,
}: {
  item: IndexedAbility;
  level: number;
  scale: boolean;
  added: boolean;
  onAdd: (item: IndexedAbility, feature: MonsterFeature) => void;
  onOpen?: ((path: string) => void) | undefined;
}) {
  const rescaled = scale && item.monster.level !== level;
  const feature = useMemo(() => cloneAbilityForLevel(item, level, scale), [item, level, scale]);
  // Scaled numbers print in pen, as a rescaled statblock does on the board,
  // so the card shows exactly what Add puts on the page.
  const shown: Monster = useMemo(() => {
    const m: Monster = { ...item.monster, features: [feature] };
    if (rescaled) m.printed = { ...item.monster, features: [item.feature] };
    else delete m.printed;
    return m;
  }, [item, feature, rescaled]);
  const name = item.feature.name ?? "ability";
  return (
    <article class="hb-browse-item">
      <StatblockBody monster={shown} interactive={false} />
      <footer class="hb-browse-item-foot">
        <span>
          {onOpen ? (
            <button
              type="button"
              class="text-button hb-browse-source"
              title="Read the whole statblock beside your page"
              onClick={() => onOpen(item.monster.path)}
            >
              {item.monster.name}
            </button>
          ) : (
            item.monster.name
          )}
          <small>
            {" "}
            · Level {item.monster.level} {item.monster.organization} {item.monster.role}
          </small>
        </span>
        <button
          type="button"
          class={added ? "secondary compact-button is-added" : "secondary compact-button"}
          aria-label={`Add ${name} from ${item.monster.name}${rescaled ? `, scaled to level ${level}` : ""}`}
          onClick={() => onAdd(item, feature)}
        >
          {added ? <CheckIcon /> : <PlusIcon />}
          <span>{added ? "Added" : "Add"}</span>
        </button>
      </footer>
    </article>
  );
}
