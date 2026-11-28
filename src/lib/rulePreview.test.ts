import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RULE_PATH = "en/unified/json/rule/combat/adjacent.json";
const CONDITION_PATH = "en/unified/json/condition/bleeding.json";
const MALICE_PATH = "en/unified/json/rule/monster/malice.json";
const SUMMONER_PATH = "en/unified/json/class/summoner.json";
const SUMMONER_URL = `https://raw.githubusercontent.com/SteelCompendium/data-unified/main/${SUMMONER_PATH}`;

function respondWith(url: string, body: unknown) {
  const fetch = vi.fn(async (request: string) => {
    if (request !== url) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A fresh module, so the loader's per-file promise caches do not leak. */
beforeEach(() => vi.resetModules());

async function loadRule(path: string) {
  const module = await import("./rulePreview.ts");
  return module.loadRule(path);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadRule", () => {
  it("reads a rule from the bundled rule closure", async () => {
    const fetch = respondWith("/data/rules.json", {
      [RULE_PATH]: { name: "Adjacent", type: "rule", content: "Adjacent creatures are near." },
    });
    const doc = await loadRule(RULE_PATH);
    expect(doc?.name).toBe("Adjacent");
    expect(doc?.kind).toBe("Rule");
    expect(doc?.html).toContain("Adjacent creatures are near.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["\n", "\n\n"])("shows prose beneath a rule title (separator %j)", async (separator) => {
    respondWith("/data/rules.json", {
      [RULE_PATH]: {
        name: "Adjacent",
        type: "rule",
        content: `# Adjacent${separator}Adjacent creatures are **near**.\n## Examples\nMore text.`,
      },
    });

    expect((await loadRule(RULE_PATH))?.html).toBe("Adjacent creatures are <strong>near</strong>.");
  });

  it("reads a condition from the condition bundle", async () => {
    respondWith("/data/conditions.json", {
      [CONDITION_PATH]: {
        name: "Bleeding",
        type: "condition",
        content: "While a creature is bleeding, they lose Stamina.",
      },
    });
    const doc = await loadRule(CONDITION_PATH);
    expect(doc?.name).toBe("Bleeding");
    expect(doc?.kind).toBe("Condition");
    expect(doc?.html).toContain("lose Stamina");
  });

  it("reads the basic Malice rule from the Malice bundle", async () => {
    respondWith("/data/malice.json", {
      [MALICE_PATH]: {
        name: "Malice",
        type: "rule",
        content: "Malice is a resource gained and used by the Director.",
      },
    });
    const doc = await loadRule(MALICE_PATH);
    expect(doc?.name).toBe("Malice");
    expect(doc?.kind).toBe("Rule");
    expect(doc?.html).toContain("gained and used by the Director");
  });

  it("previews a statblock from the same family chunk used by the catalog", async () => {
    const ref = "scc.v1:mcdm.monsters.v1/monster.demon.1st-echelon.statblock/test-demon";
    const { sourceRef } = await import("./repo.ts");
    const path = sourceRef(ref)?.path ?? "";
    const fetch = respondWith("/data/monsters/demon-1st-echelon.json", {
      [path]: {
        name: "Test Demon",
        type: "statblock",
        level: 1,
        organization: "Horde",
        role: "Brute",
        stamina: 20,
      },
    });
    const { loadMonster } = await import("../data.ts");
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    const [doc, monster] = await Promise.all([loadRule(path), loadMonster(path)]);
    expect(monster.name).toBe("Test Demon");
    expect(doc).toEqual({
      name: "Test Demon",
      kind: "Statblock",
      html: "Level 1 Horde Brute · Stamina 20",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads a saved homebrew reference outside the snapshot from the official source", async () => {
    const { sourceRef } = await import("./repo.ts");
    const path = sourceRef("scc.v1:mcdm.summoner.v1/class/summoner")?.path;
    expect(path).toBe(SUMMONER_PATH);
    const fetch = vi.fn(async (url: string) =>
      Response.json(
        url === SUMMONER_URL ? { name: "Summoner", type: "class", content: "Essence." } : {},
      ),
    );
    vi.stubGlobal("fetch", fetch);

    expect(await loadRule(path!)).toEqual({ name: "Summoner", kind: "Class", html: "Essence." });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/data/rules.json", SUMMONER_URL]);
  });

  it("retries an unbundled preview after an offline failure", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "/data/rules.json") return Response.json({});
      throw new TypeError("Offline");
    });
    vi.stubGlobal("fetch", fetch);
    expect(await loadRule(SUMMONER_PATH)).toBeNull();

    fetch.mockResolvedValueOnce(Response.json({ name: "Summoner", content: "Essence." }));
    expect((await loadRule(SUMMONER_PATH))?.name).toBe("Summoner");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/data/rules.json",
      SUMMONER_URL,
      SUMMONER_URL,
    ]);
  });

  it("returns null when neither the snapshot nor the official source has the document", async () => {
    respondWith("/data/rules.json", {});
    expect(await loadRule("en/unified/json/rule/missing.json")).toBeNull();
  });

  it("does not request an untrusted path from the upstream host", async () => {
    const fetch = respondWith("/data/rules.json", {});
    expect(await loadRule("en/unified/json/../../../other.json")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
