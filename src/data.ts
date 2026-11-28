import { batch, computed, signal } from "@preact/signals";
import {
  CONDITION_RE,
  CONDITIONS_DATA_URL,
  MALICE_DATA_URL,
  STATBLOCK_RE,
  fetchCompendiumIndex,
  invalidateCompendiumDocs,
  loadCompendiumDocs,
  monsterChunkUrl,
  runPool,
} from "./lib/repo.ts";
import { buildCatalogEntry, normalizeMonster } from "./lib/catalog.ts";
import { normalizeToken, slugToLabel } from "./lib/text.ts";
import { conditionDescription } from "./lib/ruleDoc.ts";
import { displayableMaliceFeatures, isMaliceCandidatePath } from "./lib/malice.ts";
import { atLevel, basePath, keyLevel } from "./lib/levels.ts";
import { homebrewToCatalogEntry, homebrewToMaliceFeature } from "./lib/homebrew.ts";
import { isHomebrewMonsterPath } from "./lib/id.ts";
import { isRecord } from "./types.ts";
import type {
  CatalogEntry,
  ConditionEntry,
  HomebrewMalice,
  HomebrewMonster,
  MaliceFeature,
  Monster,
  RawMaliceRecord,
  RawStatblock,
} from "./types.ts";

const CATALOG_CONCURRENCY = 12;

// ---------- Reactive source-data state ----------

export const catalog = signal<CatalogEntry[]>([]);
export const homebrewCatalog = signal<CatalogEntry[]>([]);
export const allCatalog = computed<CatalogEntry[]>(() => [
  ...homebrewCatalog.value,
  ...catalog.value,
]);
export const sourceLoading = signal(true);
export const sourceError = signal("");
/** The bundled snapshot's upstream commit and generation date, for the footer. */
export const sourceSnapshot = signal<{ sha: string; generatedAt: string } | null>(null);
export const hydratedCount = signal(0);
export const hydrationErrors = signal(0);
/** Bumped (throttled) whenever any monster finishes loading into the cache. */
export const monstersVersion = signal(0);
/** Bumped coarsely during/after official SteelCompendium hydration (never on homebrew edits). */
export const officialHydrationEpoch = signal(0);
export const maliceFeatures = signal<MaliceFeature[]>([]);
export const homebrewMaliceFeatures = signal<MaliceFeature[]>([]);
export const allMaliceFeatures = computed<MaliceFeature[]>(() => [
  ...homebrewMaliceFeatures.value,
  ...maliceFeatures.value,
]);
export const maliceLoadStatus = signal<"loading" | "ready" | "failed">("loading");
export const maliceLoading = computed(() => maliceLoadStatus.value === "loading");
export const conditionCatalog = signal<ConditionEntry[]>([]);

export const catalogByPath = new Map<string, CatalogEntry>();
export const monsterCache = new Map<string, Monster>();
export const homebrewCatalogByPath = new Map<string, CatalogEntry>();
export const homebrewMonsterCache = new Map<string, Monster>();
const monsterPromises = new Map<string, Promise<Monster>>();
let maliceCandidates: string[] = [];

// ---------- Throttled signal flushing ----------
// Hydration completes hundreds of fetches; coalesce the resulting signal
// updates into one animation frame, and hold them entirely while a pointer
// drag is in progress so the DOM under the pointer stays stable.

export const renderGate = { paused: false };

let pendingHydrated = 0;
let pendingErrors = 0;
let pendingMonstersBump = false;
let pendingConditions: ConditionEntry[] | null = null;
let flushQueued = false;

export function flushDataSignals(): void {
  if (renderGate.paused) return; // flushed explicitly when the drag ends
  if (!pendingHydrated && !pendingErrors && !pendingMonstersBump && !pendingConditions) return;
  batch(() => {
    if (pendingHydrated) hydratedCount.value += pendingHydrated;
    if (pendingErrors) hydrationErrors.value += pendingErrors;
    if (pendingMonstersBump) monstersVersion.value += 1;
    if (pendingConditions) conditionCatalog.value = pendingConditions;
  });
  pendingHydrated = 0;
  pendingErrors = 0;
  pendingMonstersBump = false;
  pendingConditions = null;
}

function queueFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(() => {
    flushQueued = false;
    flushDataSignals();
  });
}

// ---------- Loading ----------

const leveled = new Map<string, Monster>();

/**
 * Synchronize user-authored / imported homebrew monsters and custom Malice
 * into the live lookup caches and reactive catalog signals. Clears cached
 * leveled variants of homebrew monsters so edits reflect immediately.
 */
export function syncHomebrewData(
  monsters: readonly HomebrewMonster[],
  malice: readonly HomebrewMalice[],
): void {
  homebrewMonsterCache.clear();
  homebrewCatalogByPath.clear();
  for (const key of leveled.keys()) {
    if (isHomebrewMonsterPath(key)) leveled.delete(key);
  }
  const entries = monsters
    .map(homebrewToCatalogEntry)
    .sort((a, b) => a.derivedName.localeCompare(b.derivedName));
  for (const entry of entries) {
    homebrewCatalogByPath.set(entry.path, entry);
    if (entry.monster) homebrewMonsterCache.set(entry.path, entry.monster);
  }
  const maliceList = malice.map(homebrewToMaliceFeature);
  batch(() => {
    homebrewCatalog.value = entries;
    homebrewMaliceFeatures.value = maliceList;
    monstersVersion.value += 1;
  });
}

/** Official SteelCompendium family slugs known from the loaded catalog & Malice. */
export const officialFamilies = computed<
  readonly { slug: string; label: string; maliceCount: number }[]
>(() => {
  const map = new Map<string, { label: string; maliceCount: number }>();
  for (const entry of catalog.value) {
    const slug = entry.familyPath.toLowerCase().split("/").filter(Boolean)[0];
    if (slug && !map.has(slug)) map.set(slug, { label: slugToLabel(slug), maliceCount: 0 });
  }
  for (const feature of maliceFeatures.value) {
    if (feature.scope === "family" && feature.family) {
      const existing = map.get(feature.family);
      map.set(feature.family, {
        label: feature.familyLabel || existing?.label || slugToLabel(feature.family),
        maliceCount: (existing?.maliceCount ?? 0) + 1,
      });
    }
  }
  return [...map.entries()]
    .map(([slug, info]) => ({ slug, label: info.label, maliceCount: info.maliceCount }))
    .sort((a, b) => {
      const aHas = a.maliceCount > 0 ? 0 : 1;
      const bHas = b.maliceCount > 0 ? 0 : 1;
      return aHas - bHas || a.label.localeCompare(b.label);
    });
});

/**
 * The statblock a key names: the printed one for a plain source path, or
 * the same statblock at another level for "path@level" (see lib/levels).
 * Undefined until the printed statblock has loaded.
 */
export function monsterAt(key: string): Monster | undefined {
  const level = keyLevel(key);
  const plain = level === null ? key : basePath(key);
  const printed = homebrewMonsterCache.get(plain) ?? monsterCache.get(plain);
  if (!printed || level === null || level === printed.level) return printed;
  let m = leveled.get(key);
  if (!m || m.printed !== printed) {
    m = atLevel(printed, level);
    leveled.set(key, m);
  }
  return m;
}

/** Load the statblock a key names (see `monsterAt`). */
export function loadMonster(key: string): Promise<Monster> {
  const path = basePath(key);
  if (isHomebrewMonsterPath(path)) {
    const found = monsterAt(key);
    if (found) return Promise.resolve(found);
    return Promise.reject(new Error("Homebrew monster not found in library."));
  }
  if (path !== key) return loadMonster(path).then((m) => monsterAt(key) ?? m);
  const cached = monsterCache.get(path);
  if (cached) return Promise.resolve(cached);
  const inFlight = monsterPromises.get(path);
  if (inFlight) return inFlight;
  const familyPath = catalogByPath.get(path)?.familyPath ?? path.match(STATBLOCK_RE)?.[2] ?? "";
  const promise = loadCompendiumDocs<RawStatblock>(monsterChunkUrl(familyPath))
    .then((chunk) => {
      const raw = chunk[path];
      if (!raw) throw new Error(`Statblock missing from the bundled data: ${path}`);
      const monster = normalizeMonster(raw, path);
      monsterCache.set(path, monster);
      const entry = catalogByPath.get(path);
      if (entry) entry.monster = monster;
      pendingMonstersBump = true;
      queueFlush();
      return monster;
    })
    .catch((error: unknown) => {
      const entry = catalogByPath.get(path);
      if (entry) entry.error = true;
      throw error;
    })
    .finally(() => monsterPromises.delete(path));
  monsterPromises.set(path, promise);
  return promise;
}

/** Read the bundled index and populate the catalog, malice candidate and
 *  condition lists. Throws on failure (the caller renders the error). */
export async function loadSourceIndex(): Promise<void> {
  batch(() => {
    sourceLoading.value = true;
    sourceError.value = "";
    maliceLoadStatus.value = "loading";
  });
  try {
    const index = await fetchCompendiumIndex();
    const paths = index.paths;
    sourceSnapshot.value = {
      sha: index.upstream.sha,
      generatedAt: index.generatedAt,
    };

    const entries = paths
      .map(buildCatalogEntry)
      .filter((entry): entry is CatalogEntry => entry !== null)
      .sort((a, b) => a.derivedName.localeCompare(b.derivedName));
    catalogByPath.clear();
    for (const entry of entries) catalogByPath.set(entry.path, entry);
    maliceCandidates = paths.filter(isMaliceCandidatePath);

    const conditions = paths
      .map((path): ConditionEntry | null => {
        const match = path.match(CONDITION_RE);
        return match?.[1]
          ? { path, name: slugToLabel(match[1]), slug: match[1], description: null }
          : null;
      })
      .filter((entry): entry is ConditionEntry => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    pendingConditions = null;
    batch(() => {
      catalog.value = entries;
      conditionCatalog.value = conditions;
      sourceLoading.value = false;
    });
  } catch (error) {
    batch(() => {
      sourceLoading.value = false;
      maliceLoadStatus.value = "failed";
      sourceError.value = error instanceof Error ? error.message : String(error);
    });
    throw error;
  }
}

export async function hydrateCatalogInBackground(): Promise<void> {
  batch(() => {
    hydratedCount.value = 0;
    hydrationErrors.value = 0;
  });
  pendingHydrated = 0;
  pendingErrors = 0;
  let processed = 0;
  await runPool(catalog.value, CATALOG_CONCURRENCY, async (entry) => {
    if (monsterCache.has(entry.path)) {
      pendingHydrated += 1;
      processed += 1;
      if (processed % 120 === 0) officialHydrationEpoch.value += 1;
      queueFlush();
      return;
    }
    try {
      await loadMonster(entry.path);
    } catch {
      pendingErrors += 1;
    } finally {
      pendingHydrated += 1;
      processed += 1;
      if (processed % 120 === 0) officialHydrationEpoch.value += 1;
      queueFlush();
    }
  });
  flushDataSignals();
  officialHydrationEpoch.value += 1;
}

export async function hydrateMaliceInBackground(): Promise<void> {
  if (maliceLoadStatus.peek() === "failed") invalidateCompendiumDocs(MALICE_DATA_URL);
  maliceLoadStatus.value = "loading";
  try {
    const docs = await loadCompendiumDocs<RawMaliceRecord>(MALICE_DATA_URL);
    if (!isRecord(docs)) throw new Error("Malformed Malice bundle");
    const features = maliceCandidates.flatMap((path) => {
      const raw = docs[path];
      if (!isRecord(raw)) throw new Error(`Missing or malformed Malice document: ${path}`);
      const displayable = displayableMaliceFeatures(raw, path, (issue) => {
        throw new Error(`${path}: ${issue}`);
      });
      if (!displayable.length) throw new Error(`No displayable Malice features in ${path}`);
      return displayable;
    });
    batch(() => {
      maliceFeatures.value = features;
      maliceLoadStatus.value = "ready";
    });
  } catch {
    // Keep any previously loaded features usable and suspend selection pruning.
    maliceLoadStatus.value = "failed";
  }
}

export async function hydrateConditionsInBackground(): Promise<void> {
  const conditions = conditionCatalog.peek();
  const docs = await loadCompendiumDocs<unknown>(CONDITIONS_DATA_URL).catch(() => null);
  if (conditions !== conditionCatalog.peek()) return;
  pendingConditions = conditions.map((condition) => {
    const raw = docs?.[condition.path];
    const name = isRecord(raw) && typeof raw.name === "string" ? raw.name.trim() : "";
    return {
      ...condition,
      name: name || condition.name,
      description: conditionDescription(raw),
    };
  });
  queueFlush();
}

export function conditionInfo(name: string): ConditionEntry | null {
  const normalized = normalizeToken(name);
  return (
    conditionCatalog.value.find((condition) => condition.name.toLowerCase() === normalized) ?? null
  );
}

// ---------- Derived catalog data ----------

export const catalogBounds = computed(() => {
  void monstersVersion.value; // subscribe: bounds settle as data loads in
  let levelMin = Infinity;
  let levelMax = -Infinity;
  let evMin = Infinity;
  let evMax = -Infinity;
  for (const entry of allCatalog.value) {
    const m = entry.monster;
    if (!m) continue;
    levelMin = Math.min(levelMin, m.level);
    levelMax = Math.max(levelMax, m.level);
    evMin = Math.min(evMin, m.ev);
    evMax = Math.max(evMax, m.ev);
  }
  if (!Number.isFinite(levelMin)) {
    levelMin = 0;
    levelMax = 10;
  }
  if (!Number.isFinite(evMin)) {
    evMin = 0;
    evMax = 60;
  }
  return { level: [levelMin, levelMax] as const, ev: [evMin, evMax] as const };
});

export type FacetOption = readonly [value: string, label: string];

// Facet option lists derived from the hydrated catalog, so we never show
// filters that match nothing.
export const facetOptions = computed(() => {
  void monstersVersion.value; // subscribe: options settle as data loads in
  const roles = new Map<string, string>();
  const sizes = new Map<string, string>();
  const keywords = new Map<string, string>();
  for (const entry of allCatalog.value) {
    const m = entry.monster;
    if (!m) continue;
    if (m.role) roles.set(normalizeToken(m.role), m.role);
    if (m.size && m.size !== "—") sizes.set(normalizeToken(m.size), String(m.size));
    for (const keyword of m.keywords) {
      if (keyword) keywords.set(normalizeToken(keyword), keyword);
    }
  }
  const asSorted = (map: Map<string, string>): FacetOption[] =>
    [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  return { roles: asSorted(roles), sizes: asSorted(sizes), keywords: asSorted(keywords) };
});

export function catalogSearchText(entry: CatalogEntry): string {
  const m = entry.monster;
  return [
    entry.derivedName,
    entry.slug,
    entry.familyPath,
    entry.book,
    m?.name,
    m?.organization,
    m?.role,
    ...(m?.keywords || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function monsterNameForPath(key: string): string {
  const sourcePath = basePath(key);
  const homebrew = homebrewMonsterCache.get(sourcePath)?.name;
  if (homebrew) return homebrew;
  if (isHomebrewMonsterPath(sourcePath)) return "Missing homebrew monster";
  return (
    monsterCache.get(sourcePath)?.name ||
    catalogByPath.get(sourcePath)?.derivedName ||
    slugToLabel(
      sourcePath
        .split("/")
        .pop()
        ?.replace(/\.json$/i, "") ?? "",
    )
  );
}
