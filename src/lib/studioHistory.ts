import type { HomebrewMonster } from "../types.ts";
import {
  type History,
  type HistoryEntry,
  MERGE_MS,
  navigate,
  record,
  redo,
  startHistory,
  undo,
} from "./history.ts";
import { uid } from "./text.ts";

/**
 * Full undoable editor state for HomebrewStudio.
 * Captures the monster draft alongside parallel UI/craft metadata that must
 * stay in lockstep when stepping backward or forward through edits.
 */
export interface StudioSnapshot {
  draft: HomebrewMonster;
  manualStats: boolean;
  manualAbilities: boolean;
  copiedSourceNames: string[];
  syncedName: string;
}

export interface StudioStepMeta {
  /** Short human-readable label for tooltips and Undo/Redo toasts. */
  label: string;
  /** Optional coalesce key: rapid edits to the same field merge within MERGE_MS. */
  key?: string;
}

export type StudioHistory = History<StudioSnapshot>;

export function cloneStudioSnapshot(snapshot: StudioSnapshot): StudioSnapshot {
  return {
    draft: structuredClone(snapshot.draft),
    manualStats: snapshot.manualStats,
    manualAbilities: snapshot.manualAbilities,
    copiedSourceNames: [...snapshot.copiedSourceNames],
    syncedName: snapshot.syncedName,
  };
}

/**
 * Compare the meaningful editable content of two snapshots (ignoring purely
 * visual state like which ability cards happen to be expanded).
 */
export function studioContentEquals(a: StudioSnapshot, b: StudioSnapshot): boolean {
  if (a === b) return true;
  if (
    a.manualStats !== b.manualStats ||
    a.manualAbilities !== b.manualAbilities ||
    a.syncedName !== b.syncedName
  ) {
    return false;
  }
  if (
    a.copiedSourceNames.length !== b.copiedSourceNames.length ||
    a.copiedSourceNames.some((name, i) => name !== b.copiedSourceNames[i])
  ) {
    return false;
  }
  return JSON.stringify(a.draft) === JSON.stringify(b.draft);
}

export function createStudioHistory(initial: StudioSnapshot): StudioHistory {
  return startHistory(cloneStudioSnapshot(initial));
}

/**
 * Record an editable change in studio history.
 * - Skips no-op updates where the editable content did not change.
 * - Coalesces rapid same-key edits (e.g. typing in one field) within MERGE_MS.
 * - Collapses a coalesced step if the user undoes their own burst back to the
 *   exact pre-burst state (e.g. typing a character and immediately backspacing it).
 */
export function commitStudioEdit(
  history: StudioHistory,
  next: StudioSnapshot,
  meta: StudioStepMeta,
  now = Date.now(),
): { history: StudioHistory; stepId: string | null } {
  if (studioContentEquals(history.present, next)) {
    return { history, stepId: null };
  }

  const clonedNext = cloneStudioSnapshot(next);
  const top = history.past[history.past.length - 1];
  const canCoalesce = Boolean(
    meta.key && top && top.id === history.open && top.key === meta.key && now - top.at < MERGE_MS,
  );

  if (canCoalesce && top && studioContentEquals(top.before, clonedNext)) {
    return {
      history: {
        present: clonedNext,
        past: history.past.slice(0, -1),
        future: [],
      },
      stepId: null,
    };
  }

  const id = uid("hbst");
  const updated = record(
    history,
    clonedNext,
    meta.key ? { id, label: meta.label, key: meta.key } : { id, label: meta.label },
    now,
  );
  const activeId = updated.past[updated.past.length - 1]?.id ?? null;
  return { history: updated, stepId: activeId };
}

/**
 * Update non-undoable bookkeeping (synced name, copied source names) without
 * pushing a history step or clearing the redo stack.
 */
export function updateStudioView(
  history: StudioHistory,
  patch: Partial<Pick<StudioSnapshot, "syncedName" | "copiedSourceNames">>,
): StudioHistory {
  const next: StudioSnapshot = {
    ...history.present,
    ...(patch.syncedName !== undefined ? { syncedName: patch.syncedName } : {}),
    ...(patch.copiedSourceNames !== undefined
      ? { copiedSourceNames: [...patch.copiedSourceNames] }
      : {}),
  };
  return navigate(history, next);
}

/** Close the active coalesce window (e.g. on input blur) without affecting stacks. */
export function closeStudioMergeWindow(history: StudioHistory): StudioHistory {
  if (history.open === undefined) return history;
  return { present: history.present, past: history.past, future: history.future };
}

/**
 * Step backward one edit. When `expectedStepId` is supplied (e.g. from a toast
 * Undo button), only undoes if that exact step is still on top of the stack.
 */
export function undoStudio(
  history: StudioHistory,
  expectedStepId?: string,
): { history: StudioHistory; undone: HistoryEntry<StudioSnapshot> | null } {
  const top = history.past[history.past.length - 1];
  if (!top) return { history, undone: null };
  if (expectedStepId && top.id !== expectedStepId) return { history, undone: null };
  return { history: undo(history), undone: top };
}

/**
 * Step forward one edit. When `expectedStepId` is supplied (e.g. from a toast
 * Redo button), only redoes if that exact step is still on top of the future stack.
 */
export function redoStudio(
  history: StudioHistory,
  expectedStepId?: string,
): { history: StudioHistory; redone: HistoryEntry<StudioSnapshot> | null } {
  const top = history.future[history.future.length - 1];
  if (!top) return { history, redone: null };
  if (expectedStepId && top.id !== expectedStepId) return { history, redone: null };
  return { history: redo(history), redone: top };
}

export function canUndoStudio(history: StudioHistory): boolean {
  return history.past.length > 0;
}

export function canRedoStudio(history: StudioHistory): boolean {
  return history.future.length > 0;
}

export function studioUndoLabel(history: StudioHistory): string {
  return history.past[history.past.length - 1]?.label ?? "";
}

export function studioRedoLabel(history: StudioHistory): string {
  return history.future[history.future.length - 1]?.label ?? "";
}
