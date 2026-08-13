export const REPO = {
  owner: "SteelCompendium",
  name: "data-unified",
  ref: "main",
} as const;

export const API_ROOT = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
export const RAW_ROOT = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.ref}/`;
export const SOURCE_ROOT = "https://steelcompendium.io/v2/Browse/";
export const STATBLOCK_RE = /^en\/(unified)\/json\/monster\/(.+?)\/statblock\/([^/]+)\.json$/i;
export const CONDITION_RE = /^en\/unified\/json\/condition\/([^/]+)\.json$/i;

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
