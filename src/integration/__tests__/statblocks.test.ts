import { describe, expect, it } from "vitest";
import type { Monster } from "../../types.ts";
import {
  candidatesFor,
  editDistance,
  isKnownStatblock,
  normalizeName,
  printedLevel,
  resolveStatblock,
  resolveStatblockRef,
  similarity,
  statblockIndexForResource,
  statblockKey,
} from "../statblocks.ts";
import { planImport } from "../identity.ts";
import type { Encounter } from "../../types.ts";

function monster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: "monster-1",
    path: "goblin/goblin-warrior",
    book: "Monsters",
    familyPath: "goblin",
    slug: "goblin-warrior",
    name: "Goblin Warrior",
    level: 1,
    organization: "Horde",
    role: "Harrier",
    ev: 3,
    evLabel: "3",
    defaultQty: 1,
    keywords: ["Goblin", "Humanoid"],
    ancestry: "Goblin",
    size: "1S",
    speed: 5,
    stamina: 10,
    stability: 0,
    freeStrike: 2,
    movement: "",
    immunities: [],
    weaknesses: [],
    withCaptain: "",
    turnsPerRound: 1,
    chars: { M: 0, A: 0, R: 0, I: 0, P: 0 },
    features: [],
    source: "SteelCompendium",
    raw: {},
    ...overrides,
  };
}

describe("name normalization", () => {
  it("folds case, punctuation, diacritics, and ampersands", () => {
    expect(normalizeName("Goblin Warrior")).toBe("goblin warrior");
    expect(normalizeName("  GOBLIN   Warrior  ")).toBe("goblin warrior");
    expect(normalizeName("Aeolyxria the Uncanny")).toBe("aeolyxria the uncanny");
    expect(normalizeName("Sig’run & Company")).toBe("sigrun and company");
    expect(normalizeName("Café Brûlée")).toBe("cafe brulee");
    expect(normalizeName("---")).toBe("");
  });

  it("keys statblocks by normalized name and printed level", () => {
    expect(statblockKey("Goblin Warrior", 1)).toBe("goblin warrior|1");
    expect(statblockKey("  GOBLIN   Warrior ", 1)).toBe("goblin warrior|1");
  });
});

describe("distance helpers", () => {
  it("computes bounded edit distance", () => {
    expect(editDistance("goblin", "goblin")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("goblin", "goblyn")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("returns a 0..1 similarity", () => {
    expect(similarity("goblin", "goblin")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
    expect(similarity("goblin", "goblyn")).toBeCloseTo(5 / 6, 5);
  });
});

describe("statblock resolution", () => {
  it("resolves an exact name, level, role, and ancestry match", () => {
    const result = resolveStatblock(monster());
    expect(result.ref).toEqual({
      resourceId: "cs-GoblinWarrior",
      name: "Goblin Warrior",
    });
    expect(result.confidence).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it("accepts the exact match when the monster has no role metadata", () => {
    const result = resolveStatblock(monster({ organization: "", role: "", keywords: [] }));
    expect(result.ref?.resourceId).toBe("cs-GoblinWarrior");
  });

  it("does not guess when the name matches at another level", () => {
    const result = resolveStatblock(monster({ level: 5 }));
    expect(result.ref).toBeNull();
    expect(result.reason).toContain("level");
    expect(result.candidates.map((candidate) => candidate.id)).toContain("cs-GoblinWarrior");
  });

  it("does not guess when the role is incompatible", () => {
    const result = resolveStatblock(monster({ organization: "Solo", role: "Leader" }));
    expect(result.ref).toBeNull();
    expect(result.reason).toContain("level");
  });

  it("does not guess when the ancestry conflicts", () => {
    const result = resolveStatblock(monster({ keywords: ["Elf"] }));
    expect(result.ref).toBeNull();
  });

  it("never binds official statblocks or flags unresolved entries for homebrew monsters", () => {
    const hb = monster({
      path: "homebrew:monster:test-goblin",
      isHomebrew: true,
      homebrewId: "test-goblin",
    });
    expect(resolveStatblockRef(hb)).toBeNull();
    const res = resolveStatblock(hb);
    expect(res.ref).toBeNull();
    expect(res.candidates).toEqual([]);

    const enc: Encounter = {
      id: "enc-1",
      name: "Homebrew Ambush",
      updatedAt: 1000,
      view: "combat",
      party: { heroes: 4, level: 1, victories: 0, bonusMalice: 0 },
      groups: [{ id: "g1", name: "A" }],
      activePrepGroupId: "g1",
      items: [{ id: "item-1", sourcePath: hb.path, groupId: "g1", count: 1 }],
      combat: {
        active: true,
        round: 1,
        malice: 5,
        instances: [
          {
            id: "inst-1",
            entryId: "item-1",
            sourcePath: hb.path,
            kind: "creature",
            name: "Goblin Warrior",
            groupId: "g1",
            maxStamina: 10,
            currentStamina: 10,
            count: 1,
            turns: 1,
            turnsTaken: 0,
            conditions: [],
            reactions: [],
            villainRounds: [0, 0, 0],
          },
        ],
        activeGroupFilter: null,
        activeEffects: [],
        selectedMaliceFeatureIds: [],
        maliceSelectionInitialized: true,
      },
    };
    const plan = planImport({
      encounter: enc,
      mappings: [],
      lookup: (p) => (p === hb.path ? hb : undefined),
    });
    expect(plan.combatants).toHaveLength(1);
    expect(plan.combatants[0]?.statblock).toBeNull();
    expect(plan.unresolved).toEqual([]);
  });

  it("uses the printed level for a re-levelled statblock", () => {
    const printed = monster({ level: 1 });
    const relevelled = monster({ level: 6, printed });
    expect(printedLevel(relevelled)).toBe(1);
    const result = resolveStatblock(relevelled);
    expect(result.ref?.resourceId).toBe("cs-GoblinWarrior");
  });

  it("prefers an explicit manual mapping and reports why", () => {
    const result = resolveStatblock(monster(), {
      manual: {
        [statblockKey("Goblin Warrior", 1)]: {
          resourceId: "cs-GoblinWarrior",
          name: "Goblin Warrior (manual)",
        },
      },
    });
    expect(result.ref).toEqual({
      resourceId: "cs-GoblinWarrior",
      name: "Goblin Warrior (manual)",
    });
    expect(result.reason).toBe("Saved statblock mapping.");
  });

  it("accepts a manual mapping keyed by normalized name", () => {
    const result = resolveStatblock(monster(), {
      manual: {
        "goblin warrior": { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
      },
    });
    expect(result.ref?.resourceId).toBe("cs-GoblinWarrior");
  });

  it("uses a learned mapping before the automatic resolver", () => {
    const result = resolveStatblock(monster({ level: 5 }), {
      learned: {
        [statblockKey("Goblin Warrior", 5)]: {
          resourceId: "cs-GoblinWarrior",
          name: "Goblin Warrior",
        },
      },
    });
    expect(result.ref?.resourceId).toBe("cs-GoblinWarrior");
    expect(result.reason).toBe("Previously matched statblock.");
  });

  it("copies returned refs so callers cannot mutate the cache", () => {
    const manual = { "goblin warrior|1": { resourceId: "cs-GoblinWarrior", name: "Original" } };
    const first = resolveStatblock(monster(), { manual }).ref;
    if (first) first.name = "Changed";
    const second = resolveStatblock(monster(), { manual }).ref;
    expect(second?.name).toBe("Original");
  });
});

describe("candidates", () => {
  it("puts the exact name and level first", () => {
    const results = candidatesFor("Goblin Warrior", 1);
    expect(results[0]?.id).toBe("cs-GoblinWarrior");
  });

  it("finds near-name typo candidates", () => {
    const results = candidatesFor("Goblyn Warror", 1);
    expect(results.map((candidate) => candidate.id)).toContain("cs-GoblinWarrior");
  });

  it("drops candidates below the similarity floor", () => {
    expect(candidatesFor("zzzzzzzzzz", 1)).toEqual([]);
  });

  it("honours the limit", () => {
    expect(candidatesFor("Goblin", 1, [], [], 2).length).toBeLessThanOrEqual(2);
  });
});

describe("index helpers", () => {
  it("recognises bundled resource ids only", () => {
    expect(isKnownStatblock({ resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" })).toBe(true);
    expect(isKnownStatblock({ resourceId: "cs-NotReal", name: "Not Real" })).toBe(false);
  });

  it("looks a statblock up by resource id", () => {
    expect(statblockIndexForResource("cs-GoblinWarrior")?.name).toBe("Goblin Warrior");
    expect(statblockIndexForResource("cs-NotReal")).toBeUndefined();
  });
});
