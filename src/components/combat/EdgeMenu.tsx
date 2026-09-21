import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { EdgeState } from "../../types.ts";

const HOLD_MS = 450;
const MOVE_TOLERANCE_PX = 12;

interface MenuState {
  x: number;
  y: number;
  onPick: (edge: EdgeState) => void;
}

const menuState = signal<MenuState | null>(null);

export function openEdgeMenu(x: number, y: number, onPick: (edge: EdgeState) => void): void {
  menuState.value = { x, y, onPick };
}

export function closeEdgeMenu(): void {
  menuState.value = null;
}

export interface PressMods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Tap-or-hold press handling for roll buttons. A quick tap calls `onTap`
 * (with the click modifiers, so ⌘/Ctrl+click etc. keep working); holding
 * still for HOLD_MS opens the edge/bane menu, and the release click after a
 * hold is swallowed so it never double-rolls. Plain factory (no hooks), so it
 * can be spread onto any button during render.
 */
export function rollPress(
  onTap: (event: PressMods) => void,
  onPick: (edge: EdgeState) => void,
) {
  let timer: number | undefined;
  let startX = 0;
  let startY = 0;
  let firedAt = 0;
  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    onPointerDown: (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      const x = event.clientX;
      const y = event.clientY;
      timer = window.setTimeout(() => {
        timer = undefined;
        firedAt = Date.now();
        openEdgeMenu(x, y, onPick);
      }, HOLD_MS);
    },
    onPointerMove: (event: PointerEvent): void => {
      if (
        timer !== undefined &&
        Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX
      )
        cancel();
    },
    onPointerUp: (): void => cancel(),
    onPointerCancel: (): void => cancel(),
    onClick: (event: MouseEvent): void => {
      if (Date.now() - firedAt < 750) return;
      onTap(event);
    },
    // Mobile browsers fire a callout/magnifier on longpress; these buttons
    // have no selectable content worth preserving.
    onContextMenu: (event: Event): void => event.preventDefault(),
  };
}

const OPTIONS: { edge: EdgeState; label: string; hint: string }[] = [
  { edge: "normal", label: "Normal", hint: "–" },
  { edge: "edge", label: "Edge", hint: "+2" },
  { edge: "bane", label: "Bane", hint: "−2" },
  { edge: "double-edge", label: "Double edge", hint: "tier +1" },
  { edge: "double-bane", label: "Double bane", hint: "tier −1" },
];

/** Single global instance (mounted in App): the longpress pick menu. */
export function EdgeMenu() {
  const state = menuState.value;
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeEdgeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);
  if (!state) return null;
  const x = Math.max(8, Math.min(state.x, window.innerWidth - 208));
  const y = Math.max(8, Math.min(state.y, window.innerHeight - 268));
  return (
    <>
      <div
        class="edge-menu-backdrop"
        onClick={closeEdgeMenu}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        class="edge-menu"
        style={{ left: `${x}px`, top: `${y}px` }}
        role="menu"
        aria-label="Roll with edge or bane"
      >
        {OPTIONS.map((opt) => (
          <button
            key={opt.edge}
            role="menuitem"
            class="edge-menu-option"
            onClick={() => {
              const pick = state.onPick;
              closeEdgeMenu();
              pick(opt.edge);
            }}
          >
            <strong>{opt.label}</strong>
            <span>{opt.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}
