/**
 * Owlbear answers every API call through `postMessage`, so a rejection is
 * whatever the Owlbear frame structured-cloned back: usually a string or a
 * plain object, never an `Error` from this page. Reading `error.message`
 * therefore throws the real reason away and leaves a generic message (the
 * generic "Token creation failed." was hiding Owlbear's
 * `"items[0].image.url" length must be less than or equal to 2048`).
 */
export function describeError(value: unknown, fallback: string): string {
  return unwrap(value, fallback, 0);
}

const NESTED_KEYS = ["message", "error", "reason", "detail", "details"];
const MAX_DEPTH = 3;

function unwrap(value: unknown, fallback: string, depth: number): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && depth < MAX_DEPTH) {
    const record = value as Record<string, unknown>;
    for (const key of NESTED_KEYS) {
      const nested = record[key];
      if (nested === undefined) continue;
      const message = unwrap(nested, "", depth + 1);
      if (message) return message;
    }
  }
  if (value && typeof value === "object" && depth === 0) {
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "[]") return json;
    } catch {
      // Circular or otherwise unserialisable; fall through.
    }
  }
  return fallback;
}
