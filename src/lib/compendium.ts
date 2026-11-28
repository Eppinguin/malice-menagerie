/**
 * Invariants for the bundled SteelCompendium snapshot.
 *
 * The sync script refuses to write data that violates these, and the tests run
 * them against what is committed. They deliberately go through the app's own
 * parsers (`buildCatalogEntry`, `displayableMaliceFeatures`, `parseEv`) instead of
 * checking JSON shape alone: upstream can keep the schema and still change the
 * meaning of a field, and that is the breakage that matters.
 */
import { buildCatalogEntry } from "./catalog.ts";
import { BUILTIN_COMPENDIUM_TERMS } from "./compendiumLinks.ts";
import { displayableMaliceFeatures, isMaliceCandidatePath } from "./malice.ts";
import { CONDITION_RE, STATBLOCK_RE, sourceRef, type CompendiumIndex } from "./repo.ts";
import { conditionDescription, rulePreviewHtml } from "./ruleDoc.ts";
import { parseEv } from "./text.ts";
import { isRecord } from "../types.ts";
import type { RawMaliceRecord } from "../types.ts";

export interface CompendiumDocs {
  statblocks: Record<string, unknown>;
  malice: Record<string, unknown>;
  conditions: Record<string, unknown>;
  rules: Record<string, unknown>;
}

export interface CompendiumSummary {
  statblocks: number;
  catalog: number;
  maliceDocs: number;
  maliceFeatures: number;
  conditions: number;
  rules: number;
  evCoverage: number;
  staminaCoverage: number;
  organizationCoverage: number;
}

export interface CompendiumValidation {
  errors: string[];
  warnings: string[];
  summary: CompendiumSummary;
}

/**
 * Coverage floors sit a little below today's numbers. A drop means upstream
 * stopped publishing a field the app reads, which is a break even when the
 * JSON still parses.
 */
export const COMPENDIUM_FLOORS = {
  statblocks: 500,
  catalog: 440,
  maliceDocs: 60,
  maliceFeatures: 180,
  conditions: 9,
  // The closure is ~816 today. A collapse to a few hundred means the
  // cross-reference walk broke, not that upstream trimmed prose.
  rules: 700,
  evCoverage: 0.89,
  staminaCoverage: 0.96,
  organizationCoverage: 0.97,
} as const;

function isFilledNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim()) return Number.isFinite(Number(value));
  return false;
}

function isFilledString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCompendiumDocs(docs: CompendiumDocs): CompendiumValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let statblocks = 0;
  let catalog = 0;
  let evEligible = 0;
  let withEv = 0;
  let withStamina = 0;
  let withOrganization = 0;

  for (const [path, raw] of Object.entries(docs.statblocks)) {
    if (!STATBLOCK_RE.test(path)) {
      errors.push(`${path}: not a statblock path`);
      continue;
    }
    if (!isRecord(raw)) {
      errors.push(`${path}: statblock is not a JSON object`);
      continue;
    }
    statblocks += 1;
    if (!isFilledString(raw.name)) errors.push(`${path}: statblock has no name`);
    if (!isFilledNumber(raw.level)) errors.push(`${path}: statblock has no level`);
    if (raw.features !== undefined && !Array.isArray(raw.features)) {
      errors.push(`${path}: features is not an array`);
    }
    if (raw.movement !== undefined && typeof raw.movement !== "string") {
      errors.push(`${path}: statblock movement is not a string`);
    }
    const organization = raw.organization;
    const invalidOrganization = organization !== undefined && typeof organization !== "string";
    if (invalidOrganization) errors.push(`${path}: statblock organization is not a string`);
    const entry = buildCatalogEntry(path);
    if (!entry) continue; // hero-side statblock: not shown in the library
    catalog += 1;
    evEligible += 1;
    if (isFilledNumber(raw.stamina)) withStamina += 1;
    else warnings.push(`${path}: statblock has no Stamina`);
    if (isFilledString(organization)) withOrganization += 1;
    else if (!invalidOrganization) warnings.push(`${path}: statblock has no organization`);
    if (parseEv(raw.ev, invalidOrganization ? undefined : organization).unit > 0) withEv += 1;
    else warnings.push(`${path}: statblock has no usable EV`);
  }

  let maliceFeatures = 0;
  for (const [path, raw] of Object.entries(docs.malice)) {
    if (!isMaliceCandidatePath(path)) {
      errors.push(`${path}: not a Malice path`);
      continue;
    }
    if (!isRecord(raw)) {
      errors.push(`${path}: Malice document is not a JSON object`);
      continue;
    }
    const features = displayableMaliceFeatures(raw as RawMaliceRecord, path, (issue) => {
      errors.push(`${path}: ${issue}`);
    });
    maliceFeatures += features.length;
    if (!features.length) {
      errors.push(`${path}: Malice document yields no displayable features`);
    }
  }

  for (const [path, raw] of Object.entries(docs.conditions)) {
    if (!CONDITION_RE.test(path)) errors.push(`${path}: not a condition path`);
    if (!isRecord(raw)) {
      errors.push(`${path}: condition is not a JSON object`);
      continue;
    }
    if (!rulePreviewHtml(raw)) {
      errors.push(`${path}: condition has no displayable hover excerpt`);
    } else if (!conditionDescription(raw)) {
      errors.push(`${path}: condition has no displayable description`);
    }
  }

  for (const [path, raw] of Object.entries(docs.rules)) {
    if (!isRecord(raw)) {
      errors.push(`${path}: rule is not a JSON object`);
      continue;
    }
    if (!rulePreviewHtml(raw)) {
      errors.push(`${path}: rule has no displayable hover excerpt`);
    }
  }

  const bundles = [docs.statblocks, docs.malice, docs.conditions, docs.rules];
  const bundled = new Set(bundles.flatMap((bundle) => Object.keys(bundle)));
  for (const path of collectPreviewPaths(bundles.flatMap((bundle) => Object.values(bundle)))) {
    if (!bundled.has(path)) errors.push(`${path}: referenced preview is missing from the snapshot`);
  }

  const ratio = (part: number, whole: number) => (whole ? part / whole : 0);
  const summary: CompendiumSummary = {
    statblocks,
    catalog,
    maliceDocs: Object.keys(docs.malice).length,
    maliceFeatures,
    conditions: Object.keys(docs.conditions).length,
    rules: Object.keys(docs.rules).length,
    evCoverage: ratio(withEv, evEligible),
    staminaCoverage: ratio(withStamina, evEligible),
    organizationCoverage: ratio(withOrganization, evEligible),
  };

  const floorChecks: [keyof typeof COMPENDIUM_FLOORS, number, number][] = [
    ["statblocks", summary.statblocks, COMPENDIUM_FLOORS.statblocks],
    ["catalog", summary.catalog, COMPENDIUM_FLOORS.catalog],
    ["maliceDocs", summary.maliceDocs, COMPENDIUM_FLOORS.maliceDocs],
    ["maliceFeatures", summary.maliceFeatures, COMPENDIUM_FLOORS.maliceFeatures],
    ["conditions", summary.conditions, COMPENDIUM_FLOORS.conditions],
    ["rules", summary.rules, COMPENDIUM_FLOORS.rules],
    ["evCoverage", summary.evCoverage, COMPENDIUM_FLOORS.evCoverage],
    ["staminaCoverage", summary.staminaCoverage, COMPENDIUM_FLOORS.staminaCoverage],
    ["organizationCoverage", summary.organizationCoverage, COMPENDIUM_FLOORS.organizationCoverage],
  ];
  for (const [key, value, floor] of floorChecks) {
    if (value < floor) errors.push(`${key} fell to ${value}, below the ${floor} floor`);
  }

  return { errors, warnings, summary };
}

/** Cross-check the generated index against the documents it names. */
export function validateCompendiumIndex(index: CompendiumIndex, docs: CompendiumDocs): string[] {
  const errors: string[] = [];
  if (index.schemaVersion !== 1) errors.push(`unknown index schema version ${index.schemaVersion}`);
  if (!/^[0-9a-f]{7,40}$/i.test(index.upstream?.sha ?? "")) {
    errors.push("index has no upstream commit sha");
  }
  if (Number.isNaN(Date.parse(index.generatedAt))) errors.push("index has no generatedAt date");
  const expected = {
    statblocks: Object.keys(docs.statblocks).length,
    malice: Object.keys(docs.malice).length,
    conditions: Object.keys(docs.conditions).length,
    rules: Object.keys(docs.rules).length,
  };
  for (const [key, value] of Object.entries(expected) as [keyof typeof expected, number][]) {
    if (index.counts?.[key] !== value) {
      errors.push(`index says ${key}=${index.counts?.[key]} but the bundle has ${value}`);
    }
  }
  if (new Set(index.paths).size !== index.paths.length) errors.push("index lists duplicate paths");
  const indexed = new Set(index.paths);
  for (const path of index.paths) {
    const known = path in docs.statblocks || path in docs.malice || path in docs.conditions;
    if (!known) errors.push(`index path ${path} has no bundled document`);
  }
  // The app only reads the documents the index names, so a core document the
  // index forgot would silently disappear from the library.
  for (const path of [
    ...Object.keys(docs.statblocks),
    ...Object.keys(docs.malice),
    ...Object.keys(docs.conditions),
  ]) {
    if (!indexed.has(path)) errors.push(`index does not list bundled document ${path}`);
  }
  return errors;
}

/** Every `scc.vN:` reference in a document, mapped to the file behind it. */
const REF_SCAN_RE = /scc\.v\d+:[^\s"')\]},;]+/gi;

export function collectReferencedPaths(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(REF_SCAN_RE)) {
      const ref = sourceRef(match[0]);
      if (ref) into.add(ref.path);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedPaths(item, into);
    return into;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectReferencedPaths(item, into);
  }
  return into;
}

/** Hover targets come from both built-in Studio links and upstream documents. */
export function collectPreviewPaths(docs: Iterable<unknown>): Set<string> {
  const paths = new Set<string>();
  for (const { href, label } of BUILTIN_COMPENDIUM_TERMS) {
    const ref = sourceRef(href);
    if (!ref) throw new Error(`Invalid built-in Studio link for "${label}": ${href}`);
    paths.add(ref.path);
  }
  for (const doc of docs) collectReferencedPaths(doc, paths);
  return paths;
}
