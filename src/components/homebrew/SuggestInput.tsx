import type { Ref } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { SuggestOption } from "../../lib/monsterSuggestions.ts";
import { CaretIcon } from "../Icons.tsx";

function normalizeOption(opt: string | SuggestOption): SuggestOption {
  return typeof opt === "string" ? { value: opt } : opt;
}

/**
 * Bestiary-styled autocomplete combobox that suggests Draw Steel book-formatted
 * values on focus and as you type while always allowing freeform custom input.
 * Supports both single-value fields (e.g. Distance, Malice family) and
 * comma-separated multi-token fields (e.g. Keywords, Immunities).
 */
export function SuggestInput({
  value,
  onChange,
  options,
  mode = "single",
  placeholder,
  inputRef,
  class: className,
  ariaLabel,
  dropdownIndicator = false,
}: {
  value: string;
  onChange: (next: string) => void;
  options: readonly (string | SuggestOption)[];
  mode?: "single" | "comma";
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  class?: string;
  ariaLabel?: string;
  dropdownIndicator?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const pendingLocalSync = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const internalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingLocalSync.current) {
      pendingLocalSync.current = false;
      return;
    }
    setText(value);
  }, [value]);

  useEffect(() => {
    pendingLocalSync.current = false;
  });

  const setMergedRef = (el: HTMLInputElement | null) => {
    internalRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef && typeof inputRef === "object") {
      (inputRef as { current: HTMLInputElement | null }).current = el;
    }
  };

  const normalized = useMemo(() => options.map(normalizeOption), [options]);

  const { query, priorTokens } = useMemo(() => {
    if (mode !== "comma") {
      return { query: text.trim().toLowerCase(), priorTokens: new Set<string>() };
    }
    const parts = text.split(",");
    const tail = (parts.pop() ?? "").trim().toLowerCase();
    const prior = new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean));
    return { query: tail, priorTokens: prior };
  }, [text, mode]);

  const filtered = useMemo(() => {
    const prefix: SuggestOption[] = [];
    const sub: SuggestOption[] = [];
    for (const opt of normalized) {
      const valLow = opt.value.toLowerCase();
      if (mode === "comma" && priorTokens.has(valLow)) continue;
      const labelLow = (opt.label ?? "").toLowerCase();
      const hintLow = (opt.hint ?? "").toLowerCase();
      if (!query) {
        prefix.push(opt);
      } else if (valLow.startsWith(query) || labelLow.startsWith(query)) {
        prefix.push(opt);
      } else if (valLow.includes(query) || labelLow.includes(query) || hintLow.includes(query)) {
        sub.push(opt);
      }
    }
    return [...prefix, ...sub].slice(0, 60);
  }, [normalized, query, mode, priorTokens]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  useEffect(() => {
    if (!open || !navigated) return;
    const activeEl = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [open, navigated, activeIndex]);

  const syncDirection = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const scrollParent = wrap.closest<HTMLElement>(
      ".hb-studio-form, .hb-modal-body, .hb-pg-scroll",
    );
    const rect = wrap.getBoundingClientRect();
    const boundsBottom = scrollParent
      ? scrollParent.getBoundingClientRect().bottom
      : window.innerHeight;
    const boundsTop = scrollParent ? scrollParent.getBoundingClientRect().top : 0;
    const spaceBelow = boundsBottom - rect.bottom;
    const spaceAbove = rect.top - boundsTop;
    setOpenUp(spaceBelow < 210 && spaceAbove > spaceBelow);
  };

  const openMenu = () => {
    syncDirection();
    setOpen(true);
    setNavigated(false);
  };

  const applyOption = (opt: SuggestOption) => {
    if (mode === "comma") {
      const parts = text
        .split(",")
        .slice(0, -1)
        .map((p) => p.trim())
        .filter(Boolean);
      parts.push(opt.value);
      const next = parts.join(", ");
      setText(next);
      pendingLocalSync.current = true;
      onChange(next);
      setActiveIndex(0);
      setNavigated(false);
      setOpen(false);
    } else {
      setText(opt.value);
      pendingLocalSync.current = true;
      onChange(opt.value);
      setNavigated(false);
      setOpen(false);
    }
  };

  const handleInput = (next: string) => {
    setText(next);
    pendingLocalSync.current = true;
    onChange(next);
    openMenu();
    setActiveIndex(0);
    setNavigated(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openMenu();
        setActiveIndex(0);
        setNavigated(true);
      } else if (filtered.length > 0) {
        setActiveIndex((idx) => (navigated ? (idx + 1) % filtered.length : 0));
        setNavigated(true);
      }
    } else if (event.key === "ArrowUp") {
      if (!open || filtered.length === 0) return;
      event.preventDefault();
      setActiveIndex((idx) =>
        navigated ? (idx - 1 + filtered.length) % filtered.length : filtered.length - 1,
      );
      setNavigated(true);
    } else if (event.key === "Enter" && open && navigated && filtered.length > 0) {
      const chosen = filtered[activeIndex];
      if (chosen) {
        event.preventDefault();
        applyOption(chosen);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setNavigated(false);
    }
  };

  const showMenu = open && filtered.length > 0;
  const activeOptionId = showMenu && navigated ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={wrapRef} class={`hb-suggest-wrap ${dropdownIndicator ? "has-caret" : ""}`}>
      <input
        ref={setMergedRef}
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls={listId}
        {...(activeOptionId ? { "aria-activedescendant": activeOptionId } : {})}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        {...(placeholder ? { placeholder } : {})}
        {...(className ? { class: className } : {})}
        value={text}
        onFocus={openMenu}
        onClick={openMenu}
        onBlur={() => {
          setOpen(false);
          setNavigated(false);
          setText(value);
        }}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {dropdownIndicator ? (
        <button
          type="button"
          class="hb-suggest-caret"
          tabIndex={-1}
          aria-label="Toggle suggestions"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) {
              setOpen(false);
            } else {
              internalRef.current?.focus();
              openMenu();
            }
          }}
        >
          <CaretIcon />
        </button>
      ) : null}
      {showMenu ? (
        <ul
          ref={listRef}
          id={listId}
          class={`hb-suggest-menu ${openUp ? "open-up" : ""}`}
          role="listbox"
        >
          {filtered.map((opt, idx) => (
            <li
              key={`${opt.value}-${idx}`}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={navigated && idx === activeIndex}
              class={`hb-suggest-item ${navigated && idx === activeIndex ? "active" : ""}`}
              onMouseEnter={() => {
                setActiveIndex(idx);
                setNavigated(true);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                applyOption(opt);
              }}
            >
              <span class="hb-suggest-main">{opt.label ?? opt.value}</span>
              {opt.hint ? <small class="hb-suggest-hint">{opt.hint}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
