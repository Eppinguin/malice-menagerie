import { describe, expect, it } from "vitest";
import { monsterTargetSheet, ORG_GUIDES, ROLE_GUIDES } from "./monsterGuide.ts";

describe("monster creation guide calculations", () => {
  it("covers all 9 Draw Steel roles and 6 organizations", () => {
    expect(ROLE_GUIDES).toHaveLength(9);
    expect(ORG_GUIDES).toHaveLength(6);
  });

  it("computes echelon, potencies, and 0.8x area damage for a Level 4 Leader", () => {
    const sheet = monsterTargetSheet(4, "Leader", "Brute");
    expect(sheet.echelon).toBe(2);
    // Leader at echelon 2: 1 + 2 + 1 = +4 top char
    expect(sheet.baseline.topChar).toBe(4);
    expect(sheet.potency).toEqual({ weak: 2, average: 3, strong: 4 });
    expect(sheet.areaDamage.tier2).toBeLessThan(sheet.baseline.tier2);
    expect(sheet.orgGuide?.name).toBe("Leader");
    expect(sheet.roleGuide?.name).toBe("Brute");
  });

  it("clamps weak potency at 0 for low-level minions", () => {
    const sheet = monsterTargetSheet(1, "Minion", "Harrier");
    expect(sheet.baseline.topChar).toBe(2);
    expect(sheet.potency).toEqual({ weak: 0, average: 1, strong: 2 });
  });
});
