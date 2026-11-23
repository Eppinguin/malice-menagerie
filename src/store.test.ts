import { expect, it, vi } from "vitest";
import { loadMonster, monsterAt } from "./data.ts";
import { resetPendingSharedRoll, setDiceTransport } from "./lib/rollTransport.ts";
import {
  activeEncounter,
  createEncounter,
  duplicateEncounter,
  lastRolls,
  mutateApp,
  rollCharacteristic,
  selectEncounter,
  startCombat,
} from "./store.ts";

vi.mock("./data.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data.ts")>()),
  loadMonster: vi.fn(),
  monsterAt: vi.fn(),
}));

it("leaves the selected encounter's combat intact when roster loading began in another encounter", async () => {
  const original = activeEncounter();
  const targetId = createEncounter();
  mutateApp((app) => {
    const target = activeEncounter();
    target.combat.active = true;
    target.combat.round = 4;
    target.combat.malice = 12;
    original.items.push({
      id: "entry",
      sourcePath: "test",
      groupId: original.groups[0]!.id,
      count: 1,
    });
    app.activeEncounterId = original.id;
  });

  let finishLoad!: () => void;
  vi.mocked(loadMonster).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoad = () => resolve({} as Awaited<ReturnType<typeof loadMonster>>);
      }),
  );
  const starting = startCombat({ switchView: false });
  expect(vi.mocked(loadMonster).mock.lastCall?.[0]).toBe("test");

  mutateApp((app) => {
    app.activeEncounterId = targetId;
  });
  const targetCombat = activeEncounter().combat;
  // The statblock value is cached by the loader. This test only needs its promise to settle.
  finishLoad();
  await starting;

  expect(activeEncounter().combat).toBe(targetCombat);
  expect(targetCombat).toMatchObject({ active: true, round: 4, malice: 12 });
  expect(original.combat.active).toBe(false);
});

it("unblocks a stalled shared dice roll on reset or wall-clock expiry without needing a reload", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(monsterAt).mockReturnValue({
      id: "m-test",
      chars: { M: 2, A: 1, R: 0, I: 0, P: 0 },
    } as unknown as ReturnType<typeof monsterAt>);
    let call = 0;
    setDiceTransport(() => {
      call += 1;
      if (call === 1) return new Promise(() => {});
      return Promise.resolve({ dice: [8, 9] });
    });

    rollCharacteristic("test/monster.json", "M");
    // A second roll while the first is active is rejected with the wait guard.
    rollCharacteristic("test/monster.json", "M");
    expect(call).toBe(1);

    // Resetting (e.g. on disconnect or dice disabled) clears the lock immediately.
    resetPendingSharedRoll();
    rollCharacteristic("test/monster.json", "M");
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toBe(2);
    expect(lastRolls.value.get("m-test|char|M")?.dice).toEqual([8, 9]);

    // A hung promise also clears automatically after the safety timeout.
    call = 0;
    rollCharacteristic("test/monster.json", "A");
    expect(call).toBe(1);
    await vi.advanceTimersByTimeAsync(22_000);
    rollCharacteristic("test/monster.json", "A");
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toBe(2);
    expect(lastRolls.value.get("m-test|char|A")?.dice).toEqual([8, 9]);
  } finally {
    setDiceTransport(() => null);
    resetPendingSharedRoll();
    vi.useRealTimers();
  }
});

it("regenerates and remaps all group, entry, instance, captain, summon, and effect IDs on duplicateEncounter", () => {
  const sourceId = createEncounter();
  const originalGroupId = activeEncounter().groups[0]!.id;
  mutateApp(() => {
    const enc = activeEncounter();
    enc.items = [
      { id: "entry-cap", sourcePath: "cap.json", groupId: originalGroupId, count: 1 },
      { id: "entry-min", sourcePath: "min.json", groupId: originalGroupId, count: 4 },
    ];
    enc.combat.active = true;
    enc.combat.instances = [
      {
        id: "inst-cap",
        kind: "creature",
        count: 1,
        entryId: "entry-cap",
        sourcePath: "cap.json",
        name: "Captain",
        groupId: originalGroupId,
        currentStamina: 30,
        maxStamina: 30,
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
      {
        id: "inst-squad",
        kind: "minion-squad",
        entryId: "entry-min",
        sourcePath: "min.json",
        name: "Minions",
        groupId: originalGroupId,
        currentStamina: 20,
        maxStamina: 20,
        count: 4,
        captainId: "inst-cap",
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
      {
        id: "inst-summon",
        kind: "creature",
        count: 1,
        sourcePath: "sum.json",
        name: "Summon",
        groupId: originalGroupId,
        currentStamina: 10,
        maxStamina: 10,
        summonedBy: "inst-cap",
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
    ];
    enc.combat.activeEffects = [
      { id: "eff-1", name: "Aura", expiresRound: 3, sourcePath: "cap.json" },
    ];
  });

  duplicateEncounter(sourceId);
  const copy = activeEncounter();
  expect(copy.id).not.toBe(sourceId);

  const [copyCap, copySquad, copySummon] = copy.combat.instances;
  expect(copy.groups[0]!.id).not.toBe(originalGroupId);
  expect(copy.items[0]!.id).not.toBe("entry-cap");
  expect(copy.items[0]!.groupId).toBe(copy.groups[0]!.id);
  expect(copyCap!.id).not.toBe("inst-cap");
  expect(copyCap!.entryId).toBe(copy.items[0]!.id);
  expect(copyCap!.groupId).toBe(copy.groups[0]!.id);
  expect(copySquad!.id).not.toBe("inst-squad");
  expect(copySquad!.entryId).toBe(copy.items[1]!.id);
  expect(copySquad!.captainId).toBe(copyCap!.id);
  expect(copySummon!.id).not.toBe("inst-summon");
  expect(copySummon!.summonedBy).toBe(copyCap!.id);
  expect(copy.combat.activeEffects[0]!.id).not.toBe("eff-1");
});

it("unblocks a pending shared roll when switching encounters", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(monsterAt).mockReturnValue({
      id: "m-switch",
      chars: { M: 2, A: 1, R: 0, I: 0, P: 0 },
    } as unknown as ReturnType<typeof monsterAt>);
    const originalId = activeEncounter().id;
    createEncounter();
    let calls = 0;
    setDiceTransport(() => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve({ dice: [6, 7] });
    });

    rollCharacteristic("test/switch.json", "M");
    expect(calls).toBe(1);
    selectEncounter(originalId);
    rollCharacteristic("test/switch.json", "M");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  } finally {
    setDiceTransport(() => null);
    resetPendingSharedRoll();
    vi.useRealTimers();
  }
});
