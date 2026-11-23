import { describe, expect, it } from "vitest";
import type { CatalogEntry, Monster } from "../types.ts";
import {
  describeRange,
  fitsEvBudget,
  highlightName,
  matchCatalogEntry,
  parseQuery,
} from "./browse.ts";

function makeEntry(overrides: Partial<Monster> = {}): CatalogEntry {
  const monster: Monster = {
    id: "m/goblin-sniper",
    path: "en/unified/json/monster/goblin/statblock/goblin-sniper.json",
    book: "unified",
    familyPath: "goblin",
    slug: "goblin-sniper",
    name: "Goblin Sniper",
    level: 1,
    organization: "Minion",
    role: "Artillery",
    ev: 0.75,
    evLabel: "3 for 4",
    defaultQty: 4,
    keywords: ["Goblin", "Humanoid"],
    ancestry: "Goblin, Humanoid",
    size: "1S",
    speed: 5,
    stamina: 3,
    stability: 0,
    freeStrike: 2,
    movement: "",
    immunities: [],
    weaknesses: [],
    withCaptain: "",
    turnsPerRound: 1,
    chars: { M: -2, A: 2, R: 0, I: 0, P: -1 },
    features: [
      {
        name: "Poison Bow",
        effects: [{ effect: "The target is weakened and takes poison damage." }],
      },
    ],
    source: "",
    raw: {},
    ...overrides,
  };
  return {
    path: monster.path,
    book: monster.book,
    familyPath: monster.familyPath,
    slug: monster.slug,
    derivedName: monster.name,
    monster,
    error: false,
  };
}

describe("smart library search (browse.ts)", () => {
  it("extracts inline level and EV constraints alongside search words", () => {
    expect(parseQuery("goblin lv 2-4 ev<=12")).toEqual({
      words: ["goblin"],
      level: { min: 2, max: 4 },
      ev: { min: 0, max: 12 },
    });
    expect(parseQuery("dragon 5+ ev 20+")).toEqual({
      words: ["dragon"],
      level: { min: 5, max: Infinity },
      ev: { min: 20, max: Infinity },
    });
    expect(describeRange("Level", { min: 2, max: 4 })).toBe("Level 2–4");
    expect(describeRange("EV", { min: 0, max: 12 })).toBe("EV ≤ 12");
  });

  it("ranks name starts above ability matches and records ability hit glosses", () => {
    const entry = makeEntry();
    const byName = matchCatalogEntry(entry, parseQuery("goblin"));
    const byAbility = matchCatalogEntry(entry, parseQuery("poison"));
    const byProse = matchCatalogEntry(entry, parseQuery("weakened"));
    expect(byName && byAbility && byProse).toBeTruthy();
    expect(byName!.score).toBeGreaterThan(byAbility!.score);
    expect(byAbility!.hit).toBe("Poison Bow");
    expect(byProse!.hit).toBe("Poison Bow");
    // Word-start guard: "ened" inside "weakened" should not match prose.
    expect(matchCatalogEntry(entry, parseQuery("ened"))).toBeNull();
  });

  it("checks fitsEvBudget against default unit EV (minion set vs single creature)", () => {
    const minion = makeEntry({ ev: 0.75, defaultQty: 4 }); // 3 EV per set
    expect(fitsEvBudget(minion.monster!, 3)).toBe(true);
    expect(fitsEvBudget(minion.monster!, 2)).toBe(false);
  });

  it("highlights matched character runs cleanly", () => {
    expect(highlightName("Goblin Sniper", ["gob", "sni"])).toEqual([
      { text: "Gob", hit: true },
      { text: "lin ", hit: false },
      { text: "Sni", hit: true },
      { text: "per", hit: false },
    ]);
  });
});
