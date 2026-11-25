/**
 * Cheap, synchronous check for whether search text is a pasted import (share
 * link, bare share code, or exported JSON) rather than a library query. Kept
 * free of `share.ts` so the search fields don't pull in the import chunk.
 */
export function looksLikeImport(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10) return false;
  if (trimmed.includes("#s=")) return true;
  if (/^[01]\.[A-Za-z0-9_-]{8,}$/.test(trimmed)) return true;
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

/** Whether pasted import text is a link/code (true) or JSON (false). */
export function isShareLinkText(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed.startsWith("{") && !trimmed.startsWith("[");
}
