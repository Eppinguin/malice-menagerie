import { expect, it } from "vitest";
import type { CombatInstance, Encounter } from "../../types.ts";
import { applyInitiative, desiredInitiative } from "../initiative.ts";
import type { InitiativeState } from "../../../shared/obr/protocol.ts";
function encounter(): Encounter {
  return {
    id: "enc",
    name: "Fight",
    updatedAt: 0,
    view: "combat",
    activePrepGroupId: "g1",
    party: { heroes: 4, level: 1, victories: 0, bonusMalice: 0 },
    groups: [{ id: "g1", name: "Group 1" }],
    items: [{ id: "entry", sourcePath: "goblin", groupId: "g1", count: 1 }],
    combat: {
      active: true,
      round: 1,
      malice: 5,
      instances: [
        {
          id: "a",
          entryId: "entry",
          sourcePath: "goblin",
          groupId: "g1",
          kind: "creature",
          count: 1,
          name: "Goblin",
          currentStamina: 10,
          maxStamina: 10,
          turns: 3,
          turnsTaken: 0,
          conditions: [],
          reactions: [],
          villainRounds: [],
        },
      ],
      activeGroupFilter: null,
      activeEffects: [{ id: "effect", name: "Effect", expiresRound: 2, sourcePath: "goblin" }],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: true,
    },
  };
}
function incoming(): InitiativeState {
  return {
    encounterId: "enc",
    round: 3,
    combatants: [
      { instanceId: "a", groupId: "g2", groupName: "Ambushers", turns: 3, turnsTaken: 2 },
    ],
  };
}
it("applies external grouping and turn counters while keeping stamina and prep consistent", () => {
  const target = encounter();
  applyInitiative(target, incoming());
  expect(target.combat.instances[0]).toMatchObject({
    groupId: "g2",
    turns: 3,
    turnsTaken: 2,
    currentStamina: 10,
  });
  expect(target.groups).toContainEqual({ id: "g2", name: "Ambushers" });
  expect(target.items[0]!.groupId).toBe("g2");
  expect(target.combat.round).toBe(3);
  expect(target.combat.malice).toBe(18); // +6 into round 2, +7 into round 3.
  expect(target.combat.activeEffects).toEqual([]);
  applyInitiative(target, incoming());
  expect(target.combat.malice).toBe(18);
  applyInitiative(target, { ...incoming(), round: 2 });
  expect(target.combat.malice).toBe(11);
});
it("does not move every prep copy when only one combat copy changes group", () => {
  const target = encounter();
  target.combat.instances.push({ ...target.combat.instances[0], id: "b" } as CombatInstance);
  applyInitiative(target, incoming());
  expect(target.items[0]!.groupId).toBe("g1");
  expect(target.combat.instances[1]!.groupId).toBe("g1");
});
it("sends only linked combatants and includes group renames and solo activations", () => {
  const target = encounter();
  expect(desiredInitiative(target, new Set())).toEqual({
    encounterId: "enc",
    round: 1,
    combatants: [],
  });
  target.groups[0]!.name = "Front line";
  target.combat.instances[0]!.turnsTaken = 2;
  expect(desiredInitiative(target, new Set(["a"])).combatants).toEqual([
    { instanceId: "a", groupId: "g1", groupName: "Front line", turns: 3, turnsTaken: 2 },
  ]);
});

it.each([0, 1, 3])("retains an unobservable squad's budget with %s turns taken", (turnsTaken) => {
  const target = encounter();
  const squad = target.combat.instances[0]!;
  squad.kind = "minion-squad";
  squad.turnsTaken = turnsTaken;
  applyInitiative(target, { encounterId: target.id, round: target.combat.round, combatants: [] });
  expect(squad.turns).toBe(3);
  expect(squad.turnsTaken).toBe(turnsTaken);
});

it("clamps incoming turns to MAX_TURNS (9) and turnsTaken to turns", () => {
  const target = encounter();
  applyInitiative(target, {
    encounterId: target.id,
    round: target.combat.round,
    combatants: [
      { instanceId: "a", groupId: "g1", groupName: "Group 1", turns: 25, turnsTaken: 20 },
    ],
  });
  expect(target.combat.instances[0]!.turns).toBe(9);
  expect(target.combat.instances[0]!.turnsTaken).toBe(9);
});
