import {
  openOwlbearPanel,
  owlbearPanelOpen,
  toggleOwlbearPanel,
} from "../../integration/controller.ts";

let lastSettingsInvoker: HTMLElement | null = null;

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function openSettingsPanel(invoker?: HTMLElement | null): void {
  if (!owlbearPanelOpen.peek() && invoker) lastSettingsInvoker = invoker;
  openOwlbearPanel();
}

export function toggleSettingsPanel(invoker?: HTMLElement | null): void {
  if (!owlbearPanelOpen.peek() && invoker) lastSettingsInvoker = invoker;
  toggleOwlbearPanel();
  if (!owlbearPanelOpen.peek()) lastSettingsInvoker = null;
}

export function restoreOwlbearFocus(): void {
  const invoker = lastSettingsInvoker;
  lastSettingsInvoker = null;
  if (invoker && isElementVisible(invoker)) {
    invoker.focus();
    return;
  }
  const selector = window.matchMedia("(max-width: 900px)").matches
    ? ".menu-toggle"
    : ".sidebar .app-settings";
  document.querySelector<HTMLButtonElement>(selector)?.focus();
}

export function closeSettingsPanel(restoreFocus: boolean): void {
  owlbearPanelOpen.value = false;
  if (restoreFocus) restoreOwlbearFocus();
  else lastSettingsInvoker = null;
}
