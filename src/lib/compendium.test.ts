import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalogEntry, normalizeMonster } from "./catalog.ts";
import {
  collectPreviewPaths,
  collectReferencedPaths,
  validateCompendiumDocs,
  validateCompendiumIndex,
} from "./compendium.ts";
import { displayableMaliceFeatures, isMaliceCandidatePath } from "./malice.ts";
import { CONDITION_RE, STATBLOCK_RE, familyChunkKey, type CompendiumIndex } from "./repo.ts";
import { ruleSource } from "./rulePreview.ts";
import type { CatalogEntry, RawMaliceRecord, RawStatblock } from "../types.ts";

const DATA = new URL("../../public/data/", import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), "utf8")) as T;

const index = read<CompendiumIndex>("index.json");
const chunkFiles = readdirSync(new URL("monsters/", DATA)).filter((file) => file.endsWith(".json"));
const chunks = new Map(
  chunkFiles.map((file) => [
    file.replace(/\.json$/, ""),
    read<Record<string, RawStatblock>>(`monsters/${file}`),
  ]),
);
const statblocks: Record<string, RawStatblock> = Object.assign({}, ...chunks.values());
const docs = {
  statblocks,
  malice: read<Record<string, RawMaliceRecord>>("malice.json"),
  conditions: read<Record<string, unknown>>("conditions.json"),
  rules: read<Record<string, unknown>>("rules.json"),
};

describe("bundled compendium snapshot", () => {
  it("is pinned to an upstream commit", () => {
    expect(index.schemaVersion).toBe(1);
    expect(index.upstream.owner).toBe("SteelCompendium");
    expect(index.upstream.sha).toMatch(/^[0-9a-f]{40}$/i);
    expect(Number.isNaN(Date.parse(index.generatedAt))).toBe(false);
  });

  it("keeps the index consistent with the documents on disk", () => {
    expect(validateCompendiumIndex(index, docs)).toEqual([]);
  });

  it("passes the app's data invariants", () => {
    const result = validateCompendiumDocs(docs);
    expect(result.errors).toEqual([]);
    expect(result.summary.catalog).toBeGreaterThanOrEqual(440);
    expect(result.summary.maliceFeatures).toBeGreaterThanOrEqual(180);
    expect(result.summary.evCoverage).toBeGreaterThanOrEqual(0.89);
  });

  it("resolves every indexed statblock to its family chunk", () => {
    for (const path of index.paths.filter((candidate) => STATBLOCK_RE.test(candidate))) {
      const familyPath = path.match(STATBLOCK_RE)?.[2] ?? "";
      const chunk = chunks.get(familyChunkKey(familyPath));
      expect(chunk, `${path} has no ${familyChunkKey(familyPath)} chunk`).toBeDefined();
      expect(chunk?.[path], `${path} is missing from its chunk`).toBeDefined();
    }
  });

  it("does not leave stale monster chunks behind", () => {
    const expected = new Set(
      index.paths
        .map((path) => path.match(STATBLOCK_RE)?.[2])
        .filter((familyPath): familyPath is string => Boolean(familyPath))
        .map(familyChunkKey),
    );
    expect([...chunks.keys()].sort()).toEqual([...expected].sort());
  });

  it("maps each monster family to its own chunk key", () => {
    const owners = new Map<string, string>();
    for (const path of index.paths) {
      const familyPath = path.match(STATBLOCK_RE)?.[2];
      if (!familyPath) continue;
      const key = familyChunkKey(familyPath);
      expect(owners.get(key) ?? familyPath).toBe(familyPath);
      owners.set(key, familyPath);
    }
  });

  it("builds the library and normalizes every official monster", () => {
    const entries = index.paths
      .map(buildCatalogEntry)
      .filter((entry): entry is CatalogEntry => entry !== null);
    expect(entries.length).toBeGreaterThanOrEqual(440);
    const roles = new Set<string>();
    const keywords = new Set<string>();
    let maxLevel = 0;
    let withOrganization = 0;
    for (const entry of entries) {
      const raw = statblocks[entry.path];
      expect(raw, `${entry.path} is missing`).toBeDefined();
      const monster = normalizeMonster(raw as RawStatblock, entry.path);
      expect(monster.name.trim(), entry.path).not.toBe("");
      expect(Number.isFinite(monster.level), entry.path).toBe(true);
      expect(monster.stamina, entry.path).toBeGreaterThanOrEqual(0);
      if (monster.organization !== "—") withOrganization += 1;
      expect(monster.turnsPerRound, entry.path).toBeGreaterThanOrEqual(1);
      if (monster.role) roles.add(monster.role);
      for (const keyword of monster.keywords) keywords.add(keyword);
      maxLevel = Math.max(maxLevel, monster.level);
    }
    // Facet filters would silently collapse if these emptied out.
    expect(roles.size).toBeGreaterThan(0);
    expect(keywords.size).toBeGreaterThan(0);
    expect(maxLevel).toBeGreaterThanOrEqual(10);
    expect(withOrganization / entries.length).toBeGreaterThanOrEqual(0.97);
  });

  it("splits statblocks, Malice and conditions the way the app reads them", () => {
    for (const path of index.paths) {
      const known =
        STATBLOCK_RE.test(path) || isMaliceCandidatePath(path) || CONDITION_RE.test(path);
      expect(known, `${path} matches none of the app's document kinds`).toBe(true);
    }
    for (const path of Object.keys(docs.malice)) {
      expect(isMaliceCandidatePath(path), path).toBe(true);
    }
    for (const path of Object.keys(docs.conditions)) {
      expect(CONDITION_RE.test(path), path).toBe(true);
    }
  });

  it("routes every bundled hover target to the file that holds it", () => {
    const bundles = {
      "/data/conditions.json": docs.conditions,
      "/data/malice.json": docs.malice,
      "/data/rules.json": docs.rules,
      ...Object.fromEntries(
        [...chunks].map(([key, chunk]) => [`/data/monsters/${key}.json`, chunk]),
      ),
    };
    const misrouted: string[] = [];
    for (const [file, bundle] of Object.entries(bundles)) {
      for (const path of Object.keys(bundle)) {
        const source = ruleSource(path);
        if (source !== file) {
          misrouted.push(`${path} is in ${file} but the loader reads ${source}`);
        }
      }
    }
    expect(misrouted).toEqual([]);
  });
});

describe("compendium validation", () => {
  it("rejects a statblock that lost its name or level", () => {
    const result = validateCompendiumDocs({
      statblocks: {
        "en/unified/json/monster/gnoll/statblock/gnoll-marauder.json": {
          level: "2",
          stamina: "20",
          organization: "Horde",
        },
      },
      malice: {},
      conditions: {},
      rules: {},
    });
    expect(result.errors.join("\n")).toMatch(/no name/);
    expect(result.errors.join("\n")).toMatch(/below the .* floor/);
  });

  it("rejects a non-string organization and allows an omitted organization", () => {
    const path = "en/unified/json/monster/gnoll/statblock/gnoll-marauder.json";
    const { organization: _organization, ...statblock } = statblocks[path]!;
    const malformed = { ...statblock, organization: 3 };
    const validate = (raw: unknown) =>
      validateCompendiumDocs({ ...docs, statblocks: { ...statblocks, [path]: raw } });

    expect(validate(malformed).errors).toEqual([`${path}: statblock organization is not a string`]);
    const omitted = validate(statblock);
    expect(omitted.errors).toEqual([]);
    expect(omitted.warnings).toContain(`${path}: statblock has no organization`);
  });

  it("rejects non-string movement and allows an omitted movement field", () => {
    const path = Object.keys(statblocks).find((key) => statblocks[key]?.movement === "Fly, hover")!;
    const { movement, ...statblock } = statblocks[path]!;
    const validate = (raw: unknown) =>
      validateCompendiumDocs({ ...docs, statblocks: { ...statblocks, [path]: raw } });

    expect(validate({ ...statblock, movement: [movement] }).errors).toEqual([
      `${path}: statblock movement is not a string`,
    ]);
    expect(validate(statblock).errors).toEqual([]);
  });

  it("rejects Malice that no longer flattens into features", () => {
    const result = validateCompendiumDocs({
      statblocks: {},
      malice: {
        "en/unified/json/monster/gnoll/malice.json": { name: "Gnoll Malice", features: [] },
      },
      conditions: {},
      rules: {},
    });
    expect(result.errors.join("\n")).toMatch(/yields no displayable features/);
  });

  it("rejects a Malice document whose named, priced feature has no displayable effect", () => {
    const path = "en/unified/json/monster/ajax-the-invincible/ajaxs-malice.json";
    const result = validateCompendiumDocs({
      ...docs,
      malice: {
        ...docs.malice,
        [path]: {
          name: "Ajax's Malice",
          features: [{ name: "Test Feature", cost: "3 Malice", description: "Moved effect text." }],
        },
      },
    });
    const original = validateCompendiumDocs(docs);
    expect(result.errors).toContain(`${path}: Malice document yields no displayable features`);
    expect(result.summary.maliceFeatures).toBeLessThan(original.summary.maliceFeatures);
  });

  it.each([
    [
      { name: "Unreadable", cost: "3 Malice", description: "Moved effect text." },
      'feature "Unreadable" has no displayable effect',
    ],
    [
      { name: "Unpriced", body: "This would be merged into the previous row." },
      '"Unpriced" has no Malice cost',
    ],
    [
      { name: "Mispriced", cost: "three Malice", body: "An effect." },
      'feature "Mispriced" has unsupported Malice cost "three Malice"',
    ],
    [
      { name: "Readable", cost: "3 Malice", body: "Different effect with the same identity." },
      'duplicate feature "Readable" at Malice cost 3',
    ],
  ])("rejects an individual Malice feature even when another survives (%j)", (feature, issue) => {
    const path = "en/unified/json/monster/ajax-the-invincible/ajaxs-malice.json";
    const result = validateCompendiumDocs({
      ...docs,
      malice: {
        ...docs.malice,
        [path]: {
          features: [{ name: "Readable", cost: "3 Malice", body: "An effect." }, feature],
        },
      },
    });
    expect(result.errors).toEqual([`${path}: ${issue}`]);
  });

  it.each([
    ["Signature", 0],
    [3, 3],
    ["5+ Malice", 5],
    ["3-7 Malice", 3],
    ["2-7+ Malice", 2],
  ])("reads the minimum spend for Malice cost %s", (cost, minimum) => {
    const issues: string[] = [];
    const features = displayableMaliceFeatures(
      { features: [{ name: "Feature", cost, body: "An effect." }] },
      "en/unified/json/monster/gnoll/malice.json",
      (issue) => issues.push(issue),
    );
    expect(issues).toEqual([]);
    expect(features).toMatchObject([{ cost: minimum, costText: String(cost) }]);
  });

  it("rejects a Markdown Malice feature with an unreadable effect block", () => {
    const path = "en/unified/json/rule/monster/malice.json";
    const result = validateCompendiumDocs({
      ...docs,
      malice: {
        ...docs.malice,
        [path]: {
          content: "> **Readable (3 Malice)**\n>\n> An effect.\n\n> **Unreadable (5 Malice)**",
        },
      },
    });
    expect(result.errors).toEqual([`${path}: feature "Unreadable" has no displayable effect`]);
  });

  it.each(["three Malice", "3", ""])("rejects an unsupported Markdown cost %j", (cost) => {
    const path = "en/unified/json/rule/monster/malice.json";
    const result = validateCompendiumDocs({
      ...docs,
      malice: {
        ...docs.malice,
        [path]: {
          content: `> **Mispriced (${cost})**\n>\n> An effect.\n\n> **Readable (5 Malice)**\n>\n> Another effect.`,
        },
      },
    });
    expect(result.errors).toEqual([
      `${path}: feature "Mispriced" has unsupported Malice cost "${cost}"`,
    ]);
  });

  it("preserves the IDs of bundled Markdown Malice features", () => {
    const path = "en/unified/json/rule/monster/malice.json";
    const features = displayableMaliceFeatures(docs.malice[path]!, path);
    expect(features.map(({ id, name }) => [id, name])).toEqual([
      [`${path}#0`, "Brutal Effectiveness"],
      [`${path}#1`, "Malicious Strike"],
    ]);
    expect(features[1]?.effects[0]?.effect).not.toContain("That's So Much Malice!");
  });

  it("rejects a missing Markdown Malice cost without reassigning a later feature's ID", () => {
    const path = "en/unified/json/rule/monster/malice.json";
    const raw = docs.malice[path]!;
    const malformed = { ...raw, content: raw.content!.replace(" (3 Malice)", "") };
    const result = validateCompendiumDocs({
      ...docs,
      malice: { ...docs.malice, [path]: malformed },
    });

    expect(result.errors).toEqual([`${path}: feature "Brutal Effectiveness" has no Malice cost`]);
    expect(displayableMaliceFeatures(malformed, path)).toMatchObject([
      { id: `${path}#1`, name: "Malicious Strike" },
    ]);
  });

  it("rejects a condition whose Markdown yields an empty picker description", () => {
    const path = "en/unified/json/condition/slowed.json";
    const result = validateCompendiumDocs({
      ...docs,
      conditions: { ...docs.conditions, [path]: { name: "Slowed", text: "`_`" } },
    });
    expect(result.errors).toEqual([`${path}: condition has no displayable description`]);
  });

  it.each([undefined, "# Adjacent", { moved: "Unreadable." }])(
    "rejects a rule whose content yields an empty hover excerpt (%j)",
    (content) => {
      const path = "en/unified/json/rule/combat/adjacent.json";
      const result = validateCompendiumDocs({
        ...docs,
        rules: { ...docs.rules, [path]: { name: "Adjacent", content } },
      });
      expect(result.errors).toEqual([`${path}: rule has no displayable hover excerpt`]);
    },
  );

  it("requires built-in Studio previews even without upstream references", () => {
    const path = "en/unified/json/rule/combat/adjacent.json";
    expect(collectPreviewPaths([])).toContain(path);

    const result = validateCompendiumDocs({
      statblocks: {},
      malice: {},
      conditions: {},
      rules: {},
    });
    expect(result.errors).toContain(`${path}: referenced preview is missing from the snapshot`);
  });

  it("finds cross-references in nested rule text", () => {
    const refs = collectReferencedPaths({
      features: [
        {
          effects: [{ effect: "See scc.v1:mcdm.heroes.v1/rule.combat/adjacent and nothing else." }],
        },
      ],
    });
    expect([...refs]).toEqual(["en/unified/json/rule/combat/adjacent.json"]);
  });
});
