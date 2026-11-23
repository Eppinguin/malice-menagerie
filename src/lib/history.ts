/**
 * Session undo/redo history for Prep & Run. Every change is one labelled step,
 * so the Director can always take it back via Ctrl/Cmd+Z or the Toast Undo
 * button. Snapshots are serialized to sessionStorage on page hide so a reload
 * keeps the session's undo trail.
 */
export interface HistoryEntry<T> {
  id: string;
  /** Short human-readable label for tooltips and "Undone: …" toasts. */
  label: string;
  before: T;
  after?: T;
  /** Rapid steps with the same key within MERGE_MS coalesce into one step. */
  key?: string;
  /** Optional semantic tag (e.g. "round:<encId>:<round>") for looking back. */
  kind?: string;
  at: number;
}

export interface History<T> {
  present: T;
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
  /** Entry id eligible to absorb a same-key change; closed by undo/redo/nav. */
  open?: string;
}

export const HISTORY_LIMIT = 100;
export const MERGE_MS = 1500;
export const SESSION_HISTORY_KEY = "malice-menagerie-history-v1";

export function startHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] };
}

export function record<T>(
  history: History<T>,
  next: T,
  step: { id: string; label: string; key?: string; kind?: string },
  now = Date.now(),
): History<T> {
  if (next === history.present) return history;
  const top = history.past[history.past.length - 1];
  if (
    step.key &&
    top &&
    top.id === history.open &&
    top.key === step.key &&
    now - top.at < MERGE_MS
  ) {
    return {
      present: next,
      past: [...history.past.slice(0, -1), { ...top, label: step.label, at: now }],
      future: [],
      open: top.id,
    };
  }
  const entry: HistoryEntry<T> = {
    id: step.id,
    label: step.label,
    before: history.present,
    ...(step.key ? { key: step.key } : {}),
    ...(step.kind ? { kind: step.kind } : {}),
    at: now,
  };
  return {
    present: next,
    past: [...history.past, entry].slice(-HISTORY_LIMIT),
    future: [],
    open: entry.id,
  };
}

/** Update present without pushing a step (view switches, UI filters, encounter selection). */
export function navigate<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return { present: next, past: history.past, future: history.future };
}

export function undo<T>(history: History<T>): History<T> {
  const top = history.past[history.past.length - 1];
  if (!top) return history;
  return {
    present: top.before,
    past: history.past.slice(0, -1),
    future: [...history.future, { ...top, after: history.present }],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const top = history.future[history.future.length - 1];
  if (!top || top.after === undefined) return history;
  const restored: HistoryEntry<T> = {
    id: top.id,
    label: top.label,
    before: top.before,
    ...(top.key ? { key: top.key } : {}),
    ...(top.kind ? { kind: top.kind } : {}),
    at: top.at,
  };
  return {
    present: top.after,
    past: [...history.past, restored],
    future: history.future.slice(0, -1),
  };
}

interface PackedHistory<T> {
  presentJson: string;
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
}

const MAX_SESSION_ENTRIES = 40;

export function packHistory<T>(history: History<T>): string {
  const payload: PackedHistory<T> = {
    presentJson: JSON.stringify(history.present),
    past: history.past.slice(-MAX_SESSION_ENTRIES),
    future: history.future.slice(-MAX_SESSION_ENTRIES),
  };
  return JSON.stringify(payload);
}

/** Restore session undo/redo only if its present snapshot matches what is in localStorage. */
export function unpackHistory<T>(
  rawSession: string | null,
  rawStored: string | null,
  sanitize: (value: unknown) => T,
): History<T> | null {
  if (!rawSession || !rawStored) return null;
  try {
    const parsed = JSON.parse(rawSession) as Partial<PackedHistory<unknown>>;
    if (
      typeof parsed.presentJson !== "string" ||
      parsed.presentJson !== rawStored ||
      !Array.isArray(parsed.past) ||
      !Array.isArray(parsed.future)
    ) {
      return null;
    }
    const present = sanitize(JSON.parse(rawStored));
    const past = parsed.past
      .filter(
        (item): item is HistoryEntry<unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as HistoryEntry<unknown>).id === "string" &&
          typeof (item as HistoryEntry<unknown>).label === "string" &&
          "before" in item,
      )
      .map((item): HistoryEntry<T> => ({
        id: item.id,
        label: item.label,
        before: sanitize(item.before),
        ...(item.key ? { key: item.key } : {}),
        ...(item.kind ? { kind: item.kind } : {}),
        at: Number(item.at) || 0,
      }));
    const future = parsed.future
      .filter(
        (item): item is HistoryEntry<unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as HistoryEntry<unknown>).id === "string" &&
          typeof (item as HistoryEntry<unknown>).label === "string" &&
          "before" in item &&
          "after" in item,
      )
      .map((item): HistoryEntry<T> => ({
        id: item.id,
        label: item.label,
        before: sanitize(item.before),
        after: sanitize(item.after),
        ...(item.key ? { key: item.key } : {}),
        ...(item.kind ? { kind: item.kind } : {}),
        at: Number(item.at) || 0,
      }));
    return { present, past, future };
  } catch {
    return null;
  }
}
