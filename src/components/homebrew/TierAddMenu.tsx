import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TierInsertChip, TierKey } from "../../lib/monsterCraft.ts";
import { CheckIcon, PlusIcon } from "../Icons.tsx";

/** The quiet "+" at the end of a tier line: drops a book clause (damage,
    potency, push, condition) into one tier or all three. */
export const TIER_LABELS: Record<TierKey, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};

export type TierAddScope = "tier" | "all";

export function TierAddMenu({
  tier,
  chips,
  scope,
  onScopeChange,
  onAdd,
}: {
  tier: TierKey;
  chips: readonly TierInsertChip[];
  scope: TierAddScope;
  onScopeChange: (next: TierAddScope) => void;
  onAdd: (tier: TierKey, chip: TierInsertChip, scope: TierAddScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const tierLabel = TIER_LABELS[tier];

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setJustAdded(null);
    if (returnFocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // Measure the rendered menu, flip it above the row when it would be clipped
  // by the studio's scroll pane, then move focus into it.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const wrap = wrapRef.current;
    if (!menu || !wrap) return;
    const pane = wrap
      .closest<HTMLElement>(".hb-studio-form, .hb-pg-scroll")
      ?.getBoundingClientRect();
    const top = pane?.top ?? 0;
    const bottom = pane?.bottom ?? window.innerHeight;
    const rect = wrap.getBoundingClientRect();
    const needed = menu.offsetHeight + 8;
    const below = bottom - rect.bottom;
    const above = rect.top - top;
    const flip = below < needed && above > below;
    setOpenUp(flip);
    // Phones: neither side fits, so scroll the pane until the whole menu is visible.
    if (!flip && below < needed) menu.scrollIntoView({ block: "nearest" });
    menu
      .querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!justAdded) return;
    const timer = window.setTimeout(() => setJustAdded(null), 1600);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ??
        [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % items.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  const add = (chip: TierInsertChip) => {
    onAdd(tier, chip, scope);
    setJustAdded(chip.id);
    setStatus(
      scope === "all"
        ? `Added ${chip.rangeLabel} across all tiers`
        : `Added ${chip.clauses[tier]} to ${tierLabel}`,
    );
  };

  const renderGroup = (group: TierInsertChip["group"], heading: string) => (
    <div class="hb-tier-add-group" role="group" aria-label={heading}>
      <span class="hb-field-label" aria-hidden="true">
        {heading}
      </span>
      <div class="hb-tier-chips">
        {chips
          .filter((chip) => chip.group === group)
          .map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              class={`hb-tier-chip ${justAdded === chip.id ? "added" : ""}`}
              onClick={() => add(chip)}
            >
              {scope === "all" ? chip.rangeLabel : chip.clauses[tier]}
              {justAdded === chip.id ? <CheckIcon /> : null}
            </button>
          ))}
      </div>
    </div>
  );

  return (
    <div
      ref={wrapRef}
      class="hb-tier-add-wrap"
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (open && next && !wrapRef.current?.contains(next)) close(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        class="hb-tier-add"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Add a condition or forced movement to ${tierLabel}`}
        title={`Add to ${tierLabel}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <PlusIcon />
      </button>
      <span class="sr-only" aria-live="polite">
        {status}
      </span>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          class={`hb-tier-add-menu ${openUp ? "open-up" : ""}`}
          role="menu"
          aria-label={`Add to ${tierLabel}`}
          onKeyDown={onMenuKeyDown}
        >
          <div class="hb-tier-add-scope" role="group" aria-label="Where to add">
            <button
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={scope === "tier"}
              class={scope === "tier" ? "active" : ""}
              onClick={() => onScopeChange("tier")}
            >
              {tierLabel} only
            </button>
            <button
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={scope === "all"}
              class={scope === "all" ? "active" : ""}
              onClick={() => onScopeChange("all")}
            >
              All tiers, scaled
            </button>
          </div>
          {renderGroup("condition", "Conditions")}
          {renderGroup("move", "Forced movement")}
          <p class="hb-tier-add-note">
            {scope === "all"
              ? "Potency steps weak, average, strong; movement grows a square per tier."
              : "Potency matches this tier. Clauses are added at the end."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
