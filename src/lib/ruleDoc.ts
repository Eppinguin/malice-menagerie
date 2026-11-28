import { isRecord } from "../types.ts";
import { plainText, richText } from "./text.ts";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Rule pages are written as `content`; feature pages carry `effects`. */
function ruleDocText(raw: Record<string, unknown>): string {
  const direct = [raw.content, raw.body, raw.description, raw.text].find(hasText);
  if (direct) return direct;
  if (!Array.isArray(raw.effects)) return "";
  return raw.effects
    .filter(isRecord)
    .map(({ effect, tier1, tier2, tier3 }) =>
      hasText(effect) ? effect : [tier1, tier2, tier3].filter(hasText).join(" · "),
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Full condition text for the picker tooltip. */
export function conditionDescription(raw: unknown): string {
  return isRecord(raw) ? plainText(ruleDocText(raw)) : "";
}

/**
 * Skip leading Markdown headings because the card already shows the title.
 * Keep the opening text up to the next heading and flatten blockquote and
 * list marks so it reads as one card.
 *
 * Cut at the heading, never at a character count. A rule broken off
 * mid-sentence reads as though that were the whole rule, and it hides exactly
 * the case a Director is checking — what the term actually does. The handful
 * of very long rules scroll inside the card instead, with the full page a tap
 * away.
 */
function ruleExcerpt(raw: string): string {
  const opening: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) {
      if (opening.length) break;
      continue;
    }
    const cleaned = line
      .replace(/^[ \t]*>[ \t]?/, "")
      .replace(/^[ \t]*[-*][ \t]+/, "• ")
      .trimEnd();
    if (opening.length || cleaned.trimStart()) opening.push(cleaned);
  }
  return opening
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render the same rule body for hover cards and snapshot validation. */
export function rulePreviewHtml(raw: unknown): string {
  return isRecord(raw) ? richText(ruleExcerpt(ruleDocText(raw))) : "";
}
