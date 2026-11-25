import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'summary:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const inertRefCounts = new WeakMap<HTMLElement, number>();
const activeModalStack: HTMLElement[] = [];

function addInert(el: HTMLElement | null) {
  if (!el) return;
  const next = (inertRefCounts.get(el) ?? 0) + 1;
  inertRefCounts.set(el, next);
  el.inert = true;
}

function removeInert(el: HTMLElement | null) {
  if (!el) return;
  const next = (inertRefCounts.get(el) ?? 1) - 1;
  if (next <= 0) {
    inertRefCounts.delete(el);
    el.inert = false;
  } else {
    inertRefCounts.set(el, next);
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.closest("[inert]")) return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  });
}

/**
 * Traps keyboard Tab focus inside a modal container, marks background surfaces
 * (including any underlying modals) `inert` with ref-counting, moves initial
 * focus inside the modal if nothing inside is focused yet, and restores focus
 * to the trigger element when the modal closes.
 */
export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement>,
  options: { isSubdialog?: boolean; active?: boolean } = {},
): void {
  const { isSubdialog = false, active = true } = options;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const prevFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (container) activeModalStack.push(container);

    const inertTargets: HTMLElement[] = [];
    const pushTarget = (el: HTMLElement | null) => {
      if (!el || el === container) return;
      if (container && (el.contains(container) || container.contains(el))) return;
      if (!inertTargets.includes(el)) inertTargets.push(el);
    };

    pushTarget(document.querySelector<HTMLElement>(".app-shell"));
    for (const drawer of document.querySelectorAll<HTMLElement>(
      ".preview-drawer, .quick-add-drawer, .drawer-backdrop",
    )) {
      pushTarget(drawer);
    }
    // Inert any other open modal sheet underneath this one so stacked dialogs
    // (e.g. ShareDialog over CustomMaliceDialog, or ImportDialog over Studio)
    // never fight over Tab focus.
    for (const otherSheet of document.querySelectorAll<HTMLElement>(
      ".hb-studio-sheet, .hb-modal-sheet",
    )) {
      pushTarget(otherSheet);
    }

    for (const target of inertTargets) addInert(target);

    // Ensure keyboard focus enters the modal on open (after any component-level
    // auto-focus effect has had a chance to focus a specific field).
    const focusTimer = window.requestAnimationFrame(() => {
      const currentContainer = containerRef.current;
      if (!currentContainer || !currentContainer.isConnected) return;
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement && currentContainer.contains(activeEl)) return;
      const focusables = getFocusableElements(currentContainer);
      focusables[0]?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const currentContainer = containerRef.current;
      if (!currentContainer || currentContainer.closest("[inert]")) return;
      if (activeModalStack[activeModalStack.length - 1] !== currentContainer) return;
      const focusables = getFocusableElements(currentContainer);
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!current || !currentContainer.contains(current) || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!current || !currentContainer.contains(current) || current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      if (container) {
        const idx = activeModalStack.lastIndexOf(container);
        if (idx >= 0) activeModalStack.splice(idx, 1);
      }
      for (const target of inertTargets) removeInert(target);
      if (prevFocused && prevFocused.isConnected && !prevFocused.closest("[inert]")) {
        prevFocused.focus();
      }
    };
  }, [containerRef, isSubdialog, active]);
}
