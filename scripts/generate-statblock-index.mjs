#!/usr/bin/env node
/**
 * Regenerate the bundled Draw Steel statblock index used to resolve Malice
 * monsters to Seamus Finlayson's Draw Steel Tools `resourceId`s.
 *
 * Source: https://github.com/SeamusFinlayson/draw-steel-tools-2
 * File:   src/statblockSearch/devScriptButtons/monsterIndex.json
 *
 * The index is a snapshot, not a runtime dependency: Owlbear and Seamus's
 * extension must keep working if his GitHub is unreachable. Re-run this when
 * a Draw Steel release adds monsters.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../shared/obr/statblockIndex.generated.ts");
const URL =
  "https://raw.githubusercontent.com/SeamusFinlayson/draw-steel-tools-2/main/src/statblockSearch/devScriptButtons/monsterIndex.json";

const MIN_EXPECTED_STATBLOCKS = 100;

const response = await fetch(URL, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Could not fetch monster index: ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows)) throw new Error("Monster index is not an array.");

const statblocks = rows
  .filter((row) => row && row.type === "statblock")
  .map((row) => ({
    id: String(row.id),
    name: String(row.name),
    level: Number(row.level),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    ancestry: Array.isArray(row.ancestry) ? row.ancestry.map(String) : [],
  }))
  .filter((row) => row.id && row.name && Number.isFinite(row.level))
  .sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") || a.level - b.level || a.id.localeCompare(b.id, "en"),
  );

if (statblocks.length < MIN_EXPECTED_STATBLOCKS) {
  throw new Error(
    `Expected at least ${MIN_EXPECTED_STATBLOCKS} statblocks, got ${statblocks.length}. Refusing to overwrite index.`,
  );
}

const generatedDate = new Date().toISOString().slice(0, 10);
const body = `/**
 * GENERATED FILE - do not edit by hand.
 *
 * Draw Steel statblocks published by the Draw Steel Tools extension, reduced
 * to the fields needed to resolve a Malice monster to a \`resourceId\`.
 *
 * Source: https://github.com/SeamusFinlayson/draw-steel-tools-2
 * Regenerate: pnpm run generate:statblock-index
 * Generated: ${generatedDate}
 *
 * ${statblocks.length} statblocks.
 */

export interface IndexedStatblock {
  id: string;
  name: string;
  level: number;
  roles: string[];
  ancestry: string[];
}

export const STATBLOCK_INDEX: readonly IndexedStatblock[] = [
${statblocks.map((row) => `  ${JSON.stringify(row)},`).join("\n")}
] as const;
`;

await writeFile(OUT, body, "utf8");
console.log(`Wrote ${statblocks.length} statblocks to ${OUT}`);
