// Hover preview for the book's own cross-references: hovering "forced
// movement" in a statblock reads the rule in place, because most of them are
// two sentences long and opening a browser tab mid-combat costs more than the
// rule does. The page itself stays one click away.

import { signal } from "@preact/signals";
import {
  CONDITION_RE,
  CONDITIONS_DATA_URL,
  MALICE_DATA_URL,
  RULES_DATA_URL,
  STATBLOCK_RE,
  fetchUpstreamDoc,
  loadCompendiumDocs,
  monsterChunkUrl,
} from "./repo.ts";
import { isMaliceCandidatePath } from "./malice.ts";
import { richText, slugToLabel } from "./text.ts";
import { rulePreviewHtml } from "./ruleDoc.ts";
import type { RawStatblock } from "../types.ts";

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

const cache = new Map<string, Promise<RuleDoc | null>>();

/** The bundled file that holds a hover target. */
export function ruleSource(path: string): string {
  const familyPath = path.match(STATBLOCK_RE)?.[2];
  if (familyPath) return monsterChunkUrl(familyPath);
  if (CONDITION_RE.test(path)) return CONDITIONS_DATA_URL;
  if (isMaliceCandidatePath(path)) return MALICE_DATA_URL;
  return RULES_DATA_URL;
}

/** Statblocks have structured fields instead of a rule's prose. */
function statblockSummary(raw: RawStatblock): string {
  return [
    [raw.level == null ? "" : `Level ${raw.level}`, raw.organization, raw.role]
      .filter(Boolean)
      .join(" "),
    raw.stamina == null ? "" : `Stamina ${raw.stamina}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function loadRule(path: string): Promise<RuleDoc | null> {
  const cached = cache.get(path);
  if (cached) return cached;
  const isStatblock = STATBLOCK_RE.test(path);
  type PreviewSource = RawStatblock & { type?: string };
  const request = loadCompendiumDocs<PreviewSource>(ruleSource(path))
    .catch(() => undefined)
    .then((docs) =>
      docs && Object.hasOwn(docs, path) ? docs[path] : fetchUpstreamDoc<PreviewSource>(path),
    )
    .then((raw) => {
      if (!raw) return null;
      return {
        name: String(raw.name || ""),
        kind: isStatblock ? "Statblock" : slugToLabel(raw.type),
        html: isStatblock ? richText(statblockSummary(raw)) : rulePreviewHtml(raw),
      };
    })
    .catch(() => {
      cache.delete(path);
      return null;
    });
  cache.set(path, request);
  return request;
}
