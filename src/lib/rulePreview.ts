// Hover preview for the book's own cross-references: hovering "forced
// movement" in a statblock reads the rule in place, because most of them are
// two sentences long and opening a browser tab mid-combat costs more than the
// rule does. The page itself stays one click away.

import { signal } from "@preact/signals";
import { fetchJson, rawUrl } from "./repo.ts";
import { richText, slugToLabel } from "./text.ts";

export interface RuleDoc {
  name: string;
  /** "condition", "movement", "rule", … as the data types the page. */
  kind: string;
  /** The opening of the rule, as escaped-and-decorated HTML. */
  html: string;
}

export interface RulePreviewAnchor {
  path: string;
  url: string;
  label: string;
  /** A short hint written by the app itself, shown in place of a loaded rule. */
  inline?: RuleDoc;
  /** Clamped left edge of the card. */
  x: number;
  /** Where the term sits, so the card can be hung off it. */
  linkTop: number;
  linkBottom: number;
}

export const rulePreview = signal<RulePreviewAnchor | null>(null);

interface RawRuleDoc {
  name?: string;
  type?: string;
  content?: string;
  body?: string;
  description?: string;
  text?: string;
  effects?: { effect?: string; tier1?: string; tier2?: string; tier3?: string }[];
}

const cache = new Map<string, Promise<RuleDoc | null>>();

/**
 * The opening of a rule, in the book's own words: everything written before
 * the first heading, with blockquote and list marks flattened so it reads as
 * one card.
 *
 * Cut at the heading, never at a character count. A rule broken off
 * mid-sentence reads as though that were the whole rule, and it hides exactly
 * the case a Director is checking — what the term actually does. The handful
 * of very long rules scroll inside the card instead, with the full page a tap
 * away.
 */
function excerpt(raw: string): string {
  const blocks: string[] = [];
  for (const block of raw.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    if (text.startsWith("#")) break;
    const cleaned = text
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (cleaned) blocks.push(cleaned);
  }
  return blocks.join("\n\n");
}

/** Rule pages are written as `content`; feature pages carry `effects`. */
function docText(raw: RawRuleDoc): string {
  const direct = raw.content || raw.body || raw.description || raw.text;
  if (direct) return direct;
  return (raw.effects || [])
    .map(
      (effect) =>
        effect.effect || [effect.tier1, effect.tier2, effect.tier3].filter(Boolean).join(" · "),
    )
    .filter(Boolean)
    .join("\n\n");
}

export function loadRule(path: string): Promise<RuleDoc | null> {
  const cached = cache.get(path);
  if (cached) return cached;
  const request = fetchJson<RawRuleDoc>(rawUrl(path))
    .then((raw) => ({
      name: String(raw.name || ""),
      kind: slugToLabel(raw.type),
      html: richText(excerpt(docText(raw))),
    }))
    .catch(() => null);
  cache.set(path, request);
  return request;
}
