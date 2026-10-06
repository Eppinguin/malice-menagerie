import { sourceRef } from "./repo.ts";
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

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * The book cross-links its own rules text ("forced movement", "Stamina",
 * "Grabbed"). Keep the link, pointing at the page on SteelCompendium that
 * explains the term, and carry the document path so the term can be read in
 * place on hover. A reference with no page behind it stays plain prose.
 * Called with the already-escaped source, so the label is safe to re-emit.
 */
function markdownLink(_match: string, label: string, href: string): string {
  const ref = sourceRef(href);
  if (!ref) return label;
  return (
    `<a class="rule-link" href="${ref.url}" data-rule-path="${ref.path}"` +
    ` target="_blank" rel="noreferrer">${label}</a>`
  );
}

/** Private-use fences, never in the source text. */
const PEN_OPEN = "\uE000";
const PEN_CLOSE = "\uE001";

/** Fence the numbers in `value` that differ from `printed`, the same text as
    the book prints it (a statblock at another level), so `richText` can set
    them in pen. Texts that don't line up number for number are left be. */
function fenceChanged(value: string, printed: string | undefined | null): string {
  if (printed == null || printed === value) return value;
  const now = value.split(/(\d+)/);
  const was = printed.split(/(\d+)/);
  if (now.length !== was.length) return value;
  return now.map((part, i) => (i % 2 && part !== was[i] ? PEN_OPEN + part + PEN_CLOSE : part)).join("");
}

/** Escaped-then-decorated HTML, for dangerouslySetInnerHTML targets only.
    With `printed`, the numbers a level change rewrote are set in pen. */
export function richText(value: string | undefined | null, printed?: string | null): string {
  let text = escapeHtml(fenceChanged(value || "", printed));
  text = text.replace(MARKDOWN_LINK_RE, markdownLink);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Potency ("M < 4") as the book prints it: black blocks in the Draw Steel
  // Glyphs font, with the rule spelled out for screen readers.
  text = text.replace(
    /\b([MARIP]) ?&lt; ?(\uE000?)(-?\d+)\uE001?/g,
    (_match, key: string, pen: string, value: string) => {
      const name = POTENCY_NAMES[key] ?? key;
      // Rewritten by a level change: written over the print in pen, an
      // outline rather than the book's solid block.
      if (pen)
        return `<span class="potency-pen" role="img" aria-label="${name} less than ${value}">${key}&lt;${value}</span>`;
      return `<span class="ds-glyph potency" role="img" aria-label="${name} less than ${value}">${key.toLowerCase()}&lt;${value}</span>`;
    },
  );
  text = text.replace(/\uE000(\d+)\uE001/g, '<span class="pen-num">$1</span>');
  return text.replace(/\n/g, "<br>");
}

const POTENCY_NAMES: Record<string, string> = {
  M: "Might",
  A: "Agility",
  R: "Reason",
  I: "Intuition",
  P: "Presence",
};

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
