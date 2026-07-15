// Pointer-based drag & drop for the Prep view: drag library monsters into
// groups, move encounter entries between groups, drop onto the "new group"
// target, or drop encounter entries back on the library to remove them.
//
// The drag session works imperatively on the live DOM (ghost element, drop
// highlights, elementFromPoint hit-testing) while Preact re-renders are held
// back through the data renderGate, so the tree under the pointer stays stable
// for the duration of the drag.

import { escapeHtml } from "./lib/text.ts";
import { flushDataSignals, renderGate } from "./data.ts";
import {
  activeEncounter,
  addToEncounterInGroup,
  createGroupForDrop,
  moveEncounterEntryToGroup,
  removeEncounterEntry,
  selectPrepGroup,
  toast,
} from "./store.ts";

export interface LibraryDragPayload {
  kind: "library";
  sourcePath: string;
  count: number;
  label: string;
}

export interface EncounterDragPayload {
  kind: "encounter";
  itemId: string;
  sourcePath: string;
  count: number;
  fromGroupId: string;
  label: string;
}

export type DragPayload = LibraryDragPayload | EncounterDragPayload;

type DropTarget =
  | { type: "group"; groupId: string; element: Element }
  | { type: "new-group"; element: Element }
  | { type: "remove"; element: Element };

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  payload: DragPayload;
  sourceEl: HTMLElement;
  ghost: HTMLElement | null;
  target: DropTarget | null;
}

let session: DragSession | null = null;
let suppressClickUntil = 0;

const byId = (id: string): HTMLElement | null => document.getElementById(id);

export function shouldSuppressClick(): boolean {
  return Date.now() < suppressClickUntil;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('button, input, select, textarea, a, [contenteditable="true"]'))
  );
}

export function beginPrepDrag(
  event: PointerEvent,
  payload: DragPayload,
  sourceEl: HTMLElement,
): void {
  if (event.button !== 0 || session || isInteractiveTarget(event.target)) return;
  session = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    payload,
    sourceEl,
    ghost: null,
    target: null,
  };
  sourceEl.setPointerCapture?.(event.pointerId);
}

function activateDrag(): void {
  if (!session || session.active) return;
  session.active = true;
  renderGate.paused = true;
  const { payload, sourceEl } = session;
  const ghost = document.createElement("div");
  ghost.className = "prep-drag-ghost";
  const action =
    payload.count > 1 ? `${payload.count} ×` : payload.kind === "library" ? "Add to group" : "Move";
  ghost.innerHTML = `<strong>${escapeHtml(payload.label)}</strong><span>${action}</span>`;
  document.body.appendChild(ghost);
  session.ghost = ghost;
  sourceEl.classList.add("drag-source");
  document.body.classList.add("is-prep-dragging");
  document.body.classList.toggle("dragging-library-monster", payload.kind === "library");
  document.body.classList.toggle("dragging-encounter-entry", payload.kind === "encounter");
  updateDragVisuals(session.x, session.y);
}

function pointInside(element: Element | null, x: number, y: number): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function dropTargetAt(x: number, y: number): DropTarget | null {
  const hit = document.elementFromPoint(x, y);
  const group = hit?.closest("[data-drop-group]");
  const groupId = group?.getAttribute("data-drop-group");
  if (group && groupId) return { type: "group", groupId, element: group };
  const newGroupDrop = byId("prepNewGroupDrop");
  if (newGroupDrop && pointInside(newGroupDrop, x, y))
    return { type: "new-group", element: newGroupDrop };
  const library = byId("monsterLibrary");
  if (session?.payload.kind === "encounter" && library && pointInside(library, x, y)) {
    return { type: "remove", element: library };
  }
  return null;
}

function clearDropHighlights(): void {
  byId("rosterGroups")
    ?.querySelectorAll(".drag-over")
    .forEach((element) => element.classList.remove("drag-over"));
  byId("prepNewGroupDrop")?.classList.remove("drag-over");
  byId("monsterLibrary")?.classList.remove("drop-remove-active");
}

function applyDropHighlight(target: DropTarget | null): void {
  clearDropHighlights();
  if (!target) return;
  if (target.type === "remove") target.element.classList.add("drop-remove-active");
  else target.element.classList.add("drag-over");
}

function autoScrollAt(x: number, y: number): void {
  for (const element of [byId("monsterLibrary"), byId("rosterGroups")]) {
    if (!element || !pointInside(element, x, y) || element.scrollHeight <= element.clientHeight)
      continue;
    const rect = element.getBoundingClientRect();
    const edge = Math.min(56, rect.height * 0.18);
    if (y < rect.top + edge) element.scrollTop -= 14;
    else if (y > rect.bottom - edge) element.scrollTop += 14;
  }
}

function updateDragVisuals(x: number, y: number): void {
  if (!session?.active) return;
  session.x = x;
  session.y = y;
  if (session.ghost) session.ghost.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
  const nextTarget = dropTargetAt(x, y);
  const previous = session.target;
  const sameTarget =
    previous?.type === nextTarget?.type &&
    (previous?.type !== "group" ||
      nextTarget?.type !== "group" ||
      previous.groupId === nextTarget.groupId);
  if (!sameTarget) session.target = nextTarget;
  // Re-apply unconditionally: a background hydration render may have replaced
  // the highlighted node since the last pointer move.
  applyDropHighlight(session.target);
  autoScrollAt(x, y);
}

async function commitDrop(target: DropTarget | null, payload: DragPayload): Promise<void> {
  if (!target) return;
  if (target.type === "group") {
    selectPrepGroup(target.groupId);
    if (payload.kind === "library") {
      await addToEncounterInGroup(payload.sourcePath, payload.count, target.groupId);
    } else {
      const item = activeEncounter().items.find((entry) => entry.id === payload.itemId);
      const changed = Boolean(item && item.groupId !== target.groupId);
      if (changed) {
        moveEncounterEntryToGroup(payload.itemId, target.groupId);
        const group = activeEncounter().groups.find((entry) => entry.id === target.groupId);
        toast(`Moved to ${group?.name || "group"}`);
      }
    }
    return;
  }

  if (target.type === "new-group") {
    const group = createGroupForDrop();
    if (payload.kind === "library") {
      await addToEncounterInGroup(payload.sourcePath, payload.count, group.id);
    } else {
      moveEncounterEntryToGroup(payload.itemId, group.id);
      toast(`Moved to new group ${group.name}`);
    }
    return;
  }

  if (target.type === "remove" && payload.kind === "encounter") {
    removeEncounterEntry(payload.itemId);
    toast("Removed from encounter");
  }
}

async function endDrag(pointerId: number, cancelled: boolean): Promise<void> {
  if (!session || pointerId !== session.pointerId) return;
  const ending = session;
  session = null;
  if (!ending.active) return;
  suppressClickUntil = Date.now() + 250;
  const target = cancelled ? null : ending.target;
  try {
    ending.sourceEl.releasePointerCapture?.(pointerId);
  } catch {
    // The capture may already be gone if the node was removed.
  }
  ending.sourceEl.classList.remove("drag-source");
  ending.ghost?.remove();
  clearDropHighlights();
  document.body.classList.remove(
    "is-prep-dragging",
    "dragging-library-monster",
    "dragging-encounter-entry",
  );
  renderGate.paused = false;
  flushDataSignals();
  await commitDrop(target, ending.payload);
}

function handlePointerMove(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return;
  session.x = event.clientX;
  session.y = event.clientY;
  if (!session.active) {
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (distance < 7) return;
    activateDrag();
  }
  event.preventDefault();
  updateDragVisuals(event.clientX, event.clientY);
}

let installed = false;

export function installDragListeners(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", (event) => {
    void endDrag(event.pointerId, false);
  });
  window.addEventListener("pointercancel", (event) => {
    void endDrag(event.pointerId, true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && session?.active) void endDrag(session.pointerId, true);
  });
}
