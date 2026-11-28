#!/usr/bin/env node
/**
 * Snapshot the SteelCompendium documents this app reads into `public/data/`.
 *
 * The app only fetches from GitHub for previews outside the snapshot.
 * This script runs weekly in CI:
 * it resolves the upstream commit, downloads the statblocks, Malice and
 * conditions the app shows, then follows the built-in Studio links and the
 * upstream cross-references so hover previews resolve offline. Nothing is written until
 * the snapshot passes the same invariants the tests enforce.
 *
 * Usage: node scripts/sync-compendium.ts [--force]
 *
 * `--force` regenerates even when upstream is unchanged, for when the chunk
 * layout or validation itself changed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPreviewPaths,
  collectReferencedPaths,
  validateCompendiumDocs,
  validateCompendiumIndex,
  type CompendiumDocs,
} from "../src/lib/compendium.ts";
import { isMaliceCandidatePath } from "../src/lib/malice.ts";
import {
  CONDITION_RE,
  REPO,
  STATBLOCK_RE,
  familyChunkKey,
  type CompendiumIndex,
} from "../src/lib/repo.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = join(ROOT, "public", "data");
const API_ROOT = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}`;
const CONCURRENCY = 16;
const MAX_CLOSURE_ROUNDS = 6;
/** A runaway closure would bloat every install; fail instead of silently shipping it. */
const MAX_RULE_DOCS = 2500;

interface TreeItem {
  path?: string;
  type?: string;
}

interface TreeResponse {
  tree?: TreeItem[];
  truncated?: boolean;
}

interface CommitResponse {
  sha?: string;
  commit?: {
    committer?: { date?: string };
    author?: { date?: string };
    tree?: { sha?: string };
  };
}

function fail(message: string): never {
  console.error(`sync-compendium: ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function request(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json, application/json",
          "User-Agent": "malice-menagerie-data-sync",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok || response.status === 404) return response;
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      lastError = new Error(
        `${response.status} ${response.statusText} for ${url}` +
          (remaining === "0" && reset
            ? ` (GitHub rate limit exhausted; resets at ${new Date(Number(reset) * 1000).toISOString()})`
            : ""),
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await sleep(750 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function requestJson<T>(url: string, attempts = 3): Promise<T> {
  const response = await request(url, attempts);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

async function resolveUpstream(): Promise<{ paths: string[]; sha: string; date: string }> {
  // Resolve the commit first, then list the tree behind that exact commit, so
  // a push landing mid-run cannot pair one commit's sha with another's paths.
  const commit = await requestJson<CommitResponse>(
    `${API_ROOT}/commits/${encodeURIComponent(REPO.ref)}`,
  );
  const sha = commit.sha;
  const treeSha = commit.commit?.tree?.sha;
  if (!sha || !treeSha) fail("could not resolve the upstream commit and tree SHAs");

  const tree = await requestJson<TreeResponse>(
    `${API_ROOT}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );
  if (tree.truncated) fail("the GitHub tree response was truncated");
  const paths = (tree.tree || [])
    .filter((item) => item.type === "blob" && typeof item.path === "string")
    .map((item) => item.path as string);
  if (!paths.length) fail("the upstream tree listed no files");

  const date =
    commit.commit?.committer?.date || commit.commit?.author?.date || new Date().toISOString();
  return { paths, sha, date };
}

async function downloadAll(paths: readonly string[], sha: string): Promise<Map<string, unknown>> {
  const queue = [...paths];
  const docs = new Map<string, unknown>();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const path = queue.pop();
        if (!path) continue;
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        const response = await request(`${RAW_ROOT}/${sha}/${encoded}`);
        if (!response.ok) throw new Error(`could not download ${path} (${response.status})`);
        docs.set(path, await response.json());
      }
    }),
  );
  return docs;
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function readJsonIfPresent<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeIfChanged(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileSync(path, content);
  return true;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  console.log("sync-compendium: resolving upstream…");
  const { paths, sha, date } = await resolveUpstream();
  const available = new Set(paths);

  const existing = readJsonIfPresent<CompendiumIndex>(join(OUT_DIR, "index.json"));
  const bundleComplete = ["malice.json", "conditions.json", "rules.json", "monsters"].every(
    (name) => existsSync(join(OUT_DIR, name)),
  );
  if (!force && bundleComplete && existing?.upstream?.sha === sha && existing.schemaVersion === 1) {
    console.log(`sync-compendium: already at ${sha.slice(0, 12)} (${date}); nothing to do.`);
    return;
  }

  const corePaths = paths
    .filter(
      (path) => STATBLOCK_RE.test(path) || CONDITION_RE.test(path) || isMaliceCandidatePath(path),
    )
    .sort();
  if (!corePaths.length) fail("the upstream tree has no statblocks, Malice or conditions");

  // A chunk key collision would silently mix two monster families.
  const chunkOwners = new Map<string, string>();
  for (const path of corePaths) {
    const familyPath = path.match(STATBLOCK_RE)?.[2];
    if (!familyPath) continue;
    const key = familyChunkKey(familyPath);
    const owner = chunkOwners.get(key);
    if (owner && owner !== familyPath) {
      fail(`monster families "${owner}" and "${familyPath}" both map to chunk "${key}"`);
    }
    chunkOwners.set(key, familyPath);
  }

  console.log(
    `sync-compendium: downloading ${corePaths.length} documents from ${sha.slice(0, 12)}…`,
  );
  const coreDocs = await downloadAll(corePaths, sha);

  // Follow cross-references so hover previews resolve offline too. Refs are
  // only followed one document at a time; the cap guards against a runaway
  // closure if upstream starts linking the whole book.
  const ruleDocs = new Map<string, unknown>();
  let frontier = collectPreviewPaths(coreDocs.values());
  for (let round = 0; round < MAX_CLOSURE_ROUNDS; round += 1) {
    const batch = [...frontier].filter(
      (path) => available.has(path) && !coreDocs.has(path) && !ruleDocs.has(path),
    );
    if (!batch.length) break;
    if (ruleDocs.size + batch.length > MAX_RULE_DOCS) {
      fail(`the rule reference closure exceeded ${MAX_RULE_DOCS} documents`);
    }
    console.log(
      `sync-compendium: round ${round + 1}: downloading ${batch.length} referenced documents…`,
    );
    const docs = await downloadAll(batch, sha);
    frontier = new Set<string>();
    for (const [path, doc] of docs) {
      ruleDocs.set(path, doc);
      for (const ref of collectReferencedPaths(doc)) {
        if (!coreDocs.has(ref) && !ruleDocs.has(ref) && available.has(ref)) frontier.add(ref);
      }
    }
  }

  const statblocks: Record<string, unknown> = {};
  const malice: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};
  for (const [path, doc] of coreDocs) {
    if (STATBLOCK_RE.test(path)) statblocks[path] = doc;
    else if (isMaliceCandidatePath(path)) malice[path] = doc;
    else if (CONDITION_RE.test(path)) conditions[path] = doc;
  }
  const rules: Record<string, unknown> = {};
  for (const [path, doc] of ruleDocs) rules[path] = doc;

  const docs: CompendiumDocs = { statblocks, malice, conditions, rules };
  const validation = validateCompendiumDocs(docs);
  const index: CompendiumIndex = {
    schemaVersion: 1,
    generatedAt: date,
    upstream: { owner: REPO.owner, name: REPO.name, ref: REPO.ref, sha },
    counts: {
      statblocks: Object.keys(statblocks).length,
      malice: Object.keys(malice).length,
      conditions: Object.keys(conditions).length,
      rules: Object.keys(rules).length,
    },
    paths: corePaths,
  };
  validation.errors.push(...validateCompendiumIndex(index, docs));

  const { summary } = validation;
  console.log(
    `sync-compendium: ${summary.statblocks} statblocks (${summary.catalog} in the library), ` +
      `${summary.maliceDocs} Malice docs → ${summary.maliceFeatures} features, ` +
      `${summary.conditions} conditions, ${summary.rules} rule docs`,
  );
  console.log(
    `sync-compendium: coverage EV ${(summary.evCoverage * 100).toFixed(1)}%, ` +
      `Stamina ${(summary.staminaCoverage * 100).toFixed(1)}%, ` +
      `organization ${(summary.organizationCoverage * 100).toFixed(1)}%`,
  );
  if (validation.warnings.length) {
    console.log(`sync-compendium: ${validation.warnings.length} warnings`);
    for (const warning of validation.warnings.slice(0, 10)) console.log(`  - ${warning}`);
    if (validation.warnings.length > 10) console.log("  - …");
  }
  if (validation.errors.length) {
    console.error(`sync-compendium: refusing to write ${validation.errors.length} problems:`);
    for (const error of validation.errors.slice(0, 40)) console.error(`  - ${error}`);
    if (validation.errors.length > 40) console.error("  - …");
    process.exit(1);
  }

  // Write only after the snapshot is known good.
  const writes = new Map<string, string>();
  writes.set("index.json", JSON.stringify(index, null, 2));
  writes.set("malice.json", JSON.stringify(sortRecord(malice), null, 2));
  writes.set("conditions.json", JSON.stringify(sortRecord(conditions), null, 2));
  writes.set("rules.json", JSON.stringify(sortRecord(rules), null, 2));
  const chunks = new Map<string, Record<string, unknown>>();
  for (const [path, doc] of Object.entries(statblocks)) {
    const familyPath = path.match(STATBLOCK_RE)?.[2] || "";
    const key = familyChunkKey(familyPath);
    const chunk = chunks.get(key) ?? {};
    chunk[path] = doc;
    chunks.set(key, chunk);
  }
  for (const [key, chunk] of chunks) {
    writes.set(`monsters/${key}.json`, JSON.stringify(sortRecord(chunk), null, 2));
  }

  let changed = 0;
  const changedFiles: string[] = [];
  for (const [relative, content] of writes) {
    if (writeIfChanged(join(OUT_DIR, relative), content)) {
      changed += 1;
      changedFiles.push(relative);
    }
  }
  const expectedMonsterChunks = new Set([...chunks.keys()].map((key) => `${key}.json`));
  const monsterDir = join(OUT_DIR, "monsters");
  if (existsSync(monsterDir)) {
    for (const file of readdirSync(monsterDir)) {
      if (!expectedMonsterChunks.has(file)) {
        rmSync(join(monsterDir, file));
        changed += 1;
        changedFiles.push(`monsters/${file} (removed)`);
      }
    }
  }

  const previousPaths = new Set(existing?.paths ?? []);
  const added = corePaths.filter((path) => !previousPaths.has(path)).length;
  const removed = existing ? [...previousPaths].filter((path) => !available.has(path)).length : 0;
  console.log(
    `sync-compendium: wrote ${changed} changed file(s)` +
      (existing ? ` (${added} new, ${removed} removed since the last snapshot)` : ""),
  );
  for (const file of changedFiles.slice(0, 12)) console.log(`  ~ ${file}`);
  if (changedFiles.length > 12) console.log("  ~ …");
}

await main();
