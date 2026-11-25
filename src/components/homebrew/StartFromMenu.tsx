import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { allCatalog, loadMonster, monstersVersion } from "../../data.ts";
import { matchCatalogEntry, parseQuery } from "../../lib/browse.ts";
import type { Monster } from "../../types.ts";
import { CaretIcon, SearchIcon } from "../Icons.tsx";

/**
 * The studio header's "Start from…": lay a whole statblock (or just its
 * numbers) over the draft, take the book's numbers for this level,
 * organization and role, or the role's starter abilities. Every pick is one
 * undo step. "Open" sets a statblock beside the page to read before taking
 * anything, and keeps the search for the next one.
 */
export function StartFromMenu({
  draftId,
  identity,
  statsMatchBook,
  onBookStats,
  onRoleKit,
  onStatblock,
  onOpen,
  onBrowse,
}: {
  draftId: string;
  /** "Level 2 Minion Brute". */
  identity: string;
  statsMatchBook: boolean;
  onBookStats: () => void;
  onRoleKit: () => void;
  onStatblock: (monster: Monster, statsOnly: boolean) => void;
  /** Read a statblock in full beside the page. */
  onOpen: (path: string, query: string) => void;
  /** Browse every statblock (or every match for the search) beside the page. */
  onBrowse: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const { shown: results, total } = useMemo(() => {
    if (!open) return { shown: [], total: 0 };
    const parsed = parseQuery(query);
    const found = [];
    for (const entry of allCatalog.value) {
      if (entry.monster?.homebrewId === draftId) continue;
      const m = matchCatalogEntry(entry, parsed);
      if (m) found.push(m);
    }
    found.sort(
      (a, b) =>
        (parsed.words.length ? b.score - a.score : 0) ||
        a.entry.derivedName.localeCompare(b.entry.derivedName),
    );
    return { shown: found, total: found.length };
  }, [open, query, allCatalog.value, monstersVersion.value, draftId]);

  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) setActive(0);
    lastQuery.current = query;
  }, [query]);

  useEffect(() => {
    list.current?.querySelector("li.is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = (focusBack: boolean, keepQuery = false) => {
    setOpen(false);
    if (!keepQuery) setQuery("");
    setError("");
    if (focusBack) button.current?.focus();
  };

  const look = (path: string) => {
    close(false, true);
    onOpen(path, query);
  };

  const take = async (path: string, statsOnly: boolean) => {
    setBusy(path);
    setError("");
    try {
      const monster = await loadMonster(path);
      onStatblock(monster, statsOnly);
      close(true);
    } catch {
      setError("That statblock didn't load. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      class="hb-start"
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
        ref={button}
        type="button"
        class="secondary compact-button hb-start-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span>Start from</span>
        <CaretIcon />
      </button>
      {open ? (
        <div class="hb-start-pop" role="dialog" aria-label="Start from">
          <label class="hb-start-search">
            <SearchIcon />
            <input
              ref={input}
              type="text"
              placeholder="A statblock"
              aria-label="Search statblocks to copy"
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  const hit = results[active];
                  if (hit) {
                    e.preventDefault();
                    if (e.ctrlKey || e.metaKey) look(hit.entry.path);
                    else void take(hit.entry.path, e.shiftKey);
                  }
                }
              }}
            />
          </label>
          {error ? (
            <p class="hb-start-error" role="alert">
              {error}
            </p>
          ) : null}
          <ul class="hb-start-list" ref={list} role="listbox" aria-label="Statblocks">
            {results.map((r, i) => {
              const m = r.entry.monster;
              return (
                <li
                  key={r.entry.path}
                  role="option"
                  aria-selected={i === active}
                  class={i === active ? "is-active" : undefined}
                  onMouseEnter={() => setActive(i)}
                >
                  <button
                    type="button"
                    class="hb-start-take"
                    disabled={busy !== null}
                    onClick={() => void take(r.entry.path, false)}
                  >
                    <strong>{m?.name ?? r.entry.derivedName}</strong>
                    {m ? (
                      <span>
                        {m.level} {m.organization} {m.role}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    class="text-button hb-start-stats"
                    title="Read it beside your page first (Ctrl+Enter)"
                    disabled={busy !== null}
                    onClick={() => look(r.entry.path)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    class="text-button hb-start-stats"
                    title="Copy only its numbers (Shift+Enter)"
                    disabled={busy !== null}
                    onClick={() => void take(r.entry.path, true)}
                  >
                    Stats
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            class="hb-start-browse"
            onClick={() => {
              close(false, true);
              onBrowse(query);
            }}
          >
            {query.trim()
              ? `Browse the ${total} ${total === 1 ? "match" : "matches"}`
              : `Browse all ${total} statblocks`}
            <span aria-hidden="true">→</span>
          </button>
          <div class="hb-start-book">
            <button
              type="button"
              disabled={statsMatchBook}
              onClick={() => {
                onBookStats();
                close(true);
              }}
            >
              <strong>Book stats</strong>
              <span>{identity}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onRoleKit();
                close(true);
              }}
            >
              <strong>Starter abilities</strong>
              <span>{identity}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
