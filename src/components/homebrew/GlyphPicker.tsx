import { useEffect, useId, useRef, useState } from "preact/hooks";
import { ABILITY_ICONS } from "../../lib/homebrew.ts";
import { CaretIcon } from "../Icons.tsx";
import { iconGlyph } from "../Statblock.tsx";

/**
 * Compact single-button glyph picker popover replacing the 10-button icon wall.
 * Renders the current Draw Steel glyph at rest and discloses all 10 options on demand.
 */
export function GlyphPicker({
  value,
  fallback = "*",
  ariaLabel = "Choose glyph",
  onChange,
}: {
  value: string | undefined;
  fallback?: string;
  ariaLabel?: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const normalizedValue = (value || "").replace(/\uFE0F/g, "");
  const currentMeta =
    ABILITY_ICONS.find((item) => item.emoji === normalizedValue) ?? ABILITY_ICONS[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const handleMenuKeyDown = (event: KeyboardEvent, idx: number) => {
    const count = ABILITY_ICONS.length;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      optionRefs.current[(idx + 1) % count]?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      optionRefs.current[(idx - 1 + count) % count]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[count - 1]?.focus();
    }
  };

  const toggle = () => {
    if (!open && wrapRef.current) {
      const scrollParent = wrapRef.current.closest<HTMLElement>(".hb-studio-form, .hb-modal-body");
      const rect = wrapRef.current.getBoundingClientRect();
      const boundsBottom = scrollParent
        ? scrollParent.getBoundingClientRect().bottom
        : window.innerHeight;
      setOpenUp(boundsBottom - rect.bottom < 190);
    }
    setOpen((prev) => !prev);
  };

  return (
    <div
      ref={wrapRef}
      class="hb-glyph-picker"
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (open && next && !wrapRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        class="hb-glyph-trigger"
        aria-label={`${ariaLabel}: ${currentMeta.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        title={`Glyph: ${currentMeta.label}`}
        onClick={toggle}
      >
        <span class="ds-glyph" aria-hidden="true">
          {iconGlyph(value, fallback)}
        </span>
        <CaretIcon class="hb-glyph-caret" />
      </button>

      {open ? (
        <div
          id={menuId}
          class={`hb-glyph-popover ${openUp ? "open-up" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {ABILITY_ICONS.map(({ emoji, label }, idx) => {
            const active = normalizedValue === emoji;
            return (
              <button
                key={emoji}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                type="button"
                role="option"
                aria-selected={active}
                class={`hb-glyph-option ${active ? "active" : ""}`}
                onKeyDown={(e) => handleMenuKeyDown(e, idx)}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span class="ds-glyph" aria-hidden="true">
                  {iconGlyph(emoji, fallback)}
                </span>
                <span class="hb-glyph-option-label">{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
