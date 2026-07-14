import type { ParsedEv } from "../types.ts";

export const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escaped-then-decorated HTML, for dangerouslySetInnerHTML targets only. */
export function richText(value: string | undefined | null): string {
  let text = escapeHtml(value || "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text.replace(/\n/g, "<br>");
}

export function plainText(value: string | undefined | null): string {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugToLabel(slug: string | undefined | null): string {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function familyLabel(path: string): string {
  return path.split("/").filter(Boolean).map(slugToLabel).join(" · ");
}

export function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

export function fmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "—");
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function signed(value: unknown): string {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

export function numberFrom(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

export function parseEv(value: unknown, organization: unknown): ParsedEv {
  if (typeof value === "number") return { unit: value, label: fmt(value), suggestedQty: 1 };
  const text = String(value ?? "").trim();
  const total = numberFrom(text, 0);
  const minionMatch = text.match(
    /([\d.]+)\s+for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+minions?/i,
  );
  if (minionMatch?.[1] && minionMatch[2]) {
    const countToken = minionMatch[2].toLowerCase();
    const count = Number(countToken) || WORD_NUMBERS[countToken] || 4;
    return { unit: Number(minionMatch[1]) / count, label: text, suggestedQty: count };
  }
  return {
    unit: total,
    label: text || fmt(total),
    suggestedQty: String(organization).toLowerCase() === "minion" ? 4 : 1,
  };
}

export function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
