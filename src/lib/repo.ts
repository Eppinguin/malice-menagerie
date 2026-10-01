export const REPO = {
  owner: "SteelCompendium",
  name: "data-unified",
  ref: "main",
} as const;

export const API_ROOT = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
export const RAW_ROOT = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.ref}/`;
export const SOURCE_ROOT = "https://steelcompendium.io/v2/Browse/";
export const STATBLOCK_RE = /^en\/(unified)\/json\/monster\/(.+?)\/statblock\/([^/]+)\.json$/i;
/**
 * Monster folders that hold hero-side creatures rather than Director monsters:
 * summoner minions and champions, beastheart companions, and class summons.
 * They share names with real monsters (a level-0 "Skeleton" beside the horde
 * one), so they are kept out of the library.
 */
export const HERO_SIDE_FAMILY_RE = /^(minion|champion|companion|summon)(\/|$)/i;
export const CONDITION_RE =/^en\/unified\/json\/condition\/([^/]+)\.json$/i;
/** A content reference in the data, e.g. "scc.v1:mcdm.heroes.v1/rule.combat/adjacent". */
const SCC_REF_RE = /^scc\.v\d+:(.+)$/i;

export interface GitTreeItem {
  path?: string;
  type?: string;
}

export interface GitTreeResponse {
  tree?: GitTreeItem[];
  truncated?: boolean;
}

interface GitBranchResponse {
  commit?: { commit?: { tree?: { sha?: string } } };
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
  if (route[0] === "chapter") return null;
  if (!route.length) return null;
  // The document keeps the path the data gives it; the page is filed the way
  // the site files it, and for a monster group the two differ.
  const path = `en/unified/json/${route.join("/")}.json`;
  if (route[0] === "monster" && route[1] === "group") route.splice(1, 1);
  return { url: `${SOURCE_ROOT}${route.map(encodeURIComponent).join("/")}/`, path };
}

export function rawUrl(path: string): string {
  return RAW_ROOT + path.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/");
}

/**
 * Fetch and parse a JSON document. The type parameter describes the *expected*
 * shape; callers must treat every field defensively (all raw types are
 * optional-field interfaces).
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json, application/json" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function fetchRepositoryTree(): Promise<GitTreeResponse> {
  let response = await fetch(`${API_ROOT}/git/trees/${encodeURIComponent(REPO.ref)}?recursive=1`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.ok) return response.json() as Promise<GitTreeResponse>;

  const branch = await fetchJson<GitBranchResponse>(
    `${API_ROOT}/branches/${encodeURIComponent(REPO.ref)}`,
  );
  const treeSha = branch.commit?.commit?.tree?.sha;
  if (!treeSha) throw new Error("Could not resolve the SteelCompendium repository tree.");
  response = await fetch(`${API_ROOT}/git/trees/${treeSha}?recursive=1`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`SteelCompendium tree request failed (${response.status}).`);
  return response.json() as Promise<GitTreeResponse>;
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
