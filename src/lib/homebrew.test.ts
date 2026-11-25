import { describe, expect, it } from "vitest";
import {
  baselineMonsterStats,
  blankHomebrewMonster,
  forkMonsterToHomebrew,
  homebrewToMonster,
  makeAbilityTemplate,
  nextVillainActionNumber,
  rawStatblockToHomebrewMonster,
  sanitizeHomebrewMonster,
} from "./homebrew.ts";
import {
  homebrewMaliceId,
  homebrewMaliceUuidFromId,
  homebrewMonsterIdFromPath,
  homebrewMonsterPath,
  isHomebrewMaliceId,
  isHomebrewMonsterPath,
  uuidv7,
} from "./id.ts";
import { atLevel } from "./levels.ts";

describe("canonical UUIDv7 & homebrew namespaces", () => {
  it("generates valid, monotonic RFC 9562 UUIDv7 strings", () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const id of ids) expect(id).toMatch(re);
    expect(new Set(ids).size).toBe(50);
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it("roundtrips homebrew monster paths with and without @level suffixes", () => {
    const id = uuidv7();
    const path = homebrewMonsterPath(id);
    expect(isHomebrewMonsterPath(path)).toBe(true);
    expect(isHomebrewMonsterPath(`${path}@5`)).toBe(true);
    expect(homebrewMonsterIdFromPath(path)).toBe(id);
    expect(homebrewMonsterIdFromPath(`${path}@5`)).toBe(id);
    expect(isHomebrewMonsterPath("en/unified/json/monster/goblin/goblin-warrior.json")).toBe(false);
    expect(
      homebrewMonsterIdFromPath("en/unified/json/monster/goblin/goblin-warrior.json"),
    ).toBeNull();
  });

  it("roundtrips homebrew malice ids", () => {
    const id = uuidv7();
    const ref = homebrewMaliceId(id);
    expect(isHomebrewMaliceId(ref)).toBe(true);
    expect(homebrewMaliceUuidFromId(ref)).toBe(id);
    expect(isHomebrewMaliceId("en/unified/json/monster/goblin/malice.json#0")).toBe(false);
  });
});

describe("Draw Steel baseline monster math & statblock conversion", () => {
  it("matches Draw Steel book formulas for Minion, Horde, Platoon, and Solo", () => {
    const minion = baselineMonsterStats(1, "Minion", "Brute");
    expect(minion.ev).toBe("3 for four minions");
    expect(minion.stamina).toBe(5);

    const horde = baselineMonsterStats(1, "Horde", "Harrier");
    expect(horde.ev).toBe("3");
    expect(horde.stamina).toBe(15);

    const solo = baselineMonsterStats(1, "Solo", "");
    expect(solo.ev).toBe("36");
    expect(solo.stamina).toBe(200);
    expect(solo.turnsPerRound).toBe(2);
  });

  it("converts homebrew monsters to full Monster objects that scale cleanly with atLevel", () => {
    const draft = blankHomebrewMonster(1, "Platoon", "Brute");
    draft.name = "Ashbone Stalker";
    const monster = homebrewToMonster(draft);
    expect(monster.isHomebrew).toBe(true);
    expect(monster.path).toBe(homebrewMonsterPath(draft.id));
    expect(monster.stamina).toBe(40);
    expect(monster.ev).toBe(6);

    const scaled = atLevel(monster, 4);
    expect(scaled.path).toBe(`${homebrewMonsterPath(draft.id)}@4`);
    expect(scaled.level).toBe(4);
    expect(scaled.stamina).toBeGreaterThan(monster.stamina);
    expect(scaled.printed).toBe(monster);
  });

  it("forks an official monster with official-fork provenance", () => {
    const official = homebrewToMonster(blankHomebrewMonster(2, "Elite", "Artillery"));
    official.isHomebrew = false;
    official.path = "en/unified/json/monster/goblin/goblin-sniper.json";
    official.name = "Goblin Sniper";

    const forked = forkMonsterToHomebrew(official);
    expect(forked.origin).toEqual({
      kind: "official-fork",
      sourceId: "en/unified/json/monster/goblin/goblin-sniper.json",
      sourceName: "Goblin Sniper",
    });
    expect(forked.name).toBe("Goblin Sniper (Custom)");
  });

  it("imports raw SteelCompendium statblock JSON into a HomebrewMonster", () => {
    const imported = rawStatblockToHomebrewMonster({
      name: "Clockwork Hound",
      level: 2,
      organization: "Horde",
      role: "Harrier",
      ev: "4",
      stamina: 20,
      free_strike: 3,
      might: 2,
      agility: 2,
      keywords: ["Construct"],
      features: [
        { name: "Iron Jaws", ability_type: "Signature Ability", effects: [{ effect: "Bite." }] },
      ],
    });
    expect(imported).not.toBeNull();
    expect(imported?.name).toBe("Clockwork Hound");
    expect(imported?.chars.M).toBe(2);
    expect(imported?.stamina).toBe(20);
  });

  it("preserves custom characteristics beyond the book −5..+5 cap", () => {
    const sanitized = sanitizeHomebrewMonster({
      name: "God-Breaker Titan",
      level: 10,
      organization: "Solo",
      chars: { M: 8, A: -7, R: "bad", I: 6, P: -0 },
    });
    expect(sanitized?.chars).toEqual({ M: 8, A: -7, R: 0, I: 6, P: 0 });
  });

  it("supports Level 0 homebrew monsters cleanly in baseline math and conversion", () => {
    const draft = blankHomebrewMonster(0, "Minion", "Harrier");
    expect(draft.level).toBe(0);
    expect(draft.stamina).toBeGreaterThanOrEqual(1);
    const runtime = homebrewToMonster(draft);
    expect(runtime.level).toBe(0);
    expect(runtime.ancestry).toBe("");
  });

  it("auto-numbers Villain Actions to fill missing slots or count up", () => {
    const draft = blankHomebrewMonster(2, "Leader", "Brute");
    draft.features = [];
    expect(nextVillainActionNumber(draft.features)).toBe(1);

    const va1 = makeAbilityTemplate("villain", draft);
    expect(va1.cost).toBe("Villain Action 1");
    draft.features.push(va1);

    const va2 = makeAbilityTemplate("villain", draft);
    expect(va2.cost).toBe("Villain Action 2");
    draft.features.push(va2);

    const va3 = makeAbilityTemplate("villain", draft);
    expect(va3.cost).toBe("Villain Action 3");
    draft.features.push(va3);

    // Removing VA 2 should make the next addition fill slot 2
    draft.features = [va1, va3];
    expect(nextVillainActionNumber(draft.features)).toBe(2);
    expect(makeAbilityTemplate("villain", draft).cost).toBe("Villain Action 2");

    // Having 1, 2, 3 counts up to 4
    draft.features = [va1, va2, va3];
    expect(nextVillainActionNumber(draft.features)).toBe(4);
  });
});
