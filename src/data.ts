import { batch, computed, signal } from "@preact/signals";
import {
  CONDITION_RE,
  STATBLOCK_RE,
  fetchJson,
  fetchRepositoryTree,
  rawUrl,
  runPool,
  sourceUrl,
} from "./lib/repo.ts";
import {
  familyLabel,
  normalizeToken,
  numberFrom,
  parseEv,
  plainText,
  slugToLabel,
} from "./lib/text.ts";
import { flattenMalicePayload, isMaliceCandidatePath } from "./lib/malice.ts";
import { isRecord } from "./types.ts";
import type {
  CatalogEntry,
  ConditionEntry,
  MaliceFeature,
  Monster,
  MonsterFeature,
  RawMaliceRecord,
  RawStatblock,
} from "./types.ts";

const CATALOG_CONCURRENCY = 12;
const MALICE_CONCURRENCY = 8;
const CONDITION_CONCURRENCY = 8;

// ---------- Reactive source-data state ----------

export const catalog = signal<CatalogEntry[]>([]);
export const sourceLoading = signal(true);
export const sourceError = signal("");
export const hydratedCount = signal(0);
export const hydrationErrors = signal(0);
/** Bumped (throttled) whenever any monster finishes loading into the cache. */
export const monstersVersion = signal(0);
export const maliceFeatures = signal<MaliceFeature[]>([]);
export const maliceLoading = signal(true);
export const conditionCatalog = signal<ConditionEntry[]>([]);

export const catalogByPath = new Map<string, CatalogEntry>();
export const monsterCache = new Map<string, Monster>();
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
let pendingConditionsBump = false;
let flushQueued = false;

export function flushDataSignals(): void {
  if (!pendingHydrated && !pendingErrors && !pendingMonstersBump && !pendingConditionsBump) return;
  batch(() => {
    if (pendingHydrated) hydratedCount.value += pendingHydrated;
    if (pendingErrors) hydrationErrors.value += pendingErrors;
    if (pendingMonstersBump) monstersVersion.value += 1;
    if (pendingConditionsBump) conditionCatalog.value = conditionCatalog.value.slice();
  });
  pendingHydrated = 0;
  pendingErrors = 0;
  pendingMonstersBump = false;
  pendingConditionsBump = false;
}

function queueFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(() => {
    flushQueued = false;
    if (renderGate.paused) return; // flushed explicitly when the drag ends
    flushDataSignals();
  });
}

// ---------- Normalization ----------

function buildCatalogEntry(path: string): CatalogEntry | null {
  const match = path.match(STATBLOCK_RE);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    path,
    book: match[1],
    familyPath: match[2],
    slug: match[3],
    derivedName: slugToLabel(match[3]),
    monster: null,
    error: false,
  };
}

function normalizeFeatures(value: unknown): MonsterFeature[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as MonsterFeature[];
}

function normalizeMonster(raw: RawStatblock, path: string): Monster {
  const match = path.match(STATBLOCK_RE);
  const ev = parseEv(raw.ev, raw.organization);
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean).map(String) : [];
  const familyPath = match?.[2] || "";
  return {
    id: path,
    path,
    book: match?.[1] || "",
    familyPath,
    slug: match?.[3] || "",
    name: raw.name || slugToLabel(match?.[3] || ""),
    level: numberFrom(raw.level, 0),
    organization: raw.organization || "—",
    role: raw.role || "",
    ev: ev.unit,
    evLabel: ev.label,
    defaultQty: ev.suggestedQty,
    keywords,
    ancestry: keywords.join(", ") || familyLabel(familyPath),
    size: raw.size ?? "—",
    speed: raw.speed ?? "—",
    stamina: Math.max(0, numberFrom(raw.stamina, 0)),
    stability: raw.stability ?? "—",
    freeStrike: raw.free_strike ?? raw.freeStrike ?? "—",
    movement: raw.movement || "—",
    chars: {
      M: raw.might ?? 0,
      A: raw.agility ?? 0,
      R: raw.reason ?? 0,
      I: raw.intuition ?? 0,
      P: raw.presence ?? 0,
    },
    features: normalizeFeatures(raw.features),
    source: sourceUrl(path),
    raw,
  };
}

// ---------- Loading ----------

export function loadMonster(path: string): Promise<Monster> {
  const cached = monsterCache.get(path);
  if (cached) return Promise.resolve(cached);
  const inFlight = monsterPromises.get(path);
  if (inFlight) return inFlight;
  const promise = fetchJson<RawStatblock>(rawUrl(path))
    .then((raw) => {
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

/** Fetch the repository index and populate the catalog, malice candidate and
 *  condition lists. Throws on failure (the caller renders the error). */
export async function loadSourceIndex(): Promise<void> {
  batch(() => {
    sourceLoading.value = true;
    sourceError.value = "";
  });
  try {
    const tree = await fetchRepositoryTree();
    if (tree.truncated) throw new Error("The GitHub repository tree response was truncated.");
    const paths = (tree.tree || [])
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => item.path as string);

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

    batch(() => {
      catalog.value = entries;
      conditionCatalog.value = conditions;
      sourceLoading.value = false;
    });
  } catch (error) {
    batch(() => {
      sourceLoading.value = false;
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
  await runPool(catalog.value, CATALOG_CONCURRENCY, async (entry) => {
    if (monsterCache.has(entry.path)) {
      pendingHydrated += 1;
      queueFlush();
      return;
    }
    try {
      await loadMonster(entry.path);
    } catch {
      pendingErrors += 1;
    } finally {
      pendingHydrated += 1;
      queueFlush();
    }
  });
  flushDataSignals();
}

export async function hydrateMaliceInBackground(): Promise<void> {
  maliceLoading.value = true;
  const collected: MaliceFeature[] = [];
  await runPool(maliceCandidates, MALICE_CONCURRENCY, async (path) => {
    try {
      const raw = await fetchJson<RawMaliceRecord>(rawUrl(path));
      collected.push(...flattenMalicePayload(raw, path));
    } catch {
      // A broad path match can include non-feature documents. Ignore unreadable candidates.
    }
  });
  const seen = new Set<string>();
  const features = collected.filter((feature) => {
    const key = `${feature.name}|${feature.cost}|${feature.path}`;
    const hasContent = feature.effects.some(
      (effect) => effect.effect || effect.roll || effect.tier1 || effect.tier2 || effect.tier3,
    );
    if (!feature.name || !hasContent || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  batch(() => {
    maliceFeatures.value = features;
    maliceLoading.value = false;
  });
}

export async function hydrateConditionsInBackground(): Promise<void> {
  await runPool(conditionCatalog.value, CONDITION_CONCURRENCY, async (condition) => {
    try {
      const raw = await fetchJson<{
        name?: string;
        content?: string;
        description?: string;
        body?: string;
      }>(rawUrl(condition.path));
      condition.name = raw.name || condition.name;
      condition.description = plainText(raw.content || raw.description || raw.body || "");
    } catch {
      condition.description = "";
    }
    pendingConditionsBump = true;
    queueFlush();
  });
  flushDataSignals();
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
  for (const entry of catalog.value) {
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
  for (const entry of catalog.value) {
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

export function monsterNameForPath(sourcePath: string): string {
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
