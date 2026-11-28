export const REPO = {
  owner: "SteelCompendium",
  name: "data-unified",
  ref: "main",
} as const;

declare const __COMPENDIUM_DATA_ROOT__: string;

/** Vite fingerprints the snapshot in production. Dev and sync use public/data. */
export const DATA_ROOT =
  typeof __COMPENDIUM_DATA_ROOT__ === "string" ? __COMPENDIUM_DATA_ROOT__ : "/data/";
export const DATA_INDEX_URL = `${DATA_ROOT}index.json`;
export const MALICE_DATA_URL = `${DATA_ROOT}malice.json`;
export const CONDITIONS_DATA_URL = `${DATA_ROOT}conditions.json`;
export const RULES_DATA_URL = `${DATA_ROOT}rules.json`;
export const SOURCE_ROOT = "https://steelcompendium.io/v2/Browse/";
/** The Monsters book chapter on organizations, roles, reskinning and levels. */
export const MONSTER_BASICS_URL = "https://steelcompendium.io/v2/Read/bestiary/monster-basics/";
export const STATBLOCK_RE = /^en\/(unified)\/json\/monster\/(.+?)\/statblock\/([^/]+)\.json$/i;
/**
 * Monster folders that hold hero-side creatures rather than Director monsters:
 * summoner minions and champions, beastheart companions, and class summons.
 * They share names with real monsters (a level-0 "Skeleton" beside the horde
 * one), so they are kept out of the library.
 */
export const HERO_SIDE_FAMILY_RE = /^(minion|champion|companion|summon)(\/|$)/i;
export const CONDITION_RE = /^en\/unified\/json\/condition\/([^/]+)\.json$/i;
/** A content reference in the data, e.g. "scc.v1:mcdm.heroes.v1/rule.combat/adjacent". */
const SCC_REF_RE = /^scc\.v\d+:(.+)$/i;

export interface CompendiumIndex {
  schemaVersion: number;
  generatedAt: string;
  upstream: { owner: string; name: string; ref: string; sha: string };
  counts: { statblocks: number; malice: number; conditions: number; rules: number };
  /** Every official document the app loads up front: statblocks, Malice and conditions. */
  paths: string[];
}

export function pathTokens(path: string): string[] {
  return path.toLowerCase().split("/").filter(Boolean);
}

export function sourceUrl(path: string): string {
  const route = path
    .replace(/^en\/unified\/json\//i, "")
    .replace(/\/statblock\//i, "/")
    .replace(/\.json$/i, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${SOURCE_ROOT}${route}/`;
}

export interface SourceRef {
  /** The page on the site that explains the term. */
  url: string;
  /** The document behind that page, for fetching the rule text itself. */
  path: string;
}

/**
 * Resolve a content reference in the data to the page that explains it.
 *
 * The data cross-links its rules text with references such as
 * "scc.v1:mcdm.heroes.v1/rule.combat/adjacent": a book id, then a dotted
 * namespace that names the folders on the site, then the slug. So the book id
 * is dropped and the namespace becomes a path. Two things the site does not
 * publish the way the data names them: chapters have no page at all, and a
 * monster group is filed under the monster itself.
 *
 * Returns null when there is no page to link to, so the caller can keep the
 * text as plain prose.
 */
export function sourceRef(ref: string | undefined | null): SourceRef | null {
  const body = SCC_REF_RE.exec(String(ref || ""))?.[1];
  if (!body) return null;
  const [, ...rest] = body.split("/");
  if (!rest[0]) return null;
  const route = [...rest[0].split("."), ...rest.slice(1)];
  if (!route.length || route[0] === "chapter") return null;
  // Reject path traversal or malformed segments from untrusted imported links.
  if (
    route.some(
      (seg) =>
        !seg ||
        seg === "." ||
        seg === ".." ||
        seg.includes("/") ||
        seg.includes("\\") ||
        seg.includes("\0"),
    )
  ) {
    return null;
  }
  // The document keeps the path the data gives it; the page is filed the way
  // the site files it, and for a monster group the two differ.
  const path = `en/unified/json/${route.join("/")}.json`;
  if (route[0] === "monster" && route[1] === "group") route.splice(1, 1);
  return { url: `${SOURCE_ROOT}${route.map(encodeURIComponent).join("/")}/`, path };
}

/** A filesystem-safe, stable name for a monster family's data chunk. */
export function familyChunkKey(familyPath: string): string {
  return (
    familyPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "other"
  );
}

export function monsterChunkUrl(familyPath: string): string {
  return `${DATA_ROOT}monsters/${encodeURIComponent(familyChunkKey(familyPath))}.json`;
}

/**
 * Fetch and parse a JSON document. The type parameter describes the *expected*
 * shape; callers must treat every field defensively (all raw types are
 * optional-field interfaces).
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

/** Load an official document outside the bundled snapshot, for previews only. */
export async function fetchUpstreamDoc<T>(path: string): Promise<T | null> {
  // Imported references may be untrusted. Accept only document paths within
  // the English unified tree, on the configured upstream host and branch.
  const segments = path.split("/");
  if (
    !path.startsWith("en/unified/json/") ||
    !path.endsWith(".json") ||
    segments.some(
      (part) =>
        !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"),
    )
  ) {
    return null;
  }
  const file = segments.map(encodeURIComponent).join("/");
  return fetchJson<T>(
    `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.ref}/${file}`,
  );
}

const documentBundles = new Map<string, Promise<Record<string, unknown>>>();

/** Read a static document bundle once, sharing requests across app features. */
export function loadCompendiumDocs<T>(url: string): Promise<Record<string, T>> {
  let request = documentBundles.get(url);
  if (!request) {
    request = fetchJson<Record<string, unknown>>(url).catch((error: unknown) => {
      if (documentBundles.get(url) === request) documentBundles.delete(url);
      throw error;
    });
    documentBundles.set(url, request);
  }
  return request as Promise<Record<string, T>>;
}

export function invalidateCompendiumDocs(url: string): void {
  documentBundles.delete(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the bundled index and reject a malformed one with a useful message. */
export async function fetchCompendiumIndex(): Promise<CompendiumIndex> {
  const index = await fetchJson<CompendiumIndex>(DATA_INDEX_URL);
  if (!isRecord(index) || typeof index.schemaVersion !== "number") {
    throw new Error("The bundled compendium index is malformed.");
  }
  if (!Array.isArray(index.paths) || !index.paths.every((path) => typeof path === "string")) {
    throw new Error("The bundled compendium index has no document list.");
  }
  return index;
}

export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  onProgress?: (index: number) => void,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index] as T, index);
      onProgress?.(index);
    }
  });
  await Promise.all(runners);
}
