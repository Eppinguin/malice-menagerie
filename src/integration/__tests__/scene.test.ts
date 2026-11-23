import { describe, expect, it } from "vitest";
import {
  renamedTokenTarget,
  shouldRenameToken,
  syncedMinionSlot,
} from "../../../obr/src/tokenNames.ts";

describe("token names", () => {
  it("renames a token this integration has not named yet", () => {
    expect(shouldRenameToken("Goblin Warrior", null)).toBe(true);
  });

  it("follows a rename in Malice while the token still has the synced name", () => {
    expect(shouldRenameToken("Goblin Warrior", "Goblin Warrior")).toBe(true);
  });

  it("never overwrites a name the GM changed in Owlbear", () => {
    expect(shouldRenameToken("Goblin A", "Goblin Warrior")).toBe(false);
    expect(shouldRenameToken("Goblin Warrior 2", "Goblin Warrior", false)).toBe(false);
  });

  it("follows renames for numbered minion squad tokens while preserving slot numbers", () => {
    expect(syncedMinionSlot("Goblin Spinecleaver 2", "Goblin Spinecleaver")).toBe(2);
    expect(syncedMinionSlot("Goblin Spinecleaver 0", "Goblin Spinecleaver")).toBeNull();
    expect(syncedMinionSlot("Goblin Scout", "Goblin Spinecleaver")).toBeNull();
    expect(shouldRenameToken("Goblin Spinecleaver 2", "Goblin Spinecleaver", true)).toBe(true);
    expect(
      renamedTokenTarget("Goblin Spinecleaver 2", "Goblin Spinecleaver", "East Flank", true),
    ).toEqual({ name: "East Flank 2", slotNumber: 2 });
    expect(renamedTokenTarget("GM Nickname", "Goblin Spinecleaver", "East Flank", true)).toBeNull();
  });
});
