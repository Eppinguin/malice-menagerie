import { describe, expect, it } from "vitest";
import { blankHomebrewMonster } from "./homebrew.ts";
import { monsterTargetSheet } from "./monsterGuide.ts";
import {
  analyzeMonsterSanity,
  appendTierClause,
  applySanityFix,
  buildRoleStarterFeatures,
  newSiblingInFamily,
  rescaleAbilityToMonster,
  tierInsertChips,
} from "./monsterCraft.ts";

describe("role-smart starters, rescaling, sanity checks & faction builder", () => {
  it("builds distinct Draw Steel starters for Artillery, Solo, and Minion", () => {
    const artillery = buildRoleStarterFeatures(2, "Platoon", "Artillery", {
      M: -1,
      A: 2,
      R: 1,
      I: 1,
      P: 0,
    });
    expect(artillery[0]?.distance).toContain("Ranged");
    expect(artillery.length).toBeGreaterThanOrEqual(2);

    const solo = buildRoleStarterFeatures(3, "Solo", "Brute", {
      M: 3,
      A: 2,
      R: 0,
      I: 1,
      P: 1,
    });
    expect(solo.some((f) => f.name === "Solo Monster")).toBe(true);
    expect(solo.filter((f) => /villain/i.test(String(f.cost ?? ""))).length).toBe(3);

    const minion = buildRoleStarterFeatures(1, "Minion", "Harrier", {
      M: 1,
      A: 2,
      R: -1,
      I: 0,
      P: 0,
    });
    expect(minion).toHaveLength(1);
  });

  it("rescales ability tier damage and potencies while preserving types & conditions", () => {
    const mon = blankHomebrewMonster(5, "Elite", "Brute");
    const rescaled = rescaleAbilityToMonster(
      {
        name: "Flame Swipe",
        effects: [
          {
            roll: "Power Roll + 1",
            tier1: "3 fire damage",
            tier2: "5 fire damage; push 2",
            tier3: "7 fire damage; M < 1, prone",
          },
        ],
      },
      mon,
      "area",
    );
    const eff = rescaled.effects![0]!;
    expect(eff.roll).toBe("Power Roll + 3");
    expect(eff.tier2).toContain("fire damage; push 2");
    expect(eff.tier3).toMatch(/M < 3, prone/);
  });

  it("flags sanity checks and applies one-tap fixes", () => {
    const solo = blankHomebrewMonster(3, "Solo", "Brute");
    solo.turnsPerRound = 1;
    solo.features = [
      {
        name: "Claw",
        ability_type: "Signature Ability",
        effects: [
          { roll: "Power Roll + 0", tier1: "8 damage", tier2: "6 damage", tier3: "10 damage" },
        ],
      },
    ];
    const notes = analyzeMonsterSanity(solo);
    expect(notes.some((n) => n.id === "roll-mismatch")).toBe(true);
    expect(notes.some((n) => n.id === "tier-order")).toBe(true);
    expect(notes.some((n) => n.id === "solo-turns")).toBe(true);
    expect(notes.some((n) => n.id === "solo-villain")).toBe(true);

    const fixedRolls = applySanityFix(solo, "sync-rolls");
    expect(fixedRolls.features[0]?.effects?.[0]?.roll).toBe("Power Roll + 3");
    const fixedTurns = applySanityFix(fixedRolls, "set-solo-turns");
    expect(fixedTurns.turnsPerRound).toBe(2);
  });

  it("generates smart tier insert chips and appends clauses cleanly", () => {
    const mon = blankHomebrewMonster(4, "Leader", "Brute");
    const chips = tierInsertChips(mon);
    const sheet = monsterTargetSheet(4, "Leader", "Brute");
    const prone = chips.find((c) => c.id === "prone")!;
    expect(prone.clauses.tier1).toBe(`M < ${sheet.potency.weak}, prone`);
    expect(prone.clauses.tier2).toBe(`M < ${sheet.potency.average}, prone`);
    expect(prone.clauses.tier3).toBe(`M < ${sheet.potency.strong}, prone`);
    const push = chips.find((c) => c.id === "push")!;
    expect([push.clauses.tier1, push.clauses.tier2, push.clauses.tier3]).toEqual([
      "push 1",
      "push 2",
      "push 3",
    ]);
    expect(chips.find((c) => c.id === "taunted")?.group).toBe("condition");
    expect(appendTierClause("8 fire damage", "push 2")).toBe("8 fire damage; push 2");
    expect(appendTierClause("8 damage; M < 2, prone", "M < 2, prone")).toBe(
      "8 damage; M < 2, prone",
    );
  });

  it("creates sibling faction monsters inheriting family, keywords, and custom Malice", () => {
    const donor = blankHomebrewMonster(6, "Elite", "Brute");
    donor.name = "Iron Minotaur";
    donor.familyPath = "minotaur";
    donor.keywords = ["Minotaur", "Fire"];
    donor.maliceIds = ["mal-1"];
    donor.origin = { kind: "local", author: "Director Ada" };
    const sibling = newSiblingInFamily(donor);
    expect(sibling.id).not.toBe(donor.id);
    expect(sibling.familyPath).toBe("minotaur");
    expect(sibling.keywords).toEqual(["Minotaur", "Fire"]);
    expect(sibling.maliceIds).toEqual(["mal-1"]);
    expect(sibling.origin?.author).toBe("Director Ada");
    expect(sibling.organization).toBe("Minion");
  });
});
