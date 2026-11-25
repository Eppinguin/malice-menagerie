import { keyLevel } from "./levels.ts";
import {
  homebrewMaliceId,
  homebrewMaliceUuidFromId,
  homebrewMonsterIdFromPath,
  homebrewMonsterPath,
  isHomebrewMaliceId,
  isHomebrewMonsterPath,
  uuidv7,
} from "./id.ts";
import {
  rawStatblockToHomebrewMonster,
  sanitizeHomebrewMalice,
  sanitizeHomebrewMonster,
} from "./homebrew.ts";
import { flattenMalicePayload } from "./malice.ts";
import { attitudeOf } from "./negotiation.ts";
import { clampInt, uid } from "./text.ts";
import { isRecord } from "../types.ts";
import type {
  AppState,
  Encounter,
  HomebrewMalice,
  HomebrewMonster,
  Negotiation,
  RawMaliceRecord,
  RawStatblock,
} from "../types.ts";

export const SHARE_BUNDLE_FORMAT = "malice-menagerie" as const;
export const SHARE_BUNDLE_VERSION = 1 as const;
export const SHARE_HASH_PREFIX = "#s=";
export const SHARE_URL_MAX_LENGTH = 6000;
/** Hard cap on decoded share/import payloads to guard against zip bombs or huge files. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export type ShareBundleKind = "monster" | "malice" | "encounter" | "negotiation" | "pack";

export interface ShareBundleV1 {
  format: typeof SHARE_BUNDLE_FORMAT;
  version: typeof SHARE_BUNDLE_VERSION;
  kind: ShareBundleKind;
  exportedAt: number;
  primaryId: string;
  monsters?: HomebrewMonster[];
  malice?: HomebrewMalice[];
  encounters?: Encounter[];
  negotiations?: Negotiation[];
}

export type ImportItemKind = "monster" | "malice" | "encounter" | "negotiation";
export type ImportConflictStatus = "new" | "identical" | "newer" | "older" | "modified";
export type ImportDecision = "add" | "update" | "copy" | "skip";

export interface AnalyzedImportItem {
  key: string;
  kind: ImportItemKind;
  id: string;
  name: string;
  subtitle: string;
  status: ImportConflictStatus;
  existingRevision?: number;
  incomingRevision?: number;
  defaultDecision: ImportDecision;
}

export interface ImportAnalysis {
  bundle: ShareBundleV1;
  items: AnalyzedImportItem[];
}

export interface AppliedImportResult {
  added: number;
  updated: number;
  copied: number;
  skipped: number;
  updatedMonsterIds?: string[];
  primaryTarget?: {
    kind: ImportItemKind;
    id: string;
  };
}

// ---------- Bundle preparation & transitive bundling ----------

function stripEncounterCombat(enc: Encounter): Encounter {
  const clean = structuredClone(enc);
  clean.view = "builder";
  clean.combat = {
    active: false,
    round: 1,
    malice: 0,
    instances: [],
    activeGroupFilter: null,
    activeEffects: [],
    selectedMaliceFeatureIds: [...enc.combat.selectedMaliceFeatureIds],
    maliceSelectionInitialized: enc.combat.maliceSelectionInitialized,
  };
  return clean;
}

function stripNegotiationProgress(neg: Negotiation): Negotiation {
  const clean = structuredClone(neg);
  const att = attitudeOf(clean.attitude);
  clean.interest = att.interest;
  clean.patience = clampInt(att.patience + (clean.languageBonus ?? 0), 0, 5);
  clean.log = [];
  clean.ended = null;
  delete clean.overrideEnded;
  for (const trait of [...clean.motivations, ...clean.pitfalls]) {
    trait.used = false;
  }
  return clean;
}

function collectMaliceForMonster(
  monster: HomebrewMonster,
  allMalice: readonly HomebrewMalice[],
): HomebrewMalice[] {
  const byId = new Map(allMalice.map((m) => [m.id, m]));
  const picked = new Map<string, HomebrewMalice>();
  for (const id of monster.maliceIds ?? []) {
    const found = byId.get(id);
    if (found) picked.set(found.id, found);
  }
  const fam = monster.familyPath.trim().toLowerCase().split("/").filter(Boolean)[0];
  if (fam) {
    for (const m of allMalice) {
      if (m.family.trim().toLowerCase() === fam) picked.set(m.id, m);
    }
  }
  return [...picked.values()];
}

export function buildMonsterBundle(
  monster: HomebrewMonster,
  allMalice: readonly HomebrewMalice[],
): ShareBundleV1 {
  const malice = collectMaliceForMonster(monster, allMalice);
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    kind: "monster",
    exportedAt: Date.now(),
    primaryId: monster.id,
    monsters: [structuredClone(monster)],
    ...(malice.length ? { malice: structuredClone(malice) } : {}),
  };
}

export function buildMaliceBundle(malice: HomebrewMalice): ShareBundleV1 {
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    kind: "malice",
    exportedAt: Date.now(),
    primaryId: malice.id,
    malice: [structuredClone(malice)],
  };
}

export function buildEncounterBundle(
  encounter: Encounter,
  allMonsters: readonly HomebrewMonster[],
  allMalice: readonly HomebrewMalice[],
  options: { includeCombat?: boolean } = {},
): ShareBundleV1 {
  const prepared = options.includeCombat
    ? structuredClone(encounter)
    : stripEncounterCombat(encounter);
  const monsterById = new Map(allMonsters.map((m) => [m.id, m]));
  const maliceById = new Map(allMalice.map((m) => [m.id, m]));

  const bundledMonsters = new Map<string, HomebrewMonster>();
  const bundledMalice = new Map<string, HomebrewMalice>();

  const refPaths = [
    ...prepared.items.map((item) => item.sourcePath),
    ...prepared.combat.instances.map((inst) => inst.sourcePath),
  ];
  for (const path of refPaths) {
    const id = homebrewMonsterIdFromPath(path);
    if (!id) continue;
    const found = monsterById.get(id);
    if (!found) continue;
    bundledMonsters.set(found.id, found);
    for (const mal of collectMaliceForMonster(found, allMalice)) {
      bundledMalice.set(mal.id, mal);
    }
  }
  for (const malRef of prepared.combat.selectedMaliceFeatureIds) {
    const uuid = homebrewMaliceUuidFromId(malRef);
    if (!uuid) continue;
    const found = maliceById.get(uuid);
    if (found) bundledMalice.set(found.id, found);
  }

  const monsters = [...bundledMonsters.values()];
  const malice = [...bundledMalice.values()];
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    kind: "encounter",
    exportedAt: Date.now(),
    primaryId: prepared.id,
    encounters: [prepared],
    ...(monsters.length ? { monsters: structuredClone(monsters) } : {}),
    ...(malice.length ? { malice: structuredClone(malice) } : {}),
  };
}

export function buildNegotiationBundle(
  negotiation: Negotiation,
  options: { includeProgress?: boolean } = {},
): ShareBundleV1 {
  const prepared = options.includeProgress
    ? structuredClone(negotiation)
    : stripNegotiationProgress(negotiation);
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    kind: "negotiation",
    exportedAt: Date.now(),
    primaryId: prepared.id,
    negotiations: [prepared],
  };
}

export function buildPackBundle(app: AppState, mode: "homebrew" | "all"): ShareBundleV1 {
  const monsters = structuredClone(app.homebrewMonsters);
  const malice = structuredClone(app.homebrewMalice);
  const encounters = mode === "all" ? structuredClone(app.encounters) : [];
  const negotiations = mode === "all" ? structuredClone(app.negotiations) : [];
  const primaryId =
    encounters[0]?.id ?? monsters[0]?.id ?? malice[0]?.id ?? negotiations[0]?.id ?? "";
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    kind: "pack",
    exportedAt: Date.now(),
    primaryId,
    ...(monsters.length ? { monsters } : {}),
    ...(malice.length ? { malice } : {}),
    ...(encounters.length ? { encounters } : {}),
    ...(negotiations.length ? { negotiations } : {}),
  };
}

// ---------- Base64URL + deflate-raw link encoding ----------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("This share link or file is too large to import safely.");
  }
}

async function streamTransform(
  bytes: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array>,
  maxBytes = MAX_IMPORT_BYTES,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Always observe writePromise rejections so malformed streams never trigger
  // an unhandled rejection if reader.read() rejects first.
  const writeResult = writer
    .write(bytes as BufferSource)
    .then(() => writer.close())
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        await writer.abort().catch(() => {});
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const writeOutcome = await writeResult;
  if (!writeOutcome.ok) throw writeOutcome.error;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Encode a bundle into a version-prefixed URL hash fragment (`#s=1.<b64url>`).
 * Uses browser-native `deflate-raw` (`1.` prefix) with automatic uncompressed
 * UTF-8 (`0.` prefix) fallback when CompressionStream is unavailable.
 */
export async function encodeBundleToHash(bundle: ShareBundleV1): Promise<string> {
  const json = JSON.stringify(bundle);
  const rawBytes = new TextEncoder().encode(json);
  if (typeof CompressionStream !== "undefined") {
    try {
      const compressed = await streamTransform(rawBytes, new CompressionStream("deflate-raw"));
      if (compressed.byteLength < rawBytes.byteLength) {
        return `${SHARE_HASH_PREFIX}1.${bytesToBase64Url(compressed)}`;
      }
    } catch {
      // Fall through to uncompressed encoding.
    }
  }
  return `${SHARE_HASH_PREFIX}0.${bytesToBase64Url(rawBytes)}`;
}

export async function buildShareUrl(
  bundle: ShareBundleV1,
  originUrl?: string,
): Promise<{
  url: string;
  hash: string;
  tooLong: boolean;
  length: number;
}> {
  const hash = await encodeBundleToHash(bundle);
  const base =
    originUrl ??
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "https://malice-menagerie.app/");
  const url = `${base}${hash}`;
  return {
    url,
    hash,
    tooLong: url.length > SHARE_URL_MAX_LENGTH,
    length: url.length,
  };
}

export function extractShareToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Never confuse a JSON payload whose text happens to mention `#s=` with a share link.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  const hashIndex = trimmed.indexOf(SHARE_HASH_PREFIX);
  if (hashIndex >= 0) {
    return trimmed.slice(hashIndex + SHARE_HASH_PREFIX.length).split(/[&\s]/)[0] ?? null;
  }
  if (/^[01]\.[A-Za-z0-9_-]{8,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function decodeBundleFromHash(
  hashOrUrl: string,
): Promise<{ ok: true; bundle: ShareBundleV1 } | { ok: false; error: string }> {
  const token = extractShareToken(hashOrUrl);
  if (!token) return { ok: false, error: "Not a Malice Menagerie share link." };
  if (token.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "This share link is too large to import safely." };
  }
  const dot = token.indexOf(".");
  if (dot < 1) return { ok: false, error: "This share link is incomplete or corrupted." };
  const codec = token.slice(0, dot);
  const payload = token.slice(dot + 1);
  if (codec !== "0" && codec !== "1") {
    return {
      ok: false,
      error: `This link uses a newer format (${codec}) that this version of Malice Menagerie cannot read yet.`,
    };
  }
  try {
    const bytes = base64UrlToBytes(payload);
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      return { ok: false, error: "This share link is too large to import safely." };
    }
    const decodedBytes =
      codec === "1"
        ? typeof DecompressionStream !== "undefined"
          ? await streamTransform(bytes, new DecompressionStream("deflate-raw"), MAX_IMPORT_BYTES)
          : (() => {
              throw new Error("This browser does not support compressed share links.");
            })()
        : bytes;
    const text = new TextDecoder().decode(decodedBytes);
    const parsed: unknown = JSON.parse(text);
    return validateParsedBundle(parsed);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof PayloadTooLargeError ||
        (error instanceof Error && error.message.includes("browser does not support"))
          ? error.message
          : "This share link appears truncated or corrupted. Ask the sender for a fresh link or .json file.",
    };
  }
}

// ---------- Validation & multi-format import parser ----------

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function safeOriginRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, unknown> = {
    kind: raw["kind"] === "official-fork" || raw["kind"] === "imported" ? raw["kind"] : "local",
  };
  if (typeof raw["sourceId"] === "string") out["sourceId"] = raw["sourceId"];
  if (typeof raw["sourceName"] === "string") out["sourceName"] = raw["sourceName"];
  if (typeof raw["author"] === "string") out["author"] = raw["author"];
  if (typeof raw["license"] === "string") out["license"] = raw["license"];
  return out;
}

/** Normalize untrusted encounter JSON enough for safe preview/conflict analysis before full sanitization. */
function normalizeRawEncounter(raw: unknown): Encounter | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const id = rawId && !RESERVED_KEYS.has(rawId) ? rawId : uuidv7();
  const name =
    typeof raw["name"] === "string" && raw["name"].trim()
      ? raw["name"].trim()
      : "Untitled encounter";
  const items = Array.isArray(raw["items"]) ? raw["items"].filter(isRecord) : [];
  const party = isRecord(raw["party"])
    ? {
        heroes: Math.max(1, Math.round(Number(raw["party"]["heroes"]) || 4)),
        level: Math.max(1, Math.round(Number(raw["party"]["level"]) || 1)),
        victories: Math.max(0, Math.round(Number(raw["party"]["victories"]) || 0)),
      }
    : undefined;
  const revNum = Number(raw["revision"]);
  const updNum = Number(raw["updatedAt"]);
  const origin = safeOriginRecord(raw["origin"]);
  return {
    ...raw,
    id,
    name,
    items,
    ...(party ? { party } : {}),
    ...(Number.isFinite(revNum) && revNum >= 1 ? { revision: Math.round(revNum) } : {}),
    ...(Number.isFinite(updNum) && updNum > 0 ? { updatedAt: updNum } : {}),
    ...(origin ? { origin } : { origin: undefined }),
  } as unknown as Encounter;
}

/** Normalize untrusted negotiation JSON enough for safe preview/conflict analysis before full sanitization. */
function normalizeRawNegotiation(raw: unknown): Negotiation | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const id = rawId && !RESERVED_KEYS.has(rawId) ? rawId : uuidv7();
  const name =
    typeof raw["name"] === "string" && raw["name"].trim() ? raw["name"].trim() : "Untitled NPC";
  const motivations = Array.isArray(raw["motivations"]) ? raw["motivations"].filter(isRecord) : [];
  const pitfalls = Array.isArray(raw["pitfalls"]) ? raw["pitfalls"].filter(isRecord) : [];
  const impressionNum = Number(raw["impression"]);
  const revNum = Number(raw["revision"]);
  const updNum = Number(raw["updatedAt"]);
  const origin = safeOriginRecord(raw["origin"]);
  return {
    ...raw,
    id,
    name,
    motivations,
    pitfalls,
    impression: Number.isFinite(impressionNum) ? Math.max(1, Math.round(impressionNum)) : 1,
    ...(Number.isFinite(revNum) && revNum >= 1 ? { revision: Math.round(revNum) } : {}),
    ...(Number.isFinite(updNum) && updNum > 0 ? { updatedAt: updNum } : {}),
    ...(origin ? { origin } : { origin: undefined }),
  } as unknown as Negotiation;
}

export function validateParsedBundle(
  parsed: unknown,
  fallbackName?: string,
): { ok: true; bundle: ShareBundleV1 } | { ok: false; error: string } {
  if (Array.isArray(parsed)) {
    const monsters = dedupeById(
      parsed
        .map((item) => rawStatblockToHomebrewMonster(item as RawStatblock))
        .filter((m): m is HomebrewMonster => m !== null),
    );
    if (monsters.length) {
      return {
        ok: true,
        bundle: {
          format: SHARE_BUNDLE_FORMAT,
          version: SHARE_BUNDLE_VERSION,
          kind: monsters.length === 1 ? "monster" : "pack",
          exportedAt: Date.now(),
          primaryId: monsters[0]!.id,
          monsters,
        },
      };
    }
    return { ok: false, error: "This JSON array does not contain recognized statblocks." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Could not read a valid JSON object." };
  }

  if (parsed["format"] === SHARE_BUNDLE_FORMAT) {
    const version = Number(parsed["version"]);
    if (!Number.isInteger(version) || version < 1 || version > SHARE_BUNDLE_VERSION) {
      return {
        ok: false,
        error:
          Number.isFinite(version) && version > SHARE_BUNDLE_VERSION
            ? `This file uses bundle format v${String(parsed["version"])}, which requires a newer version of Malice Menagerie.`
            : `This file uses an unsupported bundle version (${String(parsed["version"])}).`,
      };
    }
    const monsters = dedupeById(
      Array.isArray(parsed["monsters"])
        ? parsed["monsters"]
            .map(sanitizeHomebrewMonster)
            .filter((item): item is HomebrewMonster => item !== null)
        : [],
    );
    const malice = dedupeById(
      Array.isArray(parsed["malice"])
        ? parsed["malice"]
            .map(sanitizeHomebrewMalice)
            .filter((item): item is HomebrewMalice => item !== null)
        : [],
    );
    const encounters = dedupeById(
      Array.isArray(parsed["encounters"])
        ? parsed["encounters"]
            .map(normalizeRawEncounter)
            .filter((item): item is Encounter => item !== null)
        : [],
    );
    const negotiations = dedupeById(
      Array.isArray(parsed["negotiations"])
        ? parsed["negotiations"]
            .map(normalizeRawNegotiation)
            .filter((item): item is Negotiation => item !== null)
        : [],
    );

    if (!monsters.length && !malice.length && !encounters.length && !negotiations.length) {
      return {
        ok: false,
        error: "This bundle does not contain any monsters, Malice, encounters, or negotiations.",
      };
    }
    const kind =
      parsed["kind"] === "monster" ||
      parsed["kind"] === "malice" ||
      parsed["kind"] === "encounter" ||
      parsed["kind"] === "negotiation" ||
      parsed["kind"] === "pack"
        ? parsed["kind"]
        : encounters.length
          ? "encounter"
          : negotiations.length
            ? "negotiation"
            : monsters.length
              ? "monster"
              : "malice";
    const primaryId =
      typeof parsed["primaryId"] === "string" && parsed["primaryId"]
        ? parsed["primaryId"]
        : (encounters[0]?.id ?? monsters[0]?.id ?? malice[0]?.id ?? negotiations[0]?.id ?? "");

    const exportedAtNum = Number(parsed["exportedAt"]);
    return {
      ok: true,
      bundle: {
        format: SHARE_BUNDLE_FORMAT,
        version: SHARE_BUNDLE_VERSION,
        kind,
        exportedAt:
          Number.isFinite(exportedAtNum) && exportedAtNum > 0 ? exportedAtNum : Date.now(),
        primaryId,
        ...(monsters.length ? { monsters } : {}),
        ...(malice.length ? { malice } : {}),
        ...(encounters.length ? { encounters } : {}),
        ...(negotiations.length ? { negotiations } : {}),
      },
    };
  }

  // Raw SteelCompendium Malice record?
  if (
    !("stamina" in parsed) &&
    !("ev" in parsed) &&
    (Array.isArray(parsed["features"]) || typeof parsed["content"] === "string") &&
    typeof parsed["name"] === "string" &&
    /malice/i.test(parsed["name"])
  ) {
    const flat = flattenMalicePayload(
      parsed as RawMaliceRecord,
      `en/unified/json/monster/custom/malice.json`,
    );
    if (flat.length) {
      const malice = flat
        .map((feature) =>
          sanitizeHomebrewMalice({
            id: uuidv7(),
            origin: { kind: "imported", ...(fallbackName ? { sourceName: fallbackName } : {}) },
            name: feature.name,
            cost: feature.cost,
            costText: feature.costText,
            icon: feature.icon || "☠",
            distance: feature.distance,
            target: feature.target,
            keywords: feature.keywords,
            effects: feature.effects,
            family: "",
            familyLabel: feature.blockName || "Custom",
            minLevel: feature.minLevel,
          }),
        )
        .filter((item): item is HomebrewMalice => item !== null);
      if (malice.length) {
        return {
          ok: true,
          bundle: {
            format: SHARE_BUNDLE_FORMAT,
            version: SHARE_BUNDLE_VERSION,
            kind: malice.length === 1 ? "malice" : "pack",
            exportedAt: Date.now(),
            primaryId: malice[0]!.id,
            malice,
          },
        };
      }
    }
  }

  // Raw SteelCompendium statblock JSON?
  const fromRaw = rawStatblockToHomebrewMonster(parsed as RawStatblock, fallbackName);
  if (fromRaw) {
    return {
      ok: true,
      bundle: {
        format: SHARE_BUNDLE_FORMAT,
        version: SHARE_BUNDLE_VERSION,
        kind: "monster",
        exportedAt: Date.now(),
        primaryId: fromRaw.id,
        monsters: [fromRaw],
      },
    };
  }

  return {
    ok: false,
    error:
      "Unrecognized JSON format. Expected a Malice Menagerie export or SteelCompendium statblock JSON.",
  };
}

export async function parseImportInput(
  rawText: string,
  fallbackName?: string,
): Promise<{ ok: true; bundle: ShareBundleV1 } | { ok: false; error: string }> {
  if (rawText.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "This file is too large to import safely (4 MB limit)." };
  }
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: false, error: "Paste a share link or JSON to import." };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return validateParsedBundle(parsed, fallbackName);
    } catch {
      return {
        ok: false,
        error: "Could not parse input as valid JSON.",
      };
    }
  }
  if (extractShareToken(trimmed)) {
    return decodeBundleFromHash(trimmed);
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return validateParsedBundle(parsed, fallbackName);
  } catch {
    return {
      ok: false,
      error: "Could not parse input as a share link or valid JSON.",
    };
  }
}

// ---------- Conflict analysis & atomic resolution ----------

const FINGERPRINT_SKIP_KEYS = new Set(["updatedAt", "createdAt", "revision", "view"]);

function canonicalize(value: unknown, topLevel = false): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, false));
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (topLevel && FINGERPRINT_SKIP_KEYS.has(key)) continue;
    const child = value[key];
    if (child !== undefined) copy[key] = canonicalize(child, false);
  }
  return copy;
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value, true));
}

function classifyConflict(
  existing: { revision?: number; updatedAt?: number } | undefined,
  incoming: { revision?: number; updatedAt?: number },
  compareExisting: unknown = existing,
  compareIncoming: unknown = incoming,
): { status: ImportConflictStatus; defaultDecision: ImportDecision } {
  if (!existing) return { status: "new", defaultDecision: "add" };
  if (stableFingerprint(compareExisting) === stableFingerprint(compareIncoming)) {
    return { status: "identical", defaultDecision: "skip" };
  }
  const exRev = existing.revision ?? 1;
  const inRev = incoming.revision ?? 1;
  if (inRev > exRev) return { status: "newer", defaultDecision: "update" };
  if (inRev < exRev) return { status: "older", defaultDecision: "copy" };
  if ((incoming.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
    return { status: "newer", defaultDecision: "update" };
  }
  return { status: "modified", defaultDecision: "copy" };
}

export function itemKey(kind: ImportItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function analyzeImportBundle(bundle: ShareBundleV1, current: AppState): ImportAnalysis {
  const items: AnalyzedImportItem[] = [];
  const existingMonsters = new Map(current.homebrewMonsters.map((m) => [m.id, m]));
  const existingMalice = new Map(current.homebrewMalice.map((m) => [m.id, m]));
  const existingEncounters = new Map(current.encounters.map((e) => [e.id, e]));
  const existingNegotiations = new Map(current.negotiations.map((n) => [n.id, n]));

  for (const enc of bundle.encounters ?? []) {
    const existing = existingEncounters.get(enc.id);
    const incomingHasLiveCombat = Boolean(enc.combat?.active || enc.combat?.instances?.length);
    const compareExisting =
      existing && !incomingHasLiveCombat ? stripEncounterCombat(existing) : existing;
    const { status, defaultDecision } = classifyConflict(existing, enc, compareExisting, enc);
    const enemies = Array.isArray(enc.items)
      ? enc.items.reduce((sum, item) => sum + (isRecord(item) ? Number(item["count"]) || 0 : 0), 0)
      : 0;
    const partyInfo = enc.party ? `${enc.party.heroes} heroes Lv ${enc.party.level} · ` : "";
    items.push({
      key: itemKey("encounter", enc.id),
      kind: "encounter",
      id: enc.id,
      name: enc.name || "Untitled encounter",
      subtitle: `${partyInfo}${enemies ? `${enemies} ${enemies === 1 ? "enemy" : "enemies"}` : "Empty encounter"}`,
      status,
      ...(existing?.revision !== undefined ? { existingRevision: existing.revision } : {}),
      ...(enc.revision !== undefined ? { incomingRevision: enc.revision } : {}),
      defaultDecision,
    });
  }

  for (const neg of bundle.negotiations ?? []) {
    const existing = existingNegotiations.get(neg.id);
    const { status, defaultDecision } = classifyConflict(existing, neg);
    items.push({
      key: itemKey("negotiation", neg.id),
      kind: "negotiation",
      id: neg.id,
      name: neg.name || "Untitled NPC",
      subtitle: `Impression ${neg.impression ?? 1} · ${neg.motivations?.length ?? 0} motivations`,
      status,
      ...(existing?.revision !== undefined ? { existingRevision: existing.revision } : {}),
      ...(neg.revision !== undefined ? { incomingRevision: neg.revision } : {}),
      defaultDecision,
    });
  }

  for (const monster of bundle.monsters ?? []) {
    const existing = existingMonsters.get(monster.id);
    const { status, defaultDecision } = classifyConflict(existing, monster);
    items.push({
      key: itemKey("monster", monster.id),
      kind: "monster",
      id: monster.id,
      name: monster.name,
      subtitle: `Level ${monster.level} ${monster.organization}${monster.role ? ` ${monster.role}` : ""} · EV ${monster.ev}`,
      status,
      ...(existing?.revision !== undefined ? { existingRevision: existing.revision } : {}),
      ...(monster.revision !== undefined ? { incomingRevision: monster.revision } : {}),
      defaultDecision,
    });
  }

  for (const mal of bundle.malice ?? []) {
    const existing = existingMalice.get(mal.id);
    const { status, defaultDecision } = classifyConflict(existing, mal);
    items.push({
      key: itemKey("malice", mal.id),
      kind: "malice",
      id: mal.id,
      name: mal.name,
      subtitle: `${mal.costText || `${mal.cost} Malice`}${mal.familyLabel ? ` · ${mal.familyLabel}` : ""}`,
      status,
      ...(existing?.revision !== undefined ? { existingRevision: existing.revision } : {}),
      ...(mal.revision !== undefined ? { incomingRevision: mal.revision } : {}),
      defaultDecision,
    });
  }

  return { bundle, items };
}

function remapSourcePath(sourcePath: string, monsterIdMap: ReadonlyMap<string, string>): string {
  if (!isHomebrewMonsterPath(sourcePath)) return sourcePath;
  const oldId = homebrewMonsterIdFromPath(sourcePath);
  if (!oldId) return sourcePath;
  const nextId = monsterIdMap.get(oldId);
  if (!nextId) return sourcePath;
  const lvl = keyLevel(sourcePath);
  const nextBase = homebrewMonsterPath(nextId);
  return lvl === null ? nextBase : `${nextBase}@${lvl}`;
}

function remapEncounterIds(
  enc: Encounter,
  options: {
    asCopy: boolean;
    monsterIdMap: ReadonlyMap<string, string>;
    maliceIdMap: ReadonlyMap<string, string>;
  },
): Encounter {
  const next = structuredClone(enc);
  if (options.asCopy) {
    const origId = next.id;
    const origName = next.name;
    next.id = uuidv7();
    next.name = `${origName} (imported)`;
    next.origin = {
      kind: "imported",
      sourceId: origId,
      sourceName: origName,
      ...(next.origin?.author ? { author: next.origin.author } : {}),
    };
    const groupMap = new Map<string, string>();
    for (const group of next.groups) {
      const gid = uid("group");
      groupMap.set(group.id, gid);
      group.id = gid;
    }
    next.activePrepGroupId = groupMap.get(next.activePrepGroupId) ?? next.groups[0]?.id ?? "";
    const entryMap = new Map<string, string>();
    for (const item of next.items) {
      const eid = uid("entry");
      entryMap.set(item.id, eid);
      item.id = eid;
      item.groupId = groupMap.get(item.groupId) ?? next.activePrepGroupId;
    }
    const instMap = new Map<string, string>();
    for (const inst of next.combat.instances) {
      const iid = uid("inst");
      instMap.set(inst.id, iid);
      inst.id = iid;
    }
    for (const inst of next.combat.instances) {
      inst.groupId = groupMap.get(inst.groupId) ?? next.activePrepGroupId;
      if (inst.entryId) {
        const mappedEntry = entryMap.get(inst.entryId);
        if (mappedEntry) inst.entryId = mappedEntry;
        else delete inst.entryId;
      }
      if (inst.captainId) {
        const mapped = instMap.get(inst.captainId);
        if (mapped) inst.captainId = mapped;
        else delete inst.captainId;
      }
      if (inst.summonedBy) {
        const mapped = instMap.get(inst.summonedBy);
        if (mapped) inst.summonedBy = mapped;
        else delete inst.summonedBy;
      }
    }
    if (next.combat.activeGroupFilter) {
      next.combat.activeGroupFilter = groupMap.get(next.combat.activeGroupFilter) ?? null;
    }
    for (const eff of next.combat.activeEffects) {
      eff.id = uid("eff");
    }
  }

  for (const item of next.items) {
    item.sourcePath = remapSourcePath(item.sourcePath, options.monsterIdMap);
  }
  for (const inst of next.combat.instances) {
    inst.sourcePath = remapSourcePath(inst.sourcePath, options.monsterIdMap);
  }
  for (const eff of next.combat.activeEffects) {
    eff.sourcePath = remapSourcePath(eff.sourcePath, options.monsterIdMap);
  }
  next.combat.selectedMaliceFeatureIds = next.combat.selectedMaliceFeatureIds.map((id) => {
    if (!isHomebrewMaliceId(id)) return id;
    const uuid = homebrewMaliceUuidFromId(id);
    const mapped = uuid ? options.maliceIdMap.get(uuid) : undefined;
    return mapped ? homebrewMaliceId(mapped) : id;
  });
  next.updatedAt = Date.now();
  return next;
}

/**
 * Mutate `draft` in-place to apply an analyzed import bundle according to the
 * Director's per-item decisions, remapping transitive IDs whenever copied.
 */
export function applyImportToAppState(
  draft: AppState,
  bundle: ShareBundleV1,
  decisions: ReadonlyMap<string, ImportDecision>,
  sanitizeEncounterFn: (raw: unknown, index: number) => Encounter,
  sanitizeNegotiationFn: (raw: unknown, index: number) => Negotiation,
): AppliedImportResult {
  let added = 0;
  let updated = 0;
  let copied = 0;
  let skipped = 0;

  const maliceIdMap = new Map<string, string>();
  const monsterIdMap = new Map<string, string>();
  const updatedMonsterIds: string[] = [];
  let primaryTarget: AppliedImportResult["primaryTarget"];

  const recordPrimary = (kind: ImportItemKind, origId: string, finalId: string) => {
    if (bundle.primaryId === origId && !primaryTarget) {
      primaryTarget = { kind, id: finalId };
    }
  };

  // 1. Custom Malice first so monsters and encounters can remap maliceIds cleanly.
  for (const rawMal of bundle.malice ?? []) {
    const decision = decisions.get(itemKey("malice", rawMal.id)) ?? "add";
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const existingIdx = draft.homebrewMalice.findIndex((item) => item.id === rawMal.id);
    if (decision === "copy" || (decision === "add" && existingIdx >= 0)) {
      const next = structuredClone(rawMal);
      const nextId = uuidv7();
      maliceIdMap.set(rawMal.id, nextId);
      next.id = nextId;
      next.name = existingIdx >= 0 ? `${rawMal.name} (copy)` : rawMal.name;
      next.createdAt = Date.now();
      next.updatedAt = Date.now();
      next.revision = 1;
      next.origin = {
        kind: "imported",
        sourceId: rawMal.id,
        sourceName: rawMal.name,
        ...(rawMal.origin?.author ? { author: rawMal.origin.author } : {}),
      };
      draft.homebrewMalice.push(next);
      copied += 1;
      recordPrimary("malice", rawMal.id, next.id);
    } else if (existingIdx >= 0 && decision === "update") {
      const existing = draft.homebrewMalice[existingIdx]!;
      draft.homebrewMalice[existingIdx] = {
        ...structuredClone(rawMal),
        revision: Math.max(rawMal.revision ?? 1, existing.revision + 1),
        updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
      };
      updated += 1;
      recordPrimary("malice", rawMal.id, rawMal.id);
    } else {
      draft.homebrewMalice.push(structuredClone(rawMal));
      added += 1;
      recordPrimary("malice", rawMal.id, rawMal.id);
    }
  }

  // 2. Homebrew Monsters (remapping any copied maliceIds).
  for (const rawMon of bundle.monsters ?? []) {
    const decision = decisions.get(itemKey("monster", rawMon.id)) ?? "add";
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const remappedMaliceIds = rawMon.maliceIds?.map((id) => maliceIdMap.get(id) ?? id);
    const existingIdx = draft.homebrewMonsters.findIndex((item) => item.id === rawMon.id);
    if (decision === "copy" || (decision === "add" && existingIdx >= 0)) {
      const next = structuredClone(rawMon);
      const nextId = uuidv7();
      monsterIdMap.set(rawMon.id, nextId);
      next.id = nextId;
      next.name = existingIdx >= 0 ? `${rawMon.name} (copy)` : rawMon.name;
      next.createdAt = Date.now();
      next.updatedAt = Date.now();
      next.revision = 1;
      next.origin = {
        kind: "imported",
        sourceId: rawMon.id,
        sourceName: rawMon.name,
        ...(rawMon.origin?.author ? { author: rawMon.origin.author } : {}),
      };
      if (remappedMaliceIds) next.maliceIds = remappedMaliceIds;
      draft.homebrewMonsters.push(next);
      copied += 1;
      recordPrimary("monster", rawMon.id, next.id);
    } else if (existingIdx >= 0 && decision === "update") {
      const existing = draft.homebrewMonsters[existingIdx]!;
      const next = structuredClone(rawMon);
      if (remappedMaliceIds) next.maliceIds = remappedMaliceIds;
      next.revision = Math.max(rawMon.revision ?? 1, existing.revision + 1);
      next.updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
      draft.homebrewMonsters[existingIdx] = next;
      updatedMonsterIds.push(next.id);
      updated += 1;
      recordPrimary("monster", rawMon.id, rawMon.id);
    } else {
      const next = structuredClone(rawMon);
      if (remappedMaliceIds) next.maliceIds = remappedMaliceIds;
      draft.homebrewMonsters.push(next);
      added += 1;
      recordPrimary("monster", rawMon.id, rawMon.id);
    }
  }

  // 3. Encounters (remapping any copied monster & malice IDs).
  for (const rawEnc of bundle.encounters ?? []) {
    const decision = decisions.get(itemKey("encounter", rawEnc.id)) ?? "add";
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const sanitized = sanitizeEncounterFn(rawEnc, draft.encounters.length);
    const existingIdx = draft.encounters.findIndex((item) => item.id === sanitized.id);
    if (decision === "copy" || (decision === "add" && existingIdx >= 0)) {
      const next = remapEncounterIds(sanitized, {
        asCopy: true,
        monsterIdMap,
        maliceIdMap,
      });
      draft.encounters.push(next);
      copied += 1;
      recordPrimary("encounter", rawEnc.id, next.id);
    } else if (existingIdx >= 0 && decision === "update") {
      const next = remapEncounterIds(sanitized, {
        asCopy: false,
        monsterIdMap,
        maliceIdMap,
      });
      draft.encounters[existingIdx] = next;
      updated += 1;
      recordPrimary("encounter", rawEnc.id, next.id);
    } else {
      const next = remapEncounterIds(sanitized, {
        asCopy: false,
        monsterIdMap,
        maliceIdMap,
      });
      draft.encounters.push(next);
      added += 1;
      recordPrimary("encounter", rawEnc.id, next.id);
    }
  }

  // 4. Negotiations.
  for (const rawNeg of bundle.negotiations ?? []) {
    const decision = decisions.get(itemKey("negotiation", rawNeg.id)) ?? "add";
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const sanitized = sanitizeNegotiationFn(rawNeg, draft.negotiations.length);
    const existingIdx = draft.negotiations.findIndex((item) => item.id === sanitized.id);
    if (decision === "copy" || (decision === "add" && existingIdx >= 0)) {
      const next = structuredClone(sanitized);
      next.id = uuidv7();
      next.name = existingIdx >= 0 ? `${sanitized.name} (imported)` : sanitized.name;
      next.origin = {
        kind: "imported",
        sourceId: sanitized.id,
        sourceName: sanitized.name,
        ...(sanitized.origin?.author ? { author: sanitized.origin.author } : {}),
      };
      next.updatedAt = Date.now();
      const traitIdMap = new Map<string, string>();
      for (const trait of [...next.motivations, ...next.pitfalls]) {
        const nextTraitId = uid("trait");
        traitIdMap.set(trait.id, nextTraitId);
        trait.id = nextTraitId;
      }
      for (const entry of next.log) {
        entry.id = uid("log");
        if (entry.before) {
          entry.before.usedIds = entry.before.usedIds.map((id) => traitIdMap.get(id) ?? id);
          if (entry.before.revealedPitfallIds) {
            entry.before.revealedPitfallIds = entry.before.revealedPitfallIds.map(
              (id) => traitIdMap.get(id) ?? id,
            );
          }
        }
      }
      draft.negotiations.push(next);
      copied += 1;
      recordPrimary("negotiation", rawNeg.id, next.id);
    } else if (existingIdx >= 0 && decision === "update") {
      draft.negotiations[existingIdx] = { ...sanitized, updatedAt: Date.now() };
      updated += 1;
      recordPrimary("negotiation", rawNeg.id, sanitized.id);
    } else {
      draft.negotiations.push(sanitized);
      added += 1;
      recordPrimary("negotiation", rawNeg.id, sanitized.id);
    }
  }

  return {
    added,
    updated,
    copied,
    skipped,
    ...(updatedMonsterIds.length ? { updatedMonsterIds } : {}),
    ...(primaryTarget ? { primaryTarget } : {}),
  };
}

export function downloadBundleJson(bundle: ShareBundleV1, filenameBase: string): void {
  const safe =
    filenameBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "malice-menagerie-export";
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safe}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
