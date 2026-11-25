import type { Ref } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import {
  type CompendiumTerm,
  detectRuleTrigger,
  type InlineRuleTrigger,
  matchGlossaryTerms,
  segmentCompendiumTerms,
} from "../../lib/compendiumLinks.ts";
import { sourceRef } from "../../lib/repo.ts";
import { loadRule, type RuleDoc } from "../../lib/rulePreview.ts";

/**
 * Measure the pixel offset `(top, left)` of `cursorIndex` inside a `<textarea>`
 * or `<input>` so the suggestion card anchors by the caret and flips upward
 * near the bottom edge of scroll containers to avoid clipping.
 */
function measureCaretOffset(
  el: HTMLTextAreaElement | HTMLInputElement,
  cursorIndex: number,
): { top: number; left: number; openUp: boolean } {
  const style = getComputedStyle(el);
  const isTextarea = el.tagName === "TEXTAREA";
  const mirror = document.createElement("div");
  const props = [
    "boxSizing",
    "width",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "textTransform",
    "wordSpacing",
  ] as const;

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = isTextarea ? "pre-wrap" : "pre";
  mirror.style.overflowWrap = isTextarea ? "break-word" : "normal";
  for (const prop of props) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.width = `${el.clientWidth}px`;

  const textBefore = el.value.slice(0, cursorIndex);
  mirror.textContent = textBefore;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
  const rawTop = marker.offsetTop - el.scrollTop + lineHeight + 6;
  const rawLeft = marker.offsetLeft - el.scrollLeft;
  document.body.removeChild(mirror);

  const menuWidth = Math.min(320, el.clientWidth || 320);
  const maxLeft = Math.max(0, el.clientWidth - menuWidth);

  const scrollParent = el.closest<HTMLElement>(".hb-studio-form, .hb-modal-body");
  const rect = el.getBoundingClientRect();
  const boundsBottom = scrollParent
    ? scrollParent.getBoundingClientRect().bottom
    : window.innerHeight;
  const boundsTop = scrollParent ? scrollParent.getBoundingClientRect().top : 0;
  const spaceBelow = boundsBottom - rect.bottom;
  const spaceAbove = rect.top - boundsTop;
  const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;

  return {
    top: Math.max(24, Math.min(el.offsetHeight + 4, rawTop)),
    left: Math.max(0, Math.min(maxLeft, rawLeft)),
    openUp,
  };
}

/** Preserve leading capitalization when user typed e.g. "Frightened" or "Prone". */
/** The category the current monster's own name is offered under. */
const MONSTER_NAME_CATEGORY = "This monster";

/** The monster's own name as suggestion terms, ahead of the rules. */
function useWithMonsterNames(
  glossary: readonly CompendiumTerm[],
  names: readonly string[] | undefined,
): readonly CompendiumTerm[] {
  const key = (names ?? []).join("|");
  return useMemo(() => {
    const extra = key
      .split("|")
      .map((n) => n.trim())
      .filter((n) => n.length >= 4)
      .map((label) => ({ label, href: "", category: MONSTER_NAME_CATEGORY, count: 999 }));
    return extra.length ? [...extra, ...glossary] : glossary;
  }, [glossary, key]);
}

function applyTypedCasing(typed: string, canonical: string): string {
  const cleanTyped = typed.trim();
  if (
    cleanTyped.length > 0 &&
    cleanTyped[0] === cleanTyped[0]?.toUpperCase() &&
    cleanTyped[0] !== cleanTyped[0]?.toLowerCase() &&
    canonical[0] === canonical[0]?.toLowerCase()
  ) {
    return canonical[0]!.toUpperCase() + canonical.slice(1);
  }
  return canonical;
}

function HighlightBackdrop({
  value,
  glossary,
  multiline,
  backdropRef,
}: {
  value: string;
  glossary: readonly CompendiumTerm[];
  multiline: boolean;
  backdropRef: { current: HTMLDivElement | null };
}) {
  const segments = useMemo(() => segmentCompendiumTerms(value, glossary), [value, glossary]);
  return (
    <div
      ref={backdropRef}
      class={`hb-rule-backdrop ${multiline ? "is-multiline" : "is-singleline"}`}
      aria-hidden="true"
    >
      <div class="hb-rule-backdrop-content">
        {segments.map((seg, i) =>
          seg.term ? (
            <mark key={i} class="hb-inline-rule-mark">
              {seg.text}
            </mark>
          ) : (
            seg.text
          ),
        )}
        {multiline && value.endsWith("\n") ? "\u200b" : null}
      </div>
    </div>
  );
}

function NotionRulePopover({
  id,
  trigger,
  matches,
  activeIndex,
  caretPos,
  onHoverIndex,
  onSelect,
}: {
  id: string;
  trigger: InlineRuleTrigger;
  matches: readonly CompendiumTerm[];
  activeIndex: number;
  caretPos: { top: number; left: number; openUp: boolean };
  onHoverIndex: (idx: number) => void;
  onSelect: (term: CompendiumTerm) => void;
}) {
  const activeTerm = matches[activeIndex];
  const [previewDoc, setPreviewDoc] = useState<RuleDoc | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    setPreviewDoc(null);
    if (!activeTerm) {
      setPreviewLoading(false);
      return;
    }
    const ref = sourceRef(activeTerm.href);
    if (!ref) {
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void loadRule(ref.path)
        .then((doc) => {
          if (cancelled) return;
          setPreviewDoc(doc);
          setPreviewLoading(false);
        })
        .catch(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 70);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTerm?.href]);

  const posStyle = caretPos.openUp
    ? { bottom: "calc(100% + 6px)", left: `${caretPos.left}px` }
    : { top: `${caretPos.top}px`, left: `${caretPos.left}px` };

  return (
    <div
      class={`hb-notion-popover ${trigger.kind === "word" ? "is-passive" : ""} ${caretPos.openUp ? "open-up" : ""}`}
      style={posStyle}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div class="hb-notion-head">
        <span>{trigger.kind === "explicit" ? "Draw Steel rules" : "Rule reference"}</span>
        <small>Enter to insert · Esc</small>
      </div>
      <ul id={id} class="hb-notion-list" role="listbox">
        {matches.map((term, idx) => {
          const active = idx === activeIndex;
          return (
            <li
              key={`${term.label}-${term.href}`}
              id={`${id}-opt-${idx}`}
              role="option"
              aria-selected={active}
              class={`hb-notion-item ${active ? "active" : ""}`}
              onMouseEnter={() => onHoverIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(term);
              }}
            >
              <span class="hb-notion-term">{term.label}</span>
              <span class="hb-notion-meta">
                <span class="hb-notion-cat">{term.category}</span>
                {active ? <kbd class="hb-kbd">Enter</kbd> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {activeTerm ? (
        <div class="hb-notion-preview">
          {previewDoc?.html ? (
            <div
              class="hb-notion-preview-body"
              dangerouslySetInnerHTML={{ __html: previewDoc.html }}
            />
          ) : (
            <span class="hb-notion-preview-loading">
              {previewLoading ? `Loading ${activeTerm.label}…` : `${activeTerm.category} rule`}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared hook powering inline rule lookup and plain-prose insertion on both
 * `<textarea>` and `<input>`. Compendium links resolve automatically in the
 * live statblock preview and on save so inputs stay clean Draw Steel prose.
 * Passive word matches never hijack `Tab` focus traversal.
 */
function useRuleAutocomplete(
  elRef: { current: HTMLTextAreaElement | HTMLInputElement | null },
  value: string,
  onChange: (next: string) => void,
  glossary: readonly CompendiumTerm[],
) {
  const [trigger, setTrigger] = useState<InlineRuleTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [caretPos, setCaretPos] = useState<{ top: number; left: number; openUp: boolean }>({
    top: 36,
    left: 0,
    openUp: false,
  });

  const matches = useMemo(
    () => (trigger ? matchGlossaryTerms(glossary, trigger.query, trigger.kind, 7) : []),
    [glossary, trigger],
  );

  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(0);
  }, [matches.length, activeIndex]);

  // Dismiss any open rule popover if external Undo/Redo replaces the text underneath it.
  useEffect(() => {
    if (!trigger) return;
    const slice = value.slice(trigger.start, trigger.end);
    const matchesExpected =
      trigger.kind === "explicit"
        ? slice === `@${trigger.query}` ||
          slice === `[${trigger.query}` ||
          slice === `[[${trigger.query}`
        : slice === trigger.query;
    if (!matchesExpected) {
      setTrigger(null);
      setNavigated(false);
    }
  }, [value, trigger]);

  const syncTrigger = (el: HTMLTextAreaElement | HTMLInputElement, nextVal: string) => {
    const cursor = el.selectionStart ?? nextVal.length;
    const found = detectRuleTrigger(nextVal, cursor, glossary);
    if (!found) {
      setTrigger(null);
      setNavigated(false);
      setDismissedStart(null);
      return;
    }
    if (found.kind === "word" && dismissedStart === found.start) {
      setTrigger(null);
      return;
    }
    if (found.kind === "explicit") setDismissedStart(null);
    setTrigger(found);
    setActiveIndex(0);
    setNavigated(false);
    setCaretPos(measureCaretOffset(el, cursor));
  };

  const acceptTerm = (term: CompendiumTerm) => {
    const el = elRef.current;
    const start = trigger ? trigger.start : (el?.selectionStart ?? value.length);
    const end = trigger ? trigger.end : (el?.selectionEnd ?? value.length);
    // The monster's name follows how it was started: "the abyssal hyena"
    // mid-sentence, "Ajax" as a proper name.
    const typedLower = trigger?.kind === "word" && /^[a-z]/.test(trigger.query.trim());
    const inserted =
      term.category === MONSTER_NAME_CATEGORY
        ? typedLower
          ? term.label.toLowerCase()
          : term.label
        : trigger?.kind === "word"
          ? applyTypedCasing(trigger.query, term.label)
          : term.label;
    const next = value.slice(0, start) + inserted + value.slice(end);
    const nextCursor = start + inserted.length;
    onChange(next);
    setTrigger(null);
    setNavigated(false);
    setDismissedStart(null);

    requestAnimationFrame(() => {
      const target = elRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!trigger || !matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setNavigated(true);
      setActiveIndex((idx) => (idx + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setNavigated(true);
      setActiveIndex((idx) => (idx - 1 + matches.length) % matches.length);
    } else if (event.key === "Tab") {
      const chosen = matches[activeIndex];
      if (chosen) {
        event.preventDefault();
        acceptTerm(chosen);
      }
    } else if (event.key === "Enter") {
      const chosen = matches[activeIndex];
      if (chosen) {
        event.preventDefault();
        acceptTerm(chosen);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (trigger.kind === "word") setDismissedStart(trigger.start);
      setTrigger(null);
      setNavigated(false);
    }
  };

  return {
    trigger,
    matches,
    activeIndex,
    navigated,
    caretPos,
    setActiveIndex,
    syncTrigger,
    acceptTerm,
    handleKeyDown,
    close: () => {
      setTrigger(null);
      setNavigated(false);
    },
  };
}

/**
 * Single-line rule-aware `<input>` for Trigger and Tier 1–3 outcomes.
 * Auto-linked compendium terms are styled inline right inside the field.
 */
export function RuleInlineInput({
  value,
  onChange,
  glossary,
  inputRef,
  onFocus,
  placeholder,
  ariaLabel,
  names,
}: {
  value: string;
  onChange: (next: string) => void;
  glossary: readonly CompendiumTerm[];
  inputRef?: Ref<HTMLInputElement>;
  onFocus?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  /** The monster's own name, offered while writing its abilities. */
  names?: readonly string[];
}) {
  const listId = useId();
  const internalRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const setMergedRef = (el: HTMLInputElement | null) => {
    internalRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef && typeof inputRef === "object") {
      (inputRef as { current: HTMLInputElement | null }).current = el;
    }
  };

  const syncScroll = () => {
    const el = internalRef.current;
    const bg = backdropRef.current;
    if (el && bg) {
      bg.scrollLeft = el.scrollLeft;
    }
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const ac = useRuleAutocomplete(
    internalRef,
    value,
    onChange,
    useWithMonsterNames(glossary, names),
  );
  const showPopover = Boolean(ac.trigger && ac.matches.length);

  return (
    <div class="hb-rule-inline-wrap">
      <div class="hb-rule-highlight-box is-singleline">
        <HighlightBackdrop
          value={value}
          glossary={glossary}
          multiline={false}
          backdropRef={backdropRef}
        />
        <input
          ref={setMergedRef}
          type="text"
          class="hb-rule-overlay-input"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded={showPopover}
          aria-controls={listId}
          {...(showPopover ? { "aria-activedescendant": `${listId}-opt-${ac.activeIndex}` } : {})}
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
          {...(placeholder ? { placeholder } : {})}
          value={value}
          onFocus={() => {
            onFocus?.();
            syncScroll();
          }}
          onBlur={ac.close}
          onScroll={syncScroll}
          onKeyUp={syncScroll}
          onClick={syncScroll}
          onInput={(e) => {
            const el = e.currentTarget;
            onChange(el.value);
            ac.syncTrigger(el, el.value);
            requestAnimationFrame(syncScroll);
          }}
          onKeyDown={ac.handleKeyDown}
        />
      </div>
      {showPopover && ac.trigger ? (
        <NotionRulePopover
          id={listId}
          trigger={ac.trigger}
          matches={ac.matches}
          activeIndex={ac.activeIndex}
          caretPos={ac.caretPos}
          onHoverIndex={ac.setActiveIndex}
          onSelect={ac.acceptTerm}
        />
      ) : null}
    </div>
  );
}

/**
 * Multiline prose `<textarea>` with inline styled linked terms, caret-anchored
 * `@` rule lookup, and live Draw Steel rule previews.
 */
export function RuleTextEditor({
  value,
  onChange,
  glossary,
  rows = 2,
  placeholder,
  ariaLabel,
  names,
}: {
  value: string;
  onChange: (next: string) => void;
  glossary: readonly CompendiumTerm[];
  rows?: number;
  placeholder?: string;
  ariaLabel?: string;
  /** The monster's own name, offered while writing its abilities. */
  names?: readonly string[];
}) {
  const listId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    const el = areaRef.current;
    const bg = backdropRef.current;
    if (el && bg) {
      bg.scrollTop = el.scrollTop;
      bg.scrollLeft = el.scrollLeft;
    }
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const ac = useRuleAutocomplete(areaRef, value, onChange, useWithMonsterNames(glossary, names));
  const showPopover = Boolean(ac.trigger && ac.matches.length);

  return (
    <div class="hb-rule-editor">
      <div class="hb-rule-inline-wrap">
        <div class="hb-rule-highlight-box is-multiline">
          <HighlightBackdrop
            value={value}
            glossary={glossary}
            multiline={true}
            backdropRef={backdropRef}
          />
          <textarea
            ref={areaRef}
            class="hb-rule-overlay-input"
            role="combobox"
            rows={rows}
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded={showPopover}
            aria-controls={listId}
            {...(showPopover ? { "aria-activedescendant": `${listId}-opt-${ac.activeIndex}` } : {})}
            data-gramm="false"
            {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
            {...(placeholder ? { placeholder } : {})}
            value={value}
            onFocus={syncScroll}
            onScroll={syncScroll}
            onKeyUp={syncScroll}
            onClick={syncScroll}
            onInput={(e) => {
              const el = e.currentTarget;
              onChange(el.value);
              ac.syncTrigger(el, el.value);
              requestAnimationFrame(syncScroll);
            }}
            onKeyDown={ac.handleKeyDown}
            onBlur={ac.close}
          />
        </div>

        {showPopover && ac.trigger ? (
          <NotionRulePopover
            id={listId}
            trigger={ac.trigger}
            matches={ac.matches}
            activeIndex={ac.activeIndex}
            caretPos={ac.caretPos}
            onHoverIndex={ac.setActiveIndex}
            onSelect={ac.acceptTerm}
          />
        ) : null}
      </div>

      <span class="hb-prose-tip">
        Type <code>@</code> to look up rules · underlined words link automatically
      </span>
    </div>
  );
}
